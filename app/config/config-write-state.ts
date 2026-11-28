/**
 * @file Process-wide state shared by the config writer and the watcher.
 *
 * The revision counter lets the settings renderer discard an older snapshot.
 * The hash of the last self-written text lets the watcher refresh subscribers
 * without showing a "configuration reloaded" notification for the app's own
 * write. Both live here so the writer and `app/config.ts` observe one value.
 *
 * The singleton is deliberate: both consumers run in the one main process and
 * must agree on the same revision and hash, and a second instance would silently
 * disable self-write detection. `test/unit/config-write-state.test.ts` and
 * `test/unit/config-watch-selfwrite.test.ts` cover it directly, so the state is
 * tested rather than hidden behind an ambient import.
 */

import {createHash} from 'node:crypto';

let revision = 0;
let lastWrittenTextHash: string | null = null;

/**
 * Hashes config text for self-write detection.
 *
 * @param text - The document text.
 * @returns The SHA-256 digest in hexadecimal.
 *
 * @example
 * hashConfigText('{}').length; // 64
 */
export const hashConfigText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Allocates the next config revision.
 *
 * @returns The new revision, starting at one.
 *
 * @example
 * nextConfigRevision() > 0; // true
 */
export const nextConfigRevision = (): number => {
  revision += 1;
  return revision;
};

/**
 * Reads the current revision without advancing it.
 *
 * @returns The most recently allocated revision.
 *
 * @example
 * currentConfigRevision(); // 0 before any write or reload
 */
export const currentConfigRevision = (): number => revision;

/**
 * Records the text the writer just wrote.
 *
 * @param text - The exact text written to disk.
 *
 * @example
 * recordWrittenText('{}');
 * getLastWrittenTextHash() === hashConfigText('{}'); // true
 */
export const recordWrittenText = (text: string): void => {
  lastWrittenTextHash = hashConfigText(text);
};

/**
 * Reads the hash of the last self-written text.
 *
 * @returns The hash, or null when this process has not written yet.
 *
 * @example
 * getLastWrittenTextHash(); // null on a fresh process
 */
export const getLastWrittenTextHash = (): string | null => lastWrittenTextHash;

/**
 * Clears both counters. Intended only for tests.
 *
 * @example
 * resetConfigWriteState();
 * currentConfigRevision(); // 0
 */
export const resetConfigWriteState = (): void => {
  revision = 0;
  lastWrittenTextHash = null;
};
