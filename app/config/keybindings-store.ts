/** @file Atomic file adapter for `keybindings.json5` (KB-STORE-1). */
/*
 * Writes go to a temporary sibling that is flushed, given the target's mode,
 * and renamed over it. A read-only target is refused before anything is
 * created, and a failure removes the temporary file without overwriting.
 *
 * Rename retries and reporting live in their own modules. This adapter does
 * only the filesystem work and hands each bounded failure back to the wrapper.
 */
import * as fs from 'node:fs';
import path from 'node:path';

import {errorCode} from '../utils/error-code';
import type {KeybindingsStore} from './keybindings-ports';
import {createRenameWithRetry} from './keybindings-rename-retry';
import {type FileKeybindingsStoreOptions, type RawRead, storageFailure} from './keybindings-store-contract';
import type {KeybindingsCleanupWarning, KeybindingsWriteAttempt} from './keybindings-store-reporting';
import {withReporting} from './keybindings-store-reporting';

export type {
  FileKeybindingsStoreOptions,
  KeybindingsFileSystem,
  RenameFailureCategory,
  RenameRetryEvent
} from './keybindings-store-contract';

/** Bounds link chasing so a symlink cycle cannot spin the resolver forever. */
const MAX_SYMLINK_HOPS = 40;

/** The `<pid>.<counter>` middle segment of a temporary file name. */
const TEMPORARY_SEQUENCE = /^\d+\.\d+$/;

/** One replacement: the resolved target, its temporary sibling, and the mode to keep. */
type ReplacementPlan = Readonly<{
  readonly mode: number | undefined;
  readonly target: string;
  readonly temporaryPath: string;
}>;

/** A vetted replacement target, or the refused attempt the caller must report. */
type PreparedWrite =
  | Readonly<{kind: 'ready'; plan: ReplacementPlan}>
  | Readonly<{attempt: KeybindingsWriteAttempt; kind: 'refused'}>;

/**
 * The path a write may land on, or why no safe path could be established.
 *
 * A write is only safe against a path known not to be a symlink, or genuinely
 * absent; anything else fails closed rather than replacing a link.
 */
type TargetResolution = Readonly<{kind: 'resolved'; path: string}> | Readonly<{kind: 'unresolved'; error: unknown}>;

/**
 * Creates the filesystem adapter behind `KeybindingsStore`.
 *
 * A symlinked target — a dangling chain included — is resolved first, so the
 * replacement lands on what the link points at and the link survives. A cycle,
 * an over-long chain, a read-only target, or any resolution failure is refused
 * before anything is created. A failed `statSync` only means the temporary file
 * takes the default mode, and stale-file cleanup is best-effort.
 *
 * Filesystem, sleep, and warning dependencies are injectable for tests.
 *
 * @example
 * ```ts
 * const store = createFileKeybindingsStore({filePath: '/home/u/.config/Velocetty/keybindings.json5'});
 * store.read(); // {kind: 'missing'} on a fresh install
 * store.write("{'window:new': 'ctrl+n'}"); // {kind: 'written'}
 * ```
 */
export const createFileKeybindingsStore = (
  options: FileKeybindingsStoreOptions
): KeybindingsStore & {readonly removeStaleTemporaryFiles: () => void} => {
  const fileSystem = options.fs ?? fs;
  const fileName = path.basename(options.filePath);
  const temporaryPrefix = `.${fileName}.`;
  let temporaryCounter = 0;

  const renameWithRetry = createRenameWithRetry({
    onRetry: options.onRetry,
    rename: (temporaryPath, target) => fileSystem.renameSync(temporaryPath, target),
    sleep: options.sleep
  });

  /**
   * Recognizes only this adapter's own temporary files.
   *
   * Matching on literal prefix and suffix avoids building a regular expression
   * from the file name, which would need escaping and could silently match a
   * different file if that escaping were wrong.
   */
  const isOwnTemporaryName = (name: string): boolean =>
    name.startsWith(temporaryPrefix) &&
    name.endsWith('.tmp') &&
    TEMPORARY_SEQUENCE.test(name.slice(temporaryPrefix.length, -'.tmp'.length));

  /**
   * The path a symlink chain leads to, following links whose target is absent.
   *
   * `realpathSync` cannot resolve a dangling link, but a dotfiles-managed
   * `keybindings.json5` is exactly that before the target exists; writing to the
   * link's own path would replace it with a regular file. The chain is followed
   * by hand until a path that is not a link, or that is genuinely absent, is
   * reached. A cycle, an over-long chain, or an inspection error fails closed,
   * because such a path is not a writable target.
   */
  const followLinks = (candidate: string, hops: number): TargetResolution => {
    let isLink: boolean;
    try {
      isLink = fileSystem.lstatSync(candidate).isSymbolicLink();
    } catch (error) {
      return errorCode(error) === 'ENOENT' ? {kind: 'resolved', path: candidate} : {kind: 'unresolved', error};
    }
    if (!isLink) {
      return {kind: 'resolved', path: candidate};
    }
    if (hops >= MAX_SYMLINK_HOPS) {
      return {
        error: new Error(`Refusing to follow more than ${MAX_SYMLINK_HOPS} symlinks from "${options.filePath}".`),
        kind: 'unresolved'
      };
    }
    let linkTarget: string;
    try {
      linkTarget = fileSystem.readlinkSync(candidate);
    } catch (error) {
      return {kind: 'unresolved', error};
    }
    return followLinks(path.resolve(path.dirname(candidate), linkTarget), hops + 1);
  };

  /** The symlink's target when there is one, so the link itself survives. */
  const resolveTarget = (): TargetResolution => {
    try {
      return {kind: 'resolved', path: fileSystem.realpathSync(options.filePath)};
    } catch (error) {
      // Only a dangling chain can be resolved by hand; a cycle or an
      // unreadable component is reported by `realpathSync` and must not be
      // guessed at.
      return errorCode(error) === 'ENOENT' ? followLinks(options.filePath, 0) : {kind: 'unresolved', error};
    }
  };

  /** The mode a replacement must keep, when the target already exists. */
  const modeOf = (target: string): number | undefined => {
    try {
      return fileSystem.statSync(target).mode & 0o777;
    } catch {
      return undefined;
    }
  };

  /**
   * Describes one atomic replacement, allocating the temporary name to use.
   *
   * The counter makes a name unique within the process, so a failed attempt's
   * leftover cannot be mistaken for the next attempt's file.
   */
  const planReplacement = (target: string): ReplacementPlan => {
    temporaryCounter += 1;
    const temporaryPath = path.join(path.dirname(target), `.${fileName}.${process.pid}.${temporaryCounter}.tmp`);
    return {mode: modeOf(target), target, temporaryPath};
  };

  /**
   * Whether an existing target may be replaced.
   *
   * A missing target is created, so it counts as writable. On POSIX a rename
   * over a read-only file succeeds whenever the directory is writable, so the
   * target's own permission must be checked before the temporary file is made;
   * otherwise KB-STORE-1's "read-only target reports failed" would not hold.
   */
  const canReplaceTarget = ({target}: ReplacementPlan): boolean => {
    try {
      fileSystem.accessSync(target, fileSystem.constants.W_OK);
      return true;
    } catch (error) {
      return errorCode(error) === 'ENOENT';
    }
  };

  /** Reads the file, keeping the raw error the port deliberately hides. */
  const readRaw = (): RawRead => {
    try {
      return {outcome: {kind: 'present', text: fileSystem.readFileSync(options.filePath, 'utf8')}};
    } catch (error) {
      const code = errorCode(error);
      return code === 'ENOENT'
        ? {outcome: {kind: 'missing'}}
        : {error, outcome: {failure: storageFailure(code), kind: 'unreadable'}};
    }
  };

  /**
   * Writes every byte of the buffer, looping over partial writes.
   *
   * `writeSync` may accept fewer bytes than offered, so a single call is not
   * enough to guarantee the temporary file holds the whole document.
   */
  const writeAll = (descriptor: number, buffer: Buffer): void => {
    let offset = 0;
    while (offset < buffer.length) {
      const written = fileSystem.writeSync(descriptor, buffer, offset, buffer.length - offset);
      if (written <= 0) {
        throw new Error('Short write while saving keybindings.');
      }
      offset += written;
    }
  };

  /** Closes a descriptor, tolerating the error raised when it is already closed. */
  const closeQuietly = (descriptor: number): void => {
    try {
      fileSystem.closeSync(descriptor);
    } catch {
      // The descriptor may already be closed; the write outcome is failure either way.
    }
  };

  /** Removes a temporary file, tolerating the error raised when it is absent. */
  const removeQuietly = ({temporaryPath}: ReplacementPlan): void => {
    try {
      fileSystem.unlinkSync(temporaryPath);
    } catch {
      // Already removed, or never created; the caller only needs the failure.
    }
  };

  /** Resolves and vets the replacement target, describing any refusal. */
  const prepareWrite = (): PreparedWrite => {
    const resolution = resolveTarget();
    if (resolution.kind === 'unresolved') {
      const failure = storageFailure(errorCode(resolution.error));
      return {
        attempt: {outcome: {failure, kind: 'failed'}, warning: {failure, kind: 'unresolved-target'}},
        kind: 'refused'
      };
    }
    const plan = planReplacement(resolution.path);
    if (!canReplaceTarget(plan)) {
      return {
        attempt: {outcome: {failure: 'permission', kind: 'failed'}, warning: {kind: 'read-only-target'}},
        kind: 'refused'
      };
    }
    return {kind: 'ready', plan};
  };

  /** Opens the temporary sibling exclusively, with the target's mode when known. */
  const openTemporary = (plan: ReplacementPlan): number =>
    plan.mode === undefined
      ? fileSystem.openSync(plan.temporaryPath, 'wx')
      : fileSystem.openSync(plan.temporaryPath, 'wx', plan.mode);

  /** Fills, flushes, and renames the temporary file over the resolved target. */
  const commitWrite = (plan: ReplacementPlan, text: string): KeybindingsWriteAttempt => {
    let descriptor: number | undefined;
    try {
      descriptor = openTemporary(plan);
      writeAll(descriptor, Buffer.from(text, 'utf8'));
      fileSystem.fsyncSync(descriptor);
      closeQuietly(descriptor);
      descriptor = undefined;
      if (plan.mode !== undefined) {
        fileSystem.chmodSync(plan.temporaryPath, plan.mode);
      }
      renameWithRetry(plan.temporaryPath, plan.target);
      return {outcome: {kind: 'written'}};
    } catch (error) {
      if (descriptor !== undefined) {
        closeQuietly(descriptor);
      }
      removeQuietly(plan);
      const failure = storageFailure(errorCode(error));
      return {outcome: {failure, kind: 'failed'}, warning: {failure, kind: 'commit-failed'}};
    }
  };

  /** Writes the document atomically, describing any refusal for the reporter. */
  const write = (text: string): KeybindingsWriteAttempt => {
    const prepared = prepareWrite();
    return prepared.kind === 'refused' ? prepared.attempt : commitWrite(prepared.plan, text);
  };

  /** Removes temporary files a crashed write left beside the target. */
  const removeStaleTemporaryFiles = (): readonly KeybindingsCleanupWarning[] => {
    const resolution = resolveTarget();
    if (resolution.kind === 'unresolved') {
      return [{failure: storageFailure(errorCode(resolution.error)), kind: 'unresolved-target'}];
    }
    const directory = path.dirname(resolution.path);
    let names: string[];
    try {
      names = fileSystem.readdirSync(directory);
    } catch (error) {
      return [{failure: storageFailure(errorCode(error)), kind: 'directory-inspection'}];
    }
    const warnings: KeybindingsCleanupWarning[] = [];
    for (const name of names) {
      if (!isOwnTemporaryName(name)) {
        continue;
      }
      try {
        fileSystem.unlinkSync(path.join(directory, name));
      } catch (error) {
        warnings.push({failure: storageFailure(errorCode(error)), kind: 'remove-stale-temporary'});
      }
    }
    return warnings;
  };

  const reporting = {label: fileName, metrics: options.metrics, spans: options.spans, warn: options.warn};
  return withReporting({readRaw, removeStaleTemporaryFiles, write}, reporting);
};
