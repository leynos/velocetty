/** @file Reads and compares a watched configuration file's identity. */
/*
 * Readiness reconciliation asks whether a watched file changed during the
 * watcher's initial scan. Treating a failed inspection as "absent" made two
 * failures compare equal, so a save that landed while inspection was failing
 * could go unreconciled. A stamp therefore records an inspection failure as
 * its own state, and an unknown identity never compares equal to anything,
 * including another unknown one.
 */
import {statSync} from 'node:fs';

import {errorCode} from '../utils/error-code';

/** One watched file's identity at one instant. */
export type WatchedFileStamp =
  | Readonly<{kind: 'present'; mtimeMs: number; size: number}>
  | Readonly<{kind: 'absent'}>
  | Readonly<{kind: 'unreadable'}>;

/** The file-inspection call the stamp reader uses; injectable so a test can script it. */
export type StatFile = (filePath: string) => Readonly<{mtimeMs: number; size: number}>;

/**
 * Reads one watched file's identity, distinguishing absence from failure.
 *
 * `ENOENT` is the only failure that says something about the file itself: it
 * was not there. Any other failure leaves the identity unknown, which must not
 * be treated as "still absent" or as equal to another failure.
 *
 * @param filePath - The file to inspect.
 * @param statFile - The inspection call; defaults to `statSync`.
 * @returns The file's size and modification time, or why it has none.
 *
 * @example
 * ```ts
 * readWatchedFileStamp('/tmp/config.json5', () => {
 *   throw Object.assign(new Error('denied'), {code: 'EACCES'});
 * }); // {kind: 'unreadable'}
 * ```
 */
export const readWatchedFileStamp = (filePath: string, statFile: StatFile = statSync): WatchedFileStamp => {
  try {
    const {mtimeMs, size} = statFile(filePath);
    return {kind: 'present', mtimeMs, size};
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? {kind: 'absent'} : {kind: 'unreadable'};
  }
};

/**
 * Compares two stamps, treating an unknown identity as never equal.
 *
 * Two absent readings match, because both say the file was not there. A
 * present reading matches only the same size and modification time. An
 * unreadable reading matches nothing, so a reconciliation that could not
 * inspect the file reloads rather than assuming nothing changed.
 *
 * @param before - The identity recorded after the start-up import.
 * @param after - The identity read at readiness.
 * @returns Whether the two readings describe the same state.
 *
 * @example
 * ```ts
 * stampsMatch({kind: 'unreadable'}, {kind: 'unreadable'}); // false
 * stampsMatch({kind: 'absent'}, {kind: 'absent'}); // true
 * ```
 */
export const stampsMatch = (before: WatchedFileStamp, after: WatchedFileStamp): boolean => {
  if (before.kind === 'unreadable' || after.kind === 'unreadable') {
    return false;
  }
  if (before.kind === 'present' && after.kind === 'present') {
    return before.mtimeMs === after.mtimeMs && before.size === after.size;
  }
  return before.kind === 'absent' && after.kind === 'absent';
};

/**
 * Builds the readiness predicate that decides whether to reload once.
 *
 * Chokidar suppresses events for files it finds during its initial scan, so a
 * save that lands mid-scan would otherwise wait for the next edit. The
 * returned predicate answers the watcher's readiness callback: it compares
 * each watched file against the reading taken when it was constructed, just
 * after the start-up import.
 *
 * A file that cannot be inspected counts as changed. That costs one reload
 * when a file is genuinely unreadable, and avoids silently keeping a stale
 * configuration when the inspection itself is what failed.
 *
 * @param fileNames - The absolute paths the watcher covers.
 * @param statFile - The inspection call; defaults to `statSync`.
 * @returns A predicate that is true when at least one watched file moved.
 *
 * @example
 * ```ts
 * const reconcile = createWatchedFileReconciler(['/tmp/config.json5']);
 * reconcile(); // false when the file is unchanged
 * ```
 */
export const createWatchedFileReconciler = (
  fileNames: readonly string[],
  statFile: StatFile = statSync
): (() => boolean) => {
  const stampsAfterImport = new Map(fileNames.map((fileName) => [fileName, readWatchedFileStamp(fileName, statFile)]));
  return () =>
    fileNames.some((fileName) => {
      const before = stampsAfterImport.get(fileName) ?? {kind: 'absent' as const};
      return !stampsMatch(before, readWatchedFileStamp(fileName, statFile));
    });
};
