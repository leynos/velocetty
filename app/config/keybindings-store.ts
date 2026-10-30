/** @file Atomic file adapter for `keybindings.json5` (KB-STORE-1). */
/*
 * Writes never truncate the user's file. The replacement is written to a
 * temporary file beside the real target, flushed, given the target's mode, and
 * renamed over it. A read-only target is refused before anything is created,
 * because a POSIX rename would otherwise replace it whenever the directory is
 * writable. A failure at any step removes the temporary file and leaves the
 * target untouched, with no direct-overwrite fallback.
 */
import * as fs from 'node:fs';
import path from 'node:path';

import {isObject, isString} from '../utils/runtime-guards';
import type {KeybindingsReadOutcome, KeybindingsStore, KeybindingsWriteOutcome} from './keybindings';

/** The filesystem subset the adapter uses; injected so tests can fail each step. */
export type KeybindingsFileSystem = Pick<
  typeof import('node:fs'),
  | 'accessSync'
  | 'constants'
  | 'realpathSync'
  | 'readFileSync'
  | 'openSync'
  | 'writeSync'
  | 'fsyncSync'
  | 'closeSync'
  | 'statSync'
  | 'lstatSync'
  | 'readlinkSync'
  | 'chmodSync'
  | 'renameSync'
  | 'unlinkSync'
  | 'readdirSync'
>;

type FileKeybindingsStoreOptions = {
  readonly filePath: string;
  readonly fs?: KeybindingsFileSystem;
  readonly sleep?: (milliseconds: number) => void;
  readonly warn?: typeof console.warn;
};

/** Four gaps between five attempts, keeping retries within about 200ms. */
const RENAME_RETRY_DELAY_MS = 40;
const MAX_RENAME_ATTEMPTS = 5;
const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Bounds link chasing so a symlink cycle cannot spin the resolver forever. */
const MAX_SYMLINK_HOPS = 40;

/** The `<pid>.<counter>` middle segment of a temporary file name. */
const TEMPORARY_SEQUENCE = /^\d+\.\d+$/;

const errorCode = (error: unknown): string | undefined => {
  if (!isObject(error) || !('code' in error)) {
    return undefined;
  }
  const {code} = error;
  return isString(code) ? code : undefined;
};

/** One replacement: the resolved target, its temporary sibling, and the mode to keep. */
type ReplacementPlan = Readonly<{
  readonly mode: number | undefined;
  readonly target: string;
  readonly temporaryPath: string;
}>;

/** Blocks the calling thread; only used between transient Windows retries. */
const defaultSleep = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

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
   * a link (or does not exist) is reached.
   */
  const followLinks = (candidate: string, hops: number): string => {
    if (hops >= MAX_SYMLINK_HOPS) {
      return candidate;
    }
    let isLink = false;
    try {
      isLink = fileSystem.lstatSync(candidate).isSymbolicLink();
    } catch {
      return candidate;
    }
    if (!isLink) {
      return candidate;
    }
    let linkTarget: string;
    try {
      linkTarget = fileSystem.readlinkSync(candidate);
    } catch {
      return candidate;
    }
    return followLinks(path.resolve(path.dirname(candidate), linkTarget), hops + 1);
  };

  /** The symlink's target when there is one, so the link itself survives. */
  const resolveTarget = (): string => {
    try {
      return fileSystem.realpathSync(options.filePath);
    } catch {
      return followLinks(options.filePath, 0);
    }
  };

  /** The target a replacement will land on, plus the mode it currently has. */
  const resolveReplacementTarget = () => {
    const target = resolveTarget();
    try {
      return {mode: fileSystem.statSync(target).mode & 0o777, path: target};
    } catch {
      return {mode: undefined, path: target};
    }
  };

  /**
   * Describes one atomic replacement, allocating the temporary name to use.
   *
   * The counter makes a name unique within the process, so a failed attempt's
   * leftover cannot be mistaken for the next attempt's file.
   */
  const planReplacement = (): ReplacementPlan => {
    const {mode, path: target} = resolveReplacementTarget();
    temporaryCounter += 1;
    const temporaryPath = path.join(path.dirname(target), `.${fileName}.${process.pid}.${temporaryCounter}.tmp`);
    return {mode, target, temporaryPath};
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

  const read = (): KeybindingsReadOutcome => {
    try {
      return {kind: 'present', text: fileSystem.readFileSync(options.filePath, 'utf8')};
    } catch (error) {
      return errorCode(error) === 'ENOENT' ? {kind: 'missing'} : {kind: 'unreadable', error};
    }
  };

  const renameWithRetry = ({target, temporaryPath}: ReplacementPlan): void => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        fileSystem.renameSync(temporaryPath, target);
        return;
      } catch (error) {
        const code = errorCode(error);
        const canRetry = code !== undefined && TRANSIENT_RENAME_CODES.has(code);
        if (!canRetry || attempt + 1 >= MAX_RENAME_ATTEMPTS) {
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

  const write = (text: string): KeybindingsWriteOutcome => {
    const plan = planReplacement();
    if (!canReplaceTarget(plan)) {
      return {error: new Error(`Refusing to replace read-only file "${plan.target}".`), kind: 'failed'};
    }
    let descriptor: number | undefined;
    try {
      descriptor =
        plan.mode === undefined
          ? fileSystem.openSync(plan.temporaryPath, 'wx')
          : fileSystem.openSync(plan.temporaryPath, 'wx', plan.mode);
      writeAll(descriptor, Buffer.from(text, 'utf8'));
      fileSystem.fsyncSync(descriptor);
      fileSystem.closeSync(descriptor);
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
      return {kind: 'failed', error};
    }
  };

  /** Removes temporary files a crashed write left beside the target. */
  const removeStaleTemporaryFiles = (): void => {
    const target = resolveTarget();
    const directory = path.dirname(target);
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

  return {location: options.filePath, read, removeStaleTemporaryFiles, write};
};
