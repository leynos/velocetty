/** @file What each configuration file did, and whether a reload deserves a notice. */
/*
 * The importer reports per-file outcomes so the composition root can decide
 * whether "Configuration updated" is honest. Keeping the predicate separate
 * from the importer lets the watcher use it without pulling in the importer's
 * filesystem dependencies.
 */
import type {KeybindingsLoadOutcome} from './keybindings';

/** What each configuration file did during an import. */
export type ConfigImportReport = {
  readonly config: 'applied' | 'fallback';
  readonly keybindings: 'applied' | 'kept' | 'unchanged';
};

/**
 * One import attempt, described for a bounded log record.
 *
 * The keybindings outcome is carried whole rather than flattened: its own
 * `origin`, `basis`, and `cause` are what distinguish a first-run seed from a
 * parse failure, and a second parallel vocabulary would let the two drift.
 */
export type ImportDecision = {
  readonly phase: 'reload' | 'startup';
  readonly config: 'applied' | 'fallback';
  readonly keybindings: KeybindingsLoadOutcome;
  /** Whether the "Configuration updated" notice was shown. */
  readonly announced: boolean;
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

/**
 * Describes the keybindings half of a decision in that outcome's own terms.
 *
 * `applied` names where the keymaps came from, and `kept` names both the basis
 * that survived and the cause, so a seed, an empty file, a parse failure, a
 * read failure, and a deferred bootstrap are five distinguishable states.
 */
const describeKeybindingsDecision = (outcome: KeybindingsLoadOutcome): string =>
  outcome.kind === 'applied'
    ? `keybindings=applied origin=${outcome.origin}`
    : `keybindings=kept basis=${outcome.basis} cause=${outcome.cause}`;

/**
 * Describes one import attempt as a single bounded log record.
 *
 * The composition root emits exactly one of these per attempt, including the
 * attempts that fail and the reloads whose user-facing notice is suppressed.
 *
 * @param decision - The phase, the config result, the keybindings outcome, and
 * whether a notice was shown.
 * @returns A one-line summary suitable for a log record.
 *
 * @example
 * ```ts
 * describeImportDecision({
 *   announced: false,
 *   config: 'applied',
 *   keybindings: {kind: 'applied', keymaps: {}, origin: 'file'},
 *   phase: 'reload'
 * });
 * // 'phase=reload config=applied keybindings=applied origin=file announced=false'
 * ```
 */
export const describeImportDecision = (decision: ImportDecision): string =>
  `phase=${decision.phase} config=${decision.config} ${describeKeybindingsDecision(decision.keybindings)} announced=${decision.announced}`;
