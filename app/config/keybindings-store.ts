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

/** The `<pid>.<counter>` middle segment of a temporary file name. */
const TEMPORARY_SEQUENCE = /^\d+\.\d+$/;

const errorCode = (error: unknown): string | undefined => {
  if (!isObject(error) || !('code' in error)) {
    return undefined;
  }
  const {code} = error;
  return isString(code) ? code : undefined;
};

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

  /** The symlink's target when there is one, so the link itself survives. */
  const resolveTarget = (): string => {
    try {
      return fileSystem.realpathSync(options.filePath);
    } catch {
      return options.filePath;
    }
  };

  const existingMode = (target: string): number | undefined => {
    try {
      return fileSystem.statSync(target).mode & 0o777;
    } catch {
      return undefined;
    }
  };

  /**
   * Whether an existing target may be replaced.
   *
   * A missing target is created, so it counts as writable. On POSIX a rename
   * over a read-only file succeeds whenever the directory is writable, so the
   * target's own permission must be checked before the temporary file is made;
   * otherwise KB-STORE-1's "read-only target reports failed" would not hold.
   */
  const isWritableTarget = (target: string): boolean => {
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

  const renameWithRetry = (from: string, to: string): void => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        fileSystem.renameSync(from, to);
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

  const write = (text: string): KeybindingsWriteOutcome => {
    const target = resolveTarget();
    if (!isWritableTarget(target)) {
      return {error: new Error(`Refusing to replace read-only file "${target}".`), kind: 'failed'};
    }
    temporaryCounter += 1;
    const temporaryPath = path.join(path.dirname(target), `.${fileName}.${process.pid}.${temporaryCounter}.tmp`);
    const mode = existingMode(target);
    let descriptor: number | undefined;
    try {
      descriptor =
        mode === undefined ? fileSystem.openSync(temporaryPath, 'wx') : fileSystem.openSync(temporaryPath, 'wx', mode);
      const buffer = Buffer.from(text, 'utf8');
      let offset = 0;
      while (offset < buffer.length) {
        const written = fileSystem.writeSync(descriptor, buffer, offset, buffer.length - offset);
        if (written <= 0) {
          throw new Error('Short write while saving keybindings.');
        }
        offset += written;
      }
      fileSystem.fsyncSync(descriptor);
      fileSystem.closeSync(descriptor);
      descriptor = undefined;
      if (mode !== undefined) {
        fileSystem.chmodSync(temporaryPath, mode);
      }
      renameWithRetry(temporaryPath, target);
      return {kind: 'written'};
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fileSystem.closeSync(descriptor);
        } catch {
          // The descriptor may already be closed; the write outcome is failure either way.
        }
      }
      try {
        fileSystem.unlinkSync(temporaryPath);
      } catch {
        // Already removed, or never created; the caller only needs the failure.
      }
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
