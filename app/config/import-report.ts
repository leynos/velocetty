/** @file What each configuration file did, and whether a reload deserves a notice. */
/*
 * The importer reports per-file outcomes so the composition root can decide
 * whether "Configuration updated" is honest. Keeping the predicate separate
 * from the importer lets the watcher use it without pulling in the importer's
 * filesystem dependencies.
 */
import isEqual from 'lodash/isEqual';

import type {KeybindingsLoadOutcome} from './keybindings-ports';

/** A notification sink shared by the configuration modules. */
export type ConfigImportNotify = (title: string, body?: string, details?: {error?: unknown}) => void;

/** Which tree supplied the active configuration file. */
export type ConfigSourceKind = 'development' | 'velocetty' | 'hyper';

/**
 * Why the user configuration fell back, in a closed vocabulary.
 *
 * `parse` means the file was read but rejected; `read` means it could not be
 * read at all. A record that named only "fallback" could not tell an editor
 * typo from a permissions problem without opening the file again.
 */
export type ConfigFallbackCause = 'parse' | 'read';

/**
 * What a comparison of the file on disk with the writer's record concluded.
 *
 * `unreadable` is its own case: the reload cannot be attributed to the writer,
 * so it is announced, and the watcher names the failed check in one bounded
 * line rather than mapping the failure onto "external".
 */
export type SelfWriteVerdict = 'self-write' | 'external' | 'unreadable';

/** What each configuration file did during an import. */
export type ConfigImportReport = {
  readonly config: 'applied' | 'fallback';
  /** Present only for a fallback, and only when the cause is known. */
  readonly configCause?: ConfigFallbackCause;
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
  /** Why the config fell back; absent when it applied or the cause is unknown. */
  readonly configCause?: ConfigFallbackCause;
  /** Which tree supplied the active configuration file. */
  readonly configSource: ConfigSourceKind;
  /** What a fallback fell back to; absent unless the config fell back. */
  readonly fallbackBasis?: 'defaults';
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
 * Who caused a reload, as far as the watcher can tell.
 *
 * The config text hash alone says only that the active config file still holds
 * the writer's last output. It cannot say whether the same reload also picked
 * up an edit to another watched file, so the keybindings half is tracked
 * separately.
 */
export type ReloadOrigin = {
  /** The settings writer produced the config file now on disk. */
  readonly isSelfWrite: boolean;
  /** The reload applied keymaps that differ from the ones already in effect. */
  readonly hasKeybindingsChange: boolean;
};

/**
 * Reports whether a reload changed the keymaps in effect.
 *
 * The keybindings service reports `applied` for every successful read, so the
 * coarse report cannot tell a reload that re-read an unchanged file from one
 * that picked up an edit: comparing the keymaps in effect before and after is
 * what distinguishes them. An unknown baseline counts as a change, so a reload
 * the watcher cannot attribute is announced rather than hidden.
 *
 * @param before - The keymaps in effect before the reload, when known.
 * @param after - The keymaps the reload applied.
 * @returns True when the two sets differ, or the earlier set is unknown.
 *
 * @example
 * keymapsDiffer({'window:new': ['ctrl+n']}, {'window:new': ['ctrl+n']}); // false
 * keymapsDiffer({'window:new': ['ctrl+n']}, {'window:new': ['ctrl+shift+n']}); // true
 */
export const keymapsDiffer = (
  before: Readonly<Record<string, readonly string[]>> | undefined,
  after: Readonly<Record<string, readonly string[]>>
): boolean => before === undefined || !isEqual(before, after);

/**
 * Decides whether a reload is announced to the user.
 *
 * A reload the application wrote itself updates the renderer silently: the
 * user just made that change in the settings tab, and announcing it as an
 * external update would be noise. That silence is scoped to a reload whose
 * only change was the writer's config edit. When an external keybindings edit
 * lands in the same debounced reload, the user did not make that change in the
 * settings tab, so the reload is announced.
 *
 * @param report - What the import decided.
 * @param origin - Whether the writer produced the config change, and whether
 *   the same reload also changed the keymaps.
 * @returns True only when the import applied and the app did not cause all of
 *   the change.
 *
 * @example
 * shouldNotifyReload({config: 'applied', keybindings: 'applied'}, {
 *   hasKeybindingsChange: false,
 *   isSelfWrite: true
 * }); // false
 */
export const shouldNotifyReload = (report: ConfigImportReport, origin: ReloadOrigin): boolean =>
  shouldAnnounceReload(report) && !(origin.isSelfWrite && !origin.hasKeybindingsChange);

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
 * Describes the configuration half of a decision, including its source.
 *
 * A fallback whose cause is unknown still renders as `config=fallback`; the
 * cause and the fallback basis are omitted rather than guessed.
 */
const describeConfigDecision = (decision: ImportDecision): string => {
  const fields = [`config=${decision.config}`];
  if (decision.configCause !== undefined) {
    fields.push(`cause=${decision.configCause}`);
  }
  fields.push(`configSource=${decision.configSource}`);
  if (decision.fallbackBasis !== undefined) {
    fields.push(`fallbackBasis=${decision.fallbackBasis}`);
  }
  return fields.join(' ');
};

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
 *   config: 'fallback',
 *   configCause: 'parse',
 *   configSource: 'velocetty',
 *   fallbackBasis: 'defaults',
 *   keybindings: {kind: 'applied', keymaps: {}, origin: 'file'},
 *   phase: 'reload'
 * });
 * // 'phase=reload config=fallback cause=parse configSource=velocetty fallbackBasis=defaults keybindings=applied origin=file announced=false'
 * ```
 */
export const describeImportDecision = (decision: ImportDecision): string =>
  `phase=${decision.phase} ${describeConfigDecision(decision)} ${describeKeybindingsDecision(decision.keybindings)} announced=${decision.announced}`;
