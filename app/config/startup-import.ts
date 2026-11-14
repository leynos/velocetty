/** @file The start-up sequence: capture stamps, prepare, import, settle stamps. */
/*
 * The composition root builds adapters; this module owns the order in which
 * they run. That order is a law, not an accident: the baseline is captured
 * before the import reads anything, and only the files the import wrote are
 * settled afterwards. Splitting it out keeps the law testable with plain
 * functions instead of the whole application.
 */
import type {ConfigImportResult} from './import';
import type {WatchedFileStamps, WrittenWatchedFile} from './watched-file-stamp';

/** The collaborators one start-up run drives, in the order it drives them. */
export type StartupImportDependencies = Readonly<{
  /**
   * Reads every watched file's identity.
   *
   * Called before the import reads anything: a save that lands between the
   * import's read and the watcher's baseline must still look like a change.
   */
  readonly captureStamps: () => WatchedFileStamps;
  /** Creates the configuration tree and clears a stale temporary file. */
  readonly prepare: () => void;
  /** Runs the start-up import once. */
  readonly importConfiguration: () => ConfigImportResult;
  /**
   * Adopts the identity of each file the import wrote.
   *
   * Receives the baseline captured before the import, not the post-import
   * filesystem, so a file a concurrent writer replaced keeps its earlier
   * identity and still reconciles at readiness.
   */
  readonly settleStamps: (stamps: WatchedFileStamps, writtenFiles: readonly WrittenWatchedFile[]) => WatchedFileStamps;
}>;

/** What one start-up run produced, for the composition root to record. */
export type StartupImportOutcome = Readonly<{
  readonly imported: ConfigImportResult;
  readonly startupStamps: WatchedFileStamps;
}>;

/**
 * Runs the start-up sequence and returns what the watcher must watch from.
 *
 * A thrown import propagates unchanged and skips settlement: the caller counts
 * and records the failure, and no watcher starts.
 *
 * @param dependencies - The stamped, importing, and settling collaborators.
 * @returns The import result plus the baseline the watcher starts from.
 *
 * @example
 * ```ts
 * const {imported, startupStamps} = runStartupImport({
 *   captureStamps: () => captureWatchedFileStamps(watchedFiles),
 *   prepare: createTree,
 *   importConfiguration: () => importConfiguration('startup'),
 *   settleStamps: settleWatchedFileStamps
 * });
 * watch(startupStamps);
 * ```
 */
export const runStartupImport = (dependencies: StartupImportDependencies): StartupImportOutcome => {
  const capturedStamps = dependencies.captureStamps();
  dependencies.prepare();
  const imported = dependencies.importConfiguration();
  const startupStamps = dependencies.settleStamps(capturedStamps, imported.writtenFiles);
  return {imported, startupStamps};
};
