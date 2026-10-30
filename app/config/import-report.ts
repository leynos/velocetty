/** @file What each configuration file did, and whether a reload deserves a notice. */
/*
 * The importer reports per-file outcomes so the composition root can decide
 * whether "Configuration updated" is honest. Keeping the predicate separate
 * from the importer lets the watcher use it without pulling in the importer's
 * filesystem dependencies.
 */

/** What each configuration file did during an import. */
export type ConfigImportReport = {
  readonly config: 'applied' | 'fallback';
  readonly keybindings: 'applied' | 'kept' | 'unchanged';
};

/**
 * Whether a reload deserves the "Configuration updated" notification.
 *
 * A file that fell back shows its own error, so claiming an update would be
 * false. A kept keybindings file has already shown its diagnostic.
 *
 * @example
 * ```ts
 * shouldAnnounceReload({config: 'applied', keybindings: 'applied'}); // true
 * shouldAnnounceReload({config: 'fallback', keybindings: 'applied'}); // false
 * ```
 */
export const shouldAnnounceReload = (report: ConfigImportReport): boolean => {
  const hasApplied = report.config === 'applied' || report.keybindings === 'applied';
  const hasFallback = report.config === 'fallback' || report.keybindings === 'kept';
  return hasApplied && !hasFallback;
};
