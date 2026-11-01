/** @file Presents keybindings notices as the user-facing strings the app shows. */
/*
 * The keybindings service works in bounded notices. This module is the edge
 * that turns them into notifications and diagnostics logs, keeping every
 * wording decision out of the service.
 */
import type {configValidationDiagnostic} from '@shared/types/config';
import type {ConfigImportNotify} from './import-report';
import type {KeybindingsBasis, KeybindingsNotice, KeybindingsReporter} from './keybindings-ports';

/**
 * Formats the first diagnostic as a sentence suffix for a notification.
 *
 * Keeping this in one place means start-up, reload, and the importer cannot
 * describe the same problem differently.
 *
 * @example
 * ```ts
 * describePrimaryDiagnostic([]); // ''
 * ```
 */
export const describePrimaryDiagnostic = (diagnostics: readonly configValidationDiagnostic[]): string => {
  const primaryDiagnostic = diagnostics.at(0);
  if (!primaryDiagnostic) {
    return '';
  }
  const docHint = primaryDiagnostic.docHint ? ` Hint: ${primaryDiagnostic.docHint}.` : '';
  const defaultHint = primaryDiagnostic.defaultHint ? ` Default: ${primaryDiagnostic.defaultHint}.` : '';
  return ` ${primaryDiagnostic.path}: ${primaryDiagnostic.message} Suggested fix: ${primaryDiagnostic.suggestedFix}.${docHint}${defaultHint}`;
};

/** A caller's sentence about a rejected file, plus the diagnostics behind it. */
export type PrimaryDiagnosticNotice = Readonly<{
  readonly baseMessage: string;
  readonly diagnostics: readonly configValidationDiagnostic[];
  readonly notify: ConfigImportNotify;
}>;

/** Notifies with a message followed by the first diagnostic, when there is one. */
export const notifyWithPrimaryDiagnostic = ({baseMessage, diagnostics, notify}: PrimaryDiagnosticNotice): void => {
  notify(`${baseMessage}${describePrimaryDiagnostic(diagnostics)}`);
};

/** What remains in effect after a rejected read, in the user's terms. */
const inEffectSentence = (basis: KeybindingsBasis): string =>
  basis === 'last-known-good' ? 'Keeping your previous shortcuts.' : 'Using default shortcuts until the file is fixed.';

/**
 * Maps one bounded notice onto the notification or log it has always produced.
 *
 * @example
 * ```ts
 * const report = createKeybindingsNotifier(notify);
 * report({basis: 'empty', failure: 'other', kind: 'unreadable-file'});
 * // notify("Couldn't read keybindings file. Using default shortcuts until the file is fixed.")
 * ```
 */
const presentNotice = (notice: KeybindingsNotice, notify: ConfigImportNotify, warn: typeof console.warn): void => {
  switch (notice.kind) {
    case 'invalid-file': {
      notify(
        `Couldn't parse keybindings file. ${inEffectSentence(notice.basis)}${describePrimaryDiagnostic(notice.diagnostics)}`
      );
      return;
    }
    case 'unreadable-file': {
      notify(`Couldn't read keybindings file. ${inEffectSentence(notice.basis)}`);
      return;
    }
    case 'seed-failed': {
      notify("Couldn't create a keybindings file. Check permissions and available disk space.");
      return;
    }
    case 'import-failed': {
      notify("Couldn't save keybindings file.");
      return;
    }
    case 'diagnostics': {
      warn('[config-keybindings] User keybindings diagnostics.', {
        diagnostics: notice.diagnostics,
        source: notice.label
      });
      return;
    }
  }
  // Exhaustiveness guard: a new notice kind cannot be presented silently.
  const unreachable: never = notice;
  return unreachable;
};

/**
 * Creates the reporter that presents the service's notices.
 *
 * @param notify - The application's notification sink.
 * @param warn - The sink for structured diagnostics; injectable for tests.
 * @returns A reporter that maps every notice onto the current user-visible
 * wording.
 */
export const createKeybindingsNotifier =
  (notify: ConfigImportNotify, warn: typeof console.warn = console.warn): KeybindingsReporter =>
  (notice) =>
    presentNotice(notice, notify, warn);
