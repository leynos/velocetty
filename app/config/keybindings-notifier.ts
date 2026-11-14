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
 * Ends `text` as a sentence without doubling a full stop the producer supplied.
 *
 * Diagnostic producers write their own sentence and may already close with a
 * full stop, so appending one unconditionally renders `..` to the user.
 *
 * @example
 * ```ts
 * asSentence('Rename the command.'); // 'Rename the command.'
 * asSentence('Rename the command'); // 'Rename the command.'
 * ```
 */
const asSentence = (text: string): string => (text.endsWith('.') ? text : `${text}.`);

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
  const docHint = primaryDiagnostic.docHint ? ` Hint: ${asSentence(primaryDiagnostic.docHint)}` : '';
  const defaultHint = primaryDiagnostic.defaultHint ? ` Default: ${asSentence(primaryDiagnostic.defaultHint)}` : '';
  return ` ${primaryDiagnostic.path}: ${primaryDiagnostic.message} Suggested fix: ${asSentence(primaryDiagnostic.suggestedFix)}${docHint}${defaultHint}`;
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

/** The closed set of shapes a keybindings diagnostic can describe. */
type DiagnosticKind = 'command' | 'document' | 'schema-key';

/**
 * Classifies a diagnostic without repeating its path.
 *
 * A diagnostic path is one of three shapes: the source label, or that label
 * followed by a line and column, for a document-level error; `/$schema` for
 * the reserved key; or a slash followed by a command identifier. Reporting the
 * shape keeps the identifier, and any file wording behind it, out of the
 * structured log.
 *
 * @example
 * ```ts
 * diagnosticKind('keybindings.json5', 'keybindings.json5'); // 'document'
 * diagnosticKind('keybindings.json5:1:15', 'keybindings.json5'); // 'document'
 * diagnosticKind('/$schema', 'keybindings.json5'); // 'schema-key'
 * diagnosticKind('/window:new', 'keybindings.json5'); // 'command'
 * ```
 */
const diagnosticKind = (path: string, sourceLabel: string): DiagnosticKind => {
  // A JSON5 syntax error reports its position as `label:line:column`.
  if (path === sourceLabel || path.startsWith(`${sourceLabel}:`)) {
    return 'document';
  }
  return path === '/$schema' ? 'schema-key' : 'command';
};

/** The distinct categories in one notice, sorted so the log is deterministic. */
const diagnosticKinds = (diagnostics: readonly configValidationDiagnostic[], sourceLabel: string): DiagnosticKind[] =>
  [...new Set(diagnostics.map((entry) => diagnosticKind(entry.path, sourceLabel)))].toSorted();

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
      // The notification is the surface that explains a problem to the user.
      // The log keeps only a count and closed categories, so a command
      // identifier or a fragment of the user's file cannot reach it.
      warn('[config-keybindings] User keybindings diagnostics.', {
        count: notice.diagnostics.length,
        kinds: diagnosticKinds(notice.diagnostics, notice.label),
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
