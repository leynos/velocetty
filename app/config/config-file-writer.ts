/**
 * @file The single writer for the user's JSON5 config file.
 *
 * Every main-process read-modify-write runs here, as one synchronous critical
 * section: resolve the real path, read fresh, refuse unless the root and
 * `config` are objects, apply one edit, re-parse and compare it with the
 * intended value, confirm the result still loads, and apply the write policy
 * and schema. `config-file-write-io.ts` then replaces the file atomically with
 * the validated text.
 *
 * Node runs that section to completion without interleaving, so two in-process
 * writers cannot lose an update. Only an external editor saving the same key at
 * the same instant can win, and then the watcher reloads the file.
 */

import JSON5 from 'json5';

import {
  asConfigFilePath,
  asConfigFileText,
  writeFileAtomically,
  type ConfigFileSystemPort,
  type ConfigFilePath,
  type ConfigWriteDurability
} from './config-file-write-io';
import {currentConfigRevision, nextConfigRevision, recordWrittenText} from './config-write-state';
import {
  json5Document,
  propertyKey,
  removePropertyAtPath,
  setPropertyAtPath,
  type DocumentEditResult,
  type Json5Document
} from './json5';
import {validateConfigOptions} from './json5-config';
import {boundedErrorCode, describeError, errorCode} from '../utils/error-code';
import {isJsonObject} from '../utils/runtime-guards';

import type {ConfigMetrics} from './config-metrics';
import type {configValidationDiagnostic} from '@shared/types/config';
import type {JsonValue} from '@shared/types/json';
import type {SettingsWriteFailure} from '@shared/settings/protocol';

// The port and the atomic replacement live in `config-file-write-io`; these
// re-exports keep `config-file-writer` the documented surface for callers.
export {sweepTemporaryFiles, TEMPORARY_FILE_PREFIX} from './config-file-write-io';
export {asConfigFilePath, asConfigFileText} from './config-file-write-io';
export type {ConfigFileStat, ConfigFileSystemPort, ConfigFilePath} from './config-file-write-io';

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
  | {
      readonly kind: 'written';
      readonly text: string;
      readonly revision: number;
      readonly durability: ConfigWriteDurability;
    }
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
  /** Counts this writer's retries and unconfirmed durabilities; optional for other callers. */
  readonly metrics?: Pick<ConfigMetrics, 'increment'>;
};

const MAX_ATTEMPTS = 3;
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** A path from the document root to one edited property. */
type ConfigPath = readonly string[];

/** A step that either yields a value or refuses the write. */
type StepOutcome<T> =
  | {readonly kind: 'ok'; readonly value: T}
  | {
      readonly kind: 'refused';
      readonly reason: SettingsWriteFailure;
      readonly diagnostics?: readonly configValidationDiagnostic[];
    };

/** The file a write reads and then replaces. */
type ConfigDocumentSource = {
  readonly fileSystem: ConfigFileSystemPort;
  readonly targetPath: ConfigFilePath;
};

/** One edit and the guard that vets it, applied to a loaded document. */
type ConfigEditJob = {
  readonly text: Json5Document;
  readonly edit: ConfigEditRequest;
  readonly guard: ConfigWriteGuard;
};

/** A candidate document and the checks that must pass before writing it. */
type ConfigDiagnosticJob = {
  readonly candidate: JsonValue;
  readonly edit: ConfigEditRequest;
  readonly guard: ConfigWriteGuard;
};

const refused = (
  reason: SettingsWriteFailure,
  diagnostics?: readonly configValidationDiagnostic[]
): ConfigWriteOutcome => {
  if (diagnostics === undefined) {
    return {kind: 'refused', reason};
  }
  return {kind: 'refused', reason, diagnostics};
};

/** Describes a failed write for the log: an errno and a category, never a message or path. */
const describeFailure = (error: unknown): string => JSON.stringify(describeError(error));

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

const valueAtPath = (root: JsonValue, segments: ConfigPath): JsonValue | undefined => {
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

const applyEdit = (text: Json5Document, edit: ConfigEditRequest): DocumentEditResult => {
  const segments = edit.path.map((segment) => propertyKey(segment));
  return edit.kind === 'set' ? setPropertyAtPath(text, segments, edit.value) : removePropertyAtPath(text, segments);
};

const parseDocument = (text: Json5Document): JsonValue | null => {
  try {
    // `JSON5.parse` produces only JSON5 primitives, arrays, and objects, which
    // is exactly the `JsonValue` union.
    const parsed: JsonValue = JSON5.parse(text);
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Reads and parses a candidate document, refusing failure modes the writer
 * cannot edit.
 *
 * @param source - The port and the resolved path to read.
 * @returns The loaded document text, or the refusal that stops the write.
 */
const loadConfigDocument = (source: ConfigDocumentSource): StepOutcome<Json5Document> => {
  const text = json5Document(source.fileSystem.readText(source.targetPath));
  const root = parseDocument(text);
  if (root === null) {
    return {kind: 'refused', reason: 'user-config-unparseable'};
  }
  if (!isJsonObject(root)) {
    return {kind: 'refused', reason: 'config-not-object'};
  }
  if (!isJsonObject(root.config)) {
    return {kind: 'refused', reason: 'config-not-object'};
  }
  return {kind: 'ok', value: text};
};

/**
 * Checks the candidate against the intended effect of the edit.
 *
 * A set must round-trip to the same JSON value; a remove must leave no value at
 * the path. Anything else means the edit did not apply as asked.
 */
const editValueMatches = (edit: ConfigEditRequest, appliedValue: JsonValue | undefined): boolean => {
  if (edit.kind === 'set') {
    return JSON.stringify(appliedValue) === JSON.stringify(edit.value);
  }
  return appliedValue === undefined;
};

/**
 * Collects the policy and schema diagnostics that block this edit.
 *
 * The file may already be invalid elsewhere (D15); the edit is refused only
 * when it leaves a problem at or below the key it touches, so a user can fix
 * one diagnosed key at a time.
 */
const collectEditDiagnostics = (job: ConfigDiagnosticJob): readonly configValidationDiagnostic[] => {
  const configValue = isJsonObject(job.candidate) ? job.candidate.config : {};
  const keyPath = `/${job.edit.path.join('/')}`;
  const schemaDiagnostics = validateConfigOptions(configValue).filter((diagnostic) =>
    concernsPath(diagnostic, keyPath)
  );
  const policyDiagnostics: readonly configValidationDiagnostic[] =
    job.edit.kind === 'set' ? job.guard.checkPolicy(job.edit.path, job.edit.value) : [];
  return [...policyDiagnostics, ...schemaDiagnostics];
};

/**
 * Applies one edit and verifies the result before it can be written.
 *
 * @param job - The loaded text, the edit, and its guard.
 * @returns The edited document, or the refusal that stops the write.
 */
const applyCheckedEdit = (job: ConfigEditJob): StepOutcome<Json5Document> => {
  const applied = applyEdit(job.text, job.edit);
  if (applied.kind === 'refused') {
    // A missing path is an edit failure for the writer's contract; the other
    // two reasons map directly onto a write failure.
    return {kind: 'refused', reason: applied.reason === 'path-not-found' ? 'edit-failed' : applied.reason};
  }
  const candidate = parseDocument(applied.doc);
  if (candidate === null) {
    return {kind: 'refused', reason: 'edit-failed'};
  }
  if (!editValueMatches(job.edit, valueAtPath(candidate, job.edit.path))) {
    return {kind: 'refused', reason: 'edit-failed'};
  }
  const diagnostics = collectEditDiagnostics({candidate, edit: job.edit, guard: job.guard});
  if (diagnostics.length > 0) {
    return {kind: 'refused', reason: 'not-editable', diagnostics};
  }
  return {kind: 'ok', value: applied.doc};
};

/**
 * Runs the whole critical section once, without retrying.
 *
 * @param dependencies - The injected ports and state hooks.
 * @param filePath - The config file to edit.
 * @param edit - The edit to apply.
 * @param guard - The write-policy check for this edit.
 * @returns The written text and revision, or a refusal.
 */
const attemptWrite = (
  dependencies: ConfigWriterDependencies,
  filePath: string,
  edit: ConfigEditRequest,
  guard: ConfigWriteGuard
): ConfigWriteOutcome => {
  const {fileSystem} = dependencies;
  const targetPath = fileSystem.realpath(asConfigFilePath(filePath));
  const loaded = loadConfigDocument({fileSystem, targetPath});
  if (loaded.kind === 'refused') {
    return refused(loaded.reason);
  }
  const edited = applyCheckedEdit({text: loaded.value, edit, guard});
  if (edited.kind === 'refused') {
    return refused(edited.reason, edited.diagnostics);
  }
  const durability = writeFileAtomically({
    fileSystem,
    targetPath,
    text: asConfigFileText(edited.value),
    platform: dependencies.platform,
    processId: dependencies.processId()
  });
  if (durability === 'unconfirmed') {
    // The rename is visible but the directory fsync failed, so a crash could
    // still lose the text; the line names the condition, never a path.
    dependencies.metrics?.increment('settingsDurabilityUnconfirmed');
    dependencies.log('config writer durability=unconfirmed');
  }
  dependencies.recordWrittenText(edited.value);
  return {kind: 'written', text: edited.value, revision: dependencies.nextRevision(), durability};
};

/**
 * Decides whether a failed attempt may be retried.
 *
 * @param code - The error code, when the failure carried one.
 * @param attempt - The one-based number of the attempt that just failed.
 * @returns True when another attempt is both safe and available.
 */
const shouldRetry = (code: string | undefined, attempt: number): boolean =>
  code !== undefined && RETRYABLE_CODES.has(code) && attempt < MAX_ATTEMPTS;

/** What one failed attempt means for the caller. */
type WriteFailureKind = 'missing' | 'retry' | 'failed';

const classifyWriteFailure = (error: unknown, attempt: number): WriteFailureKind => {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    return 'missing';
  }
  return shouldRetry(code, attempt) ? 'retry' : 'failed';
};

/** Counts one retried attempt, logs its bounded line, and waits its backoff. */
const recordRetry = async (dependencies: ConfigWriterDependencies, error: unknown, attempt: number): Promise<void> => {
  dependencies.metrics?.increment('settingsWriteRetries');
  // Only the errno and the attempt number: a key, a path, and the text are user data.
  dependencies.log(`config writer retry attempt=${attempt} code=${boundedErrorCode(error) ?? 'unknown'}`);
  await dependencies.sleep(attempt * 50);
};

/** Logs the failure that ended the write. */
const recordFailure = (dependencies: ConfigWriterDependencies, error: unknown): void => {
  dependencies.log(`config writer failed: ${describeFailure(error)}`);
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
      const kind = classifyWriteFailure(error, attempt);
      if (kind === 'missing') {
        return refused('config-file-missing');
      }
      if (kind === 'failed') {
        recordFailure(dependencies, error);
        return refused('io-error');
      }
      await recordRetry(dependencies, error, attempt);
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
    dependencies.log(`config writer failed: ${describeFailure(error)}`);
    return refused('io-error');
  }
};

/** The production dependency set, using the shared revision state. */
export const defaultWriterState = {
  nextRevision: nextConfigRevision,
  currentRevision: currentConfigRevision,
  recordWrittenText
};
