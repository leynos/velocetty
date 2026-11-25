/**
 * @file The single writer for the user's JSON5 config file.
 *
 * Every main-process read-modify-write runs here, as one synchronous critical
 * section: resolve the real path, read fresh, refuse unless the root and
 * `config` are objects, apply one edit, re-parse and compare it with the
 * intended value, confirm the result still loads, apply the write policy and
 * schema, then write a sibling temporary file with the original mode, fsync it,
 * rename it over the real path, and fsync the directory.
 *
 * Node runs that section to completion without interleaving, so two in-process
 * writers cannot lose an update. Only an external editor saving the same key at
 * the same instant can win, and then the watcher reloads the file.
 */

import path from 'node:path';

import JSON5 from 'json5';

import {currentConfigRevision, nextConfigRevision, recordWrittenText} from './config-write-state';
import {json5Document, propertyKey, removePropertyAtPath, setPropertyAtPath} from './json5';
import {validateConfigOptions} from './json5-config';
import {isJsonObject, isString} from '../utils/runtime-guards';

import type {configValidationDiagnostic} from '@shared/types/config';
import type {JsonValue} from '@shared/types/json';
import type {SettingsWriteFailure} from '@shared/settings/protocol';

/** Metadata the writer needs from the file system. */
export type ConfigFileStat = {readonly mode: number};

/**
 * The synchronous file-system operations the writer needs.
 *
 * Every method is synchronous so that the whole read-modify-write is one
 * critical section.
 */
export type ConfigFileSystemPort = {
  readonly realpath: (filePath: string) => string;
  readonly readText: (filePath: string) => string;
  readonly stat: (filePath: string) => ConfigFileStat | null;
  readonly writeFile: (filePath: string, text: string, mode: number) => void;
  readonly fsyncFile: (filePath: string) => void;
  readonly rename: (fromPath: string, toPath: string) => void;
  readonly unlink: (filePath: string) => void;
  readonly readdir: (directory: string) => readonly string[];
  readonly fsyncDirectory: (directory: string) => void;
};

/** One edit the writer may apply. */
export type ConfigEditRequest =
  | {readonly kind: 'set'; readonly path: readonly string[]; readonly value: JsonValue}
  | {readonly kind: 'remove'; readonly path: readonly string[]};

/** The checks the caller supplies for one edit. */
export type ConfigWriteGuard = {
  readonly checkPolicy: (path: readonly string[], value: JsonValue) => readonly configValidationDiagnostic[];
};

/** The result of one write. */
export type ConfigWriteOutcome =
  | {readonly kind: 'written'; readonly text: string; readonly revision: number}
  | {
      readonly kind: 'refused';
      readonly reason: SettingsWriteFailure;
      readonly diagnostics?: readonly configValidationDiagnostic[];
    };

/** Everything the writer needs, with production defaults supplied by the caller. */
export type ConfigWriterDependencies = {
  readonly fileSystem: ConfigFileSystemPort;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (message: string) => void;
  readonly platform: NodeJS.Platform;
  readonly processId: () => number;
  readonly nextRevision: () => number;
  readonly currentRevision: () => number;
  readonly recordWrittenText: (text: string) => void;
};

/** The prefix every temporary write file uses, so start-up can sweep them. */
export const TEMPORARY_FILE_PREFIX = '.velocetty-config-write-';

const DEFAULT_MODE = 0o600;
const MAX_ATTEMPTS = 3;
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
let temporaryCounter = 0;

const refused = (
  reason: SettingsWriteFailure,
  diagnostics?: readonly configValidationDiagnostic[]
): ConfigWriteOutcome => {
  if (diagnostics === undefined) {
    return {kind: 'refused', reason};
  }
  return {kind: 'refused', reason, diagnostics};
};

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && isString(error.code) ? error.code : undefined;

/**
 * Reads the last segment of a config path.
 *
 * @param segments - The path segments.
 * @returns The final segment, or an empty string for an empty path.
 *
 * @example
 * lastPathSegment(['config', 'fontSize']); // 'fontSize'
 */
export const lastPathSegment = (segments: readonly string[]): string => {
  let last = '';
  for (const segment of segments) {
    last = segment;
  }
  return last;
};

const valueAtPath = (root: JsonValue, segments: readonly string[]): JsonValue | undefined => {
  let current = root;
  for (const segment of segments) {
    if (!isJsonObject(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const concernsPath = (diagnostic: configValidationDiagnostic, keyPath: string): boolean =>
  diagnostic.path === keyPath || diagnostic.path.startsWith(`${keyPath}/`);

const applyEdit = (text: string, edit: ConfigEditRequest) => {
  const segments = edit.path.map((segment) => propertyKey(segment));
  return edit.kind === 'set'
    ? setPropertyAtPath(json5Document(text), segments, edit.value)
    : removePropertyAtPath(json5Document(text), segments);
};

const parseDocument = (text: string): JsonValue | null => {
  try {
    return (
      // SAFETY: JSON5.parse produces only JSON5 primitives, arrays, and
      // objects, which is exactly the `JsonValue` union.
      JSON5.parse(text) as JsonValue
    );
  } catch {
    return null;
  }
};

const temporaryPathFor = (target: string, processId: number): string => {
  temporaryCounter += 1;
  return path.join(path.dirname(target), `${TEMPORARY_FILE_PREFIX}${processId}-${temporaryCounter}`);
};

const writeAtomically = (
  fileSystem: ConfigFileSystemPort,
  target: string,
  text: string,
  platform: NodeJS.Platform,
  processId: number
): void => {
  const mode = fileSystem.stat(target)?.mode ?? DEFAULT_MODE;
  const temporaryPath = temporaryPathFor(target, processId);
  try {
    fileSystem.writeFile(temporaryPath, text, mode);
    fileSystem.fsyncFile(temporaryPath);
    fileSystem.rename(temporaryPath, target);
  } catch (error) {
    try {
      fileSystem.unlink(temporaryPath);
    } catch {
      // The temporary file may not exist; the original error is the useful one.
    }
    throw error;
  }
  if (platform !== 'win32') {
    fileSystem.fsyncDirectory(path.dirname(target));
  }
};

const attemptWrite = (
  dependencies: ConfigWriterDependencies,
  filePath: string,
  edit: ConfigEditRequest,
  guard: ConfigWriteGuard
): ConfigWriteOutcome => {
  const {fileSystem} = dependencies;
  const realPath = fileSystem.realpath(filePath);
  const originalText = fileSystem.readText(realPath);
  const original = parseDocument(originalText);
  if (original === null) {
    return refused('user-config-unparseable');
  }
  if (!isJsonObject(original) || !isJsonObject(original.config)) {
    return refused('config-not-object');
  }

  const edited = applyEdit(originalText, edit);
  if (edited.kind === 'refused') {
    // A missing path is an edit failure for the writer's contract; the other
    // two reasons map directly onto a write failure.
    return refused(edited.reason === 'path-not-found' ? 'edit-failed' : edited.reason);
  }

  const candidate = parseDocument(edited.doc);
  if (candidate === null) {
    return refused('edit-failed');
  }
  if (edit.kind === 'set') {
    const applied = valueAtPath(candidate, edit.path);
    if (JSON.stringify(applied) !== JSON.stringify(edit.value)) {
      return refused('edit-failed');
    }
  } else if (valueAtPath(candidate, edit.path) !== undefined) {
    return refused('edit-failed');
  }
  // The file may already be invalid elsewhere (D15); the edit is refused only
  // when it leaves a problem at or below the key it touches, so a user can fix
  // one diagnosed key at a time.
  const keyPath = `/${edit.path.join('/')}`;
  const schemaDiagnostics = validateConfigOptions(isJsonObject(candidate) ? candidate.config : {}).filter(
    (diagnostic) => concernsPath(diagnostic, keyPath)
  );
  const policyDiagnostics: readonly configValidationDiagnostic[] =
    edit.kind === 'set' ? guard.checkPolicy(edit.path, edit.value) : [];
  const diagnostics = [...policyDiagnostics, ...schemaDiagnostics];
  if (diagnostics.length > 0) {
    return refused('not-editable', diagnostics);
  }

  writeAtomically(fileSystem, realPath, edited.doc, dependencies.platform, dependencies.processId());
  dependencies.recordWrittenText(edited.doc);
  return {kind: 'written', text: edited.doc, revision: dependencies.nextRevision()};
};

/**
 * Applies one edit to the config file.
 *
 * A retryable file-system error (`EBUSY`, `EPERM`, `EACCES`) re-runs the whole
 * critical section, because the file may have changed between attempts.
 *
 * @param dependencies - The injected ports and state hooks.
 * @param filePath - The config file to edit.
 * @param edit - The edit to apply.
 * @param guard - The write-policy check for this edit.
 * @returns The written text and revision, or a refusal.
 *
 * @example
 * await writeConfigEdit(dependencies, '/home/me/.config/Hyper/config.json5', {
 *   kind: 'set',
 *   path: ['config', 'fontSize'],
 *   value: 16
 * }, guard);
 */
export const writeConfigEdit = async (
  dependencies: ConfigWriterDependencies,
  filePath: string,
  edit: ConfigEditRequest,
  guard: ConfigWriteGuard
): Promise<ConfigWriteOutcome> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return attemptWrite(dependencies, filePath, edit, guard);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') {
        return refused('config-file-missing');
      }
      if (code === undefined || !RETRYABLE_CODES.has(code) || attempt === MAX_ATTEMPTS) {
        dependencies.log(`config writer failed: ${String(error)}`);
        return refused('io-error');
      }
      await dependencies.sleep(attempt * 50);
    }
  }
  return refused('io-error');
};

/**
 * Applies one edit without retrying.
 *
 * The plugin runtime persists at start-up, where a retry cannot be awaited;
 * one synchronous critical section still gives the same validation and the
 * same atomic replacement. A retryable failure is reported as `io-error`.
 *
 * @param dependencies - The injected ports and state hooks.
 * @param filePath - The config file to edit.
 * @param edit - The edit to apply.
 * @param guard - The write-policy check for this edit.
 * @returns The written text and revision, or a refusal.
 *
 * @example
 * writeConfigEditSync(dependencies, configPath, {kind: 'remove', path: ['config', 'fontSize']}, guard);
 */
export const writeConfigEditSync = (
  dependencies: ConfigWriterDependencies,
  filePath: string,
  edit: ConfigEditRequest,
  guard: ConfigWriteGuard
): ConfigWriteOutcome => {
  try {
    return attemptWrite(dependencies, filePath, edit, guard);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return refused('config-file-missing');
    }
    dependencies.log(`config writer failed: ${String(error)}`);
    return refused('io-error');
  }
};

/**
 * Removes temporary files left by an interrupted write.
 *
 * @param fileSystem - The file-system port.
 * @param directory - The directory holding the config file.
 * @returns The number of files removed.
 *
 * @example
 * sweepTemporaryFiles(port, '/home/me/.config/Hyper'); // 0
 */
export const sweepTemporaryFiles = (fileSystem: ConfigFileSystemPort, directory: string): number => {
  let removed = 0;
  for (const entry of fileSystem.readdir(directory)) {
    if (!entry.startsWith(TEMPORARY_FILE_PREFIX)) {
      continue;
    }
    try {
      fileSystem.unlink(path.join(directory, entry));
      removed += 1;
    } catch {
      // A concurrent sweep may have won; the leftover is harmless.
    }
  }
  return removed;
};

/** The production dependency set, using the shared revision state. */
export const defaultWriterState = {
  nextRevision: nextConfigRevision,
  currentRevision: currentConfigRevision,
  recordWrittenText
};
