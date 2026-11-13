/** @file Reads and compares a watched configuration file's identity. */
/*
 * Readiness reconciliation asks whether a watched file changed during the
 * watcher's initial scan. Treating a failed inspection as "absent" made two
 * failures compare equal, so a save that landed while inspection was failing
 * could go unreconciled. A stamp therefore records an inspection failure as
 * its own state, and an unknown identity never compares equal to anything,
 * including another unknown one.
 *
 * The baseline is captured before the start-up import reads the files, not
 * after it. Capturing afterwards would let a save that lands between the
 * import's read and the capture describe the file's new identity while the
 * application holds the old content, so the scan would see no difference and
 * the change would never be reconciled. Capturing first can only cost a
 * redundant reload; it cannot miss one. A file start-up itself wrote is then
 * settled against the text the import applied: its new identity is adopted
 * only while the file still holds that text, so an edit landing in between
 * keeps the earlier identity and is still reconciled.
 */
import {readFileSync, statSync} from 'node:fs';

import {errorCode} from '../utils/error-code';

/** One watched file's identity at one instant. */
export type WatchedFileStamp =
  | Readonly<{kind: 'present'; mtimeMs: number; size: number}>
  | Readonly<{kind: 'absent'}>
  | Readonly<{kind: 'unreadable'}>;

/** Every watched file's identity at the moment the baseline was captured. */
export type WatchedFileStamps = ReadonlyMap<string, WatchedFileStamp>;

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
 * @param before - The identity the baseline holds for the file.
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
 * Reads every watched file's identity now.
 *
 * The caller captures this before the start-up import reads the files, so the
 * baseline can only be older than what the import applied.
 *
 * @param fileNames - The absolute paths the watcher covers.
 * @param statFile - The inspection call; defaults to `statSync`.
 * @returns Each file's identity, keyed by path.
 *
 * @example
 * ```ts
 * const stamps = captureWatchedFileStamps(['/tmp/config.json5']);
 * stamps.get('/tmp/config.json5'); // {kind: 'present', mtimeMs: 12, size: 34}
 * ```
 */
export const captureWatchedFileStamps = (
  fileNames: readonly string[],
  statFile: StatFile = statSync
): WatchedFileStamps => new Map(fileNames.map((fileName) => [fileName, readWatchedFileStamp(fileName, statFile)]));

/** A file the start-up import wrote, with the exact text the import applied. */
export type WrittenWatchedFile = Readonly<{path: string; text: string}>;

/** Reads a file's text; injectable so a test can script the comparison. */
export type ReadWatchedFile = (filePath: string) => string;

/**
 * Reads a written file's identity, but only while it still holds our text.
 *
 * The inspection comes before the read on purpose. An edit that lands between
 * them makes the comparison fail, so no identity is adopted; an edit that lands
 * after the read leaves an identity readiness will see as newer. Reading first
 * would let an edit slip between the two and be recorded as the content the
 * application applied, which is the one failure this settlement exists to
 * prevent.
 *
 * @param file - The written path and the text the import applied.
 * @param readFile - The text reader.
 * @param statFile - The inspection call.
 * @returns The file's current identity, or `undefined` when it cannot be
 *   verified as still holding the applied text.
 */
const verifiedWrittenStamp = (
  {path: filePath, text}: WrittenWatchedFile,
  readFile: ReadWatchedFile,
  statFile: StatFile
): WatchedFileStamp | undefined => {
  const stamp = readWatchedFileStamp(filePath, statFile);
  if (stamp.kind !== 'present') {
    return undefined;
  }
  try {
    return readFile(filePath) === text ? stamp : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Settles the baseline for the files start-up wrote, without hiding a later edit.
 *
 * Start-up creates `config.json5` and `keybindings.json5` itself, and the
 * application holds that written content, so those files are the one
 * difference the baseline must not reconcile. Adopting their identity is only
 * safe while each file still holds the text the import applied. Anything that
 * changed the file in between — another process replacing it, a dotfile
 * deploy, a crash truncating it — leaves the identity describing content the
 * application never applied, and readiness would compare the file against
 * itself and skip the reload. Such a file keeps the pre-import identity, so
 * the difference stays visible and readiness reloads.
 *
 * @param stamps - The baseline captured before the import.
 * @param writtenFiles - The files the import created and the text it applied.
 * @param readFile - The text reader; defaults to `readFileSync` as UTF-8.
 * @param statFile - The inspection call; defaults to `statSync`.
 * @returns The baseline, with only verified written files re-stamped.
 *
 * @example
 * ```ts
 * const settled = settleWatchedFileStamps(stamps, [{path: '/tmp/keybindings.json5', text: '{}\n'}]);
 * settled.get('/tmp/keybindings.json5'); // the seeded file's identity
 * ```
 */
export const settleWatchedFileStamps = (
  stamps: WatchedFileStamps,
  writtenFiles: readonly WrittenWatchedFile[],
  readFile: ReadWatchedFile = (filePath) => readFileSync(filePath, 'utf8'),
  statFile: StatFile = statSync
): WatchedFileStamps => {
  const settled = new Map(stamps);
  for (const writtenFile of writtenFiles) {
    const stamp = verifiedWrittenStamp(writtenFile, readFile, statFile);
    if (stamp !== undefined) {
      settled.set(writtenFile.path, stamp);
    }
  }
  return settled;
};

/**
 * Builds the readiness predicate that decides whether to reload once.
 *
 * Chokidar suppresses events for files it finds during its initial scan, so a
 * save that lands mid-scan would otherwise wait for the next edit. The
 * returned predicate answers the watcher's readiness callback: it compares
 * each watched file against the baseline the caller captured before the
 * start-up import.
 *
 * A file that cannot be inspected counts as changed. That costs one reload
 * when a file is genuinely unreadable, and avoids silently keeping a stale
 * configuration when the inspection itself is what failed.
 *
 * @param baseline - The identity recorded before the start-up import, with any
 *   file the import wrote settled to what it applied.
 * @param statFile - The inspection call; defaults to `statSync`.
 * @returns A predicate that is true when at least one watched file moved.
 *
 * @example
 * ```ts
 * const reconcile = createWatchedFileReconciler(captureWatchedFileStamps(['/tmp/config.json5']));
 * reconcile(); // false when the file is unchanged
 * ```
 */
export const createWatchedFileReconciler = (
  baseline: WatchedFileStamps,
  statFile: StatFile = statSync
): (() => boolean) => {
  const entries = [...baseline];
  return () => entries.some(([fileName, before]) => !stampsMatch(before, readWatchedFileStamp(fileName, statFile)));
};
