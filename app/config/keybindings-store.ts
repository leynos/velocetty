/** @file Atomic file adapter for `keybindings.json5` (KB-STORE-1). */
/*
 * Writes go to a temporary sibling that is flushed, given the target's mode,
 * and renamed over it. A read-only target is refused before anything is
 * created, and a failure removes the temporary file without overwriting.
 */
import * as fs from 'node:fs';
import path from 'node:path';

import {isObject, isString} from '../utils/runtime-guards';
import type {
  KeybindingsReadOutcome,
  KeybindingsStorageFailure,
  KeybindingsStore,
  KeybindingsWriteOutcome
} from './keybindings-ports';
import type {FileKeybindingsStoreOptions, RawRead, RenameFailureCategory} from './keybindings-store-contract';

export type {
  FileKeybindingsStoreOptions,
  KeybindingsFileSystem,
  RenameFailureCategory,
  RenameRetryEvent
} from './keybindings-store-contract';

/** Four gaps between five attempts, keeping retries within about 200ms. */
const RENAME_RETRY_DELAY_MS = 40;
const MAX_RENAME_ATTEMPTS = 5;
const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Bounds link chasing so a symlink cycle cannot spin the resolver forever. */
const MAX_SYMLINK_HOPS = 40;

/** The `<pid>.<counter>` middle segment of a temporary file name. */
const TEMPORARY_SEQUENCE = /^\d+\.\d+$/;

/** Maps an errno code onto the closed category vocabulary. */
const renameFailureCategory = (code: string | undefined): RenameFailureCategory => {
  if (code === 'EPERM' || code === 'EACCES') {
    return 'permission';
  }
  return code === 'EBUSY' ? 'busy' : 'other';
};

/** Reads a Node-style errno code without trusting the thrown value's shape. */
const errorCode = (error: unknown): string | undefined => {
  if (!isObject(error) || !('code' in error)) {
    return undefined;
  }
  const {code} = error;
  return isString(code) ? code : undefined;
};

/** The errno codes with a dedicated port category; adding one is data, not a new disjunct. */
const STORAGE_FAILURES = new Map<string, KeybindingsStorageFailure>([
  ['EACCES', 'permission'],
  ['EPERM', 'permission'],
  ['EROFS', 'permission'],
  ['ENOENT', 'missing']
]);

/** Maps a raw errno code onto the port's bounded failure vocabulary. */
const storageFailure = (code: string | undefined): KeybindingsStorageFailure =>
  (code === undefined ? undefined : STORAGE_FAILURES.get(code)) ?? 'other';

/** One replacement: the resolved target, its temporary sibling, and the mode to keep. */
type ReplacementPlan = Readonly<{
  readonly mode: number | undefined;
  readonly target: string;
  readonly temporaryPath: string;
}>;

/** A vetted replacement target, or the refusal the caller must see. */
type PreparedWrite = Readonly<
  {kind: 'ready'; plan: ReplacementPlan} | {kind: 'refused'; outcome: KeybindingsWriteOutcome}
>;

/**
 * The path a write may land on, or why no safe path could be established.
 *
 * A write is only safe against a path known not to be a symlink, or genuinely
 * absent; anything else fails closed rather than replacing a link.
 */
type TargetResolution = Readonly<{kind: 'resolved'; path: string}> | Readonly<{kind: 'unresolved'; error: unknown}>;

/** Blocks the calling thread; only used between transient Windows retries. */
const defaultSleep = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/**
 * Creates the filesystem adapter behind `KeybindingsStore`.
 *
 * Writes go to a temporary sibling and are renamed into place. A symlinked
 * target is resolved first, so the replacement lands on what the link points
 * at and the link itself survives, including a dangling chain. A symlink cycle,
 * an over-long chain, a read-only target, or any other resolution failure is
 * refused before anything is created. A failed `statSync` is not fatal: the
 * temporary file simply takes the default mode. Stale temporary-file cleanup
 * is best-effort and reports its failures as warnings.
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
  const sleep = options.sleep ?? defaultSleep;
  const warnFn = options.warn ?? console.warn;
  const fileName = path.basename(options.filePath);
  const temporaryPrefix = `.${fileName}.`;
  let temporaryCounter = 0;

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
   * `keybindings.json5` is exactly that before the target file exists. Writing
   * to the link's own path would rename a regular file over the link and break
   * the user's setup, so the chain is followed by hand until a path that is not
   * a link, or that is genuinely absent, is reached.
   *
   * Resolution fails closed. A link the walk could not follow — a cycle, or a
   * chain longer than the bound — is not a writable target, because renaming
   * over it would replace the user's link with a regular file. Likewise, an
   * inspection error means the path is unknown rather than free to create.
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
  /** Reads the file for the service, recording a span and warning on failure. */
  const read = (): KeybindingsReadOutcome => {
    const finishSpan = options.spans?.begin('keybindings-read');
    const {error, outcome} = readRaw();
    // The port keeps only a bounded reason; the raw error stays diagnosable here.
    if (error !== undefined) warnFn(`[config-keybindings] Couldn't read "${options.filePath}".`, error);
    finishSpan?.(outcome.kind);
    return outcome;
  };

  /** Reads the file without recording a span or warning. */
  const peek = (): KeybindingsReadOutcome => readRaw().outcome;

  /**
   * Renames the temporary file into place, retrying only transient failures.
   *
   * Windows can report a busy destination while an editor or antivirus holds
   * it. Each attempt is reported so the retry counter has a bounded reason.
   */
  const renameWithRetry = ({target, temporaryPath}: ReplacementPlan): void => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        fileSystem.renameSync(temporaryPath, target);
        return;
      } catch (error) {
        const code = errorCode(error);
        const canRetry = code !== undefined && TRANSIENT_RENAME_CODES.has(code);
        const exhausted = !canRetry || attempt >= MAX_RENAME_ATTEMPTS;
        options.onRetry?.({attempt, category: renameFailureCategory(code), exhausted});
        if (exhausted) {
          throw error;
        }
        sleep(RENAME_RETRY_DELAY_MS);
      }
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

  /** Resolves and vets the replacement target, reporting any refusal. */
  const prepareWrite = (): PreparedWrite => {
    const resolution = resolveTarget();
    if (resolution.kind === 'unresolved') {
      warnFn(`[config-keybindings] Couldn't resolve "${options.filePath}" for writing.`, resolution.error);
      return {kind: 'refused', outcome: {failure: storageFailure(errorCode(resolution.error)), kind: 'failed'}};
    }
    const plan = planReplacement(resolution.path);
    if (!canReplaceTarget(plan)) {
      // The synthetic refusal is logged for diagnosis; the port sees the category.
      warnFn(`[config-keybindings] Refused to replace read-only file "${plan.target}".`);
      return {kind: 'refused', outcome: {failure: 'permission', kind: 'failed'}};
    }
    return {kind: 'ready', plan};
  };

  /** Opens the temporary sibling exclusively, with the target's mode when known. */
  const openTemporary = (plan: ReplacementPlan): number =>
    plan.mode === undefined
      ? fileSystem.openSync(plan.temporaryPath, 'wx')
      : fileSystem.openSync(plan.temporaryPath, 'wx', plan.mode);

  /** Fills, flushes, and renames the temporary file over the resolved target. */
  const commitWrite = (plan: ReplacementPlan, text: string): KeybindingsWriteOutcome => {
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
      renameWithRetry(plan);
      return {kind: 'written'};
    } catch (error) {
      if (descriptor !== undefined) {
        closeQuietly(descriptor);
      }
      removeQuietly(plan);
      warnFn(`[config-keybindings] Couldn't write "${options.filePath}".`, error);
      return {failure: storageFailure(errorCode(error)), kind: 'failed'};
    }
  };

  /**
   * Writes the document atomically, refusing any unsafe replacement target.
   *
   * The temporary file is created exclusively, fully written, flushed, and
   * renamed, so either the old file or the complete new one is visible.
   */
  const write = (text: string): KeybindingsWriteOutcome => {
    const finishSpan = options.spans?.begin('keybindings-write');
    const prepared = prepareWrite();
    if (prepared.kind === 'refused') {
      finishSpan?.('failed');
      return prepared.outcome;
    }
    const outcome = commitWrite(prepared.plan, text);
    finishSpan?.(outcome.kind === 'written' ? 'written' : 'failed');
    return outcome;
  };

  /** Removes temporary files a crashed write left beside the target. */
  const removeStaleTemporaryFiles = (): void => {
    const resolution = resolveTarget();
    if (resolution.kind === 'unresolved') {
      warnFn(
        `[config-keybindings] Couldn't resolve "${options.filePath}" to inspect it for stale temporary files.`,
        resolution.error
      );
      return;
    }
    const directory = path.dirname(resolution.path);
    let names: string[];
    try {
      names = fileSystem.readdirSync(directory);
    } catch (error) {
      warnFn(`[config-keybindings] Couldn't inspect "${directory}" for stale temporary files.`, error);
      return;
    }
    for (const name of names) {
      if (!isOwnTemporaryName(name)) {
        continue;
      }
      try {
        fileSystem.unlinkSync(path.join(directory, name));
      } catch (error) {
        warnFn(`[config-keybindings] Couldn't remove stale temporary file "${name}".`, error);
      }
    }
  };

  return {label: fileName, peek, read, removeStaleTemporaryFiles, write};
};
