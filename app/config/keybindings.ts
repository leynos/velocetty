/** @file JSON5-backed user keybindings service, bootstrap, and import/export laws. */
/*
 * The service owns the last-known-good state. It reads and writes through the
 * `KeybindingsStore` port, so the rules that matter (no reload writes, no
 * unreadable file is overwritten, import is verbatim) are testable without a
 * filesystem.
 */
import type {configValidationDiagnostic} from '@shared/types/config';
import {parseKeybindingsText, serializeKeybindings} from './keybindings-codec';
import {
  activeKeymaps,
  bootstrapObservation,
  decideBootstrap,
  initialKeybindingsState,
  observeKeybindings,
  type BootstrapFileState,
  type KeybindingsObservation,
  type LegacyKeymapsSource,
  type UserKeymaps
} from './keybindings-policy';

/** A notification sink shared by the configuration modules. */
export type ConfigImportNotify = (title: string, body?: string, details?: {error?: unknown}) => void;

/** What reading the keybindings file observed. */
export type KeybindingsReadOutcome =
  | {readonly kind: 'present'; readonly text: string}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly error: unknown};

/** What writing the keybindings file did. */
export type KeybindingsWriteOutcome = {readonly kind: 'written'} | {readonly kind: 'failed'; readonly error: unknown};

/** The driven port the keybindings service reads and writes through. */
export type KeybindingsStore = {
  readonly location: string;
  readonly read: () => KeybindingsReadOutcome;
  readonly write: (text: string) => KeybindingsWriteOutcome;
};

/** What a start or reload left in effect. */
export type KeybindingsLoadOutcome =
  | {readonly kind: 'applied'; readonly keymaps: UserKeymaps; readonly origin: 'file' | 'missing' | 'seeded'}
  | {
      readonly kind: 'kept';
      readonly keymaps: UserKeymaps;
      readonly basis: 'last-known-good' | 'empty';
      readonly cause: 'invalid' | 'unreadable' | 'deferred';
      readonly diagnostics: readonly configValidationDiagnostic[];
    };

/** What importing user-supplied text did. */
export type KeybindingsImportOutcome =
  | {readonly kind: 'written'}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'failed'; readonly error: unknown};

/** What the stored keybindings contain, read without side effects. */
export type KeybindingsExport =
  | {readonly kind: 'stored'; readonly text: string}
  | {readonly kind: 'invalid'; readonly text: string; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'; readonly error: unknown};

/**
 * Formats the first diagnostic as a sentence suffix for a notification.
 *
 * Keeping this in one place means start-up, reload, and the earlier module
 * cannot describe the same problem differently.
 */
const primaryDiagnosticHint = (diagnostics: readonly configValidationDiagnostic[]): string => {
  const primaryDiagnostic = diagnostics.at(0);
  if (!primaryDiagnostic) {
    return '';
  }
  const docHint = primaryDiagnostic.docHint ? ` Hint: ${primaryDiagnostic.docHint}.` : '';
  const defaultHint = primaryDiagnostic.defaultHint ? ` Default: ${primaryDiagnostic.defaultHint}.` : '';
  return ` ${primaryDiagnostic.path}: ${primaryDiagnostic.message} Suggested fix: ${primaryDiagnostic.suggestedFix}.${docHint}${defaultHint}`;
};

const diagnosticsSignature = (diagnostics: readonly configValidationDiagnostic[]): string =>
  JSON.stringify(diagnostics.map((entry) => [entry.path, entry.message]));

/**
 * Creates the keybindings service.
 *
 * State changes only through `start` and `reload`. `reload` never writes, and
 * `importKeybindings` writes but changes no state until the next reload, so
 * every state change has exactly one path.
 *
 * @example
 * ```ts
 * const service = createKeybindingsService({notify, store});
 * service.start({kind: 'parsed-empty'}); // seeds an empty file when missing
 * service.exportKeybindings(); // {kind: 'stored', text: '...'}
 * ```
 */
export const createKeybindingsService = (dependencies: {
  readonly store: KeybindingsStore;
  readonly notify: ConfigImportNotify;
  readonly warn?: typeof console.warn;
}) => {
  const {notify, store} = dependencies;
  const warnFn = dependencies.warn ?? console.warn;
  let state = initialKeybindingsState;
  let isStarted = false;
  let lastShownDiagnostics = '';

  const applyObservation = (observation: KeybindingsObservation) => {
    const result = observeKeybindings(state, observation);
    state = result.state;
    return result;
  };

  const describeDeferred = (): KeybindingsLoadOutcome => ({
    basis: state.lastAccepted === null ? 'empty' : 'last-known-good',
    cause: 'deferred',
    diagnostics: [],
    keymaps: activeKeymaps(state),
    kind: 'kept'
  });

  /** Applies a rejected read and tells the user what is actually in effect. */
  const describeRejectedRead = (
    cause: 'invalid' | 'unreadable',
    diagnostics: readonly configValidationDiagnostic[]
  ): KeybindingsLoadOutcome => {
    const result = applyObservation({kind: cause});
    const basis = result.usedLastKnownGood ? 'last-known-good' : 'empty';
    const inEffect =
      basis === 'last-known-good'
        ? 'Keeping your previous shortcuts.'
        : 'Using default shortcuts until the file is fixed.';
    if (cause === 'invalid') {
      const signature = diagnosticsSignature(diagnostics);
      if (signature !== lastShownDiagnostics) {
        lastShownDiagnostics = signature;
        notify(`Couldn't parse keybindings file. ${inEffect}${primaryDiagnosticHint(diagnostics)}`);
      }
    } else {
      notify(`Couldn't read keybindings file. ${inEffect}`);
    }
    return {basis, cause, diagnostics, keymaps: activeKeymaps(state), kind: 'kept'};
  };

  /** Reads and applies whatever the file currently holds; never writes. */
  const readCurrentFile = (): KeybindingsLoadOutcome => {
    const readOutcome = store.read();
    if (readOutcome.kind === 'missing') {
      applyObservation({kind: 'missing'});
      lastShownDiagnostics = '';
      return {keymaps: activeKeymaps(state), kind: 'applied', origin: 'missing'};
    }
    if (readOutcome.kind === 'unreadable') {
      warnFn(`[config-keybindings] Couldn't read "${store.location}".`, readOutcome.error);
      return describeRejectedRead('unreadable', []);
    }

    const parsed = parseKeybindingsText(readOutcome.text, store.location);
    if (parsed.kind === 'invalid') {
      warnFn('[config-keybindings] User keybindings diagnostics.', {
        diagnostics: parsed.diagnostics,
        source: store.location
      });
      return describeRejectedRead('invalid', parsed.diagnostics);
    }
    lastShownDiagnostics = '';
    applyObservation({keymaps: parsed.keymaps, kind: 'valid'});
    return {keymaps: activeKeymaps(state), kind: 'applied', origin: 'file'};
  };

  const start = (legacy: LegacyKeymapsSource): KeybindingsLoadOutcome => {
    // Start-up bootstrap runs once; a second call is just a reload.
    if (isStarted) {
      return readCurrentFile();
    }
    isStarted = true;

    const readOutcome = store.read();
    const file: BootstrapFileState = readOutcome.kind;
    const decision = decideBootstrap({file, legacy});
    if (decision.kind === 'defer') {
      return describeDeferred();
    }
    if (decision.kind === 'write-nothing') {
      return readCurrentFile();
    }

    const writeOutcome = store.write(serializeKeybindings(decision.keymaps));
    if (writeOutcome.kind === 'failed') {
      notify("Couldn't create a keybindings file. Check permissions and available disk space.", undefined, {
        error: writeOutcome.error
      });
    }
    const observation = bootstrapObservation(decision, writeOutcome.kind === 'written' ? 'written' : 'failed');
    if (observation === null) {
      return describeDeferred();
    }
    lastShownDiagnostics = '';
    applyObservation(observation);
    return {keymaps: activeKeymaps(state), kind: 'applied', origin: 'seeded'};
  };

  const reload = (): KeybindingsLoadOutcome => readCurrentFile();

  const importKeybindings = (text: string, sourceLabel: string): KeybindingsImportOutcome => {
    const parsed = parseKeybindingsText(text, sourceLabel);
    if (parsed.kind === 'invalid') {
      return {diagnostics: parsed.diagnostics, kind: 'invalid'};
    }
    const writeOutcome = store.write(text);
    if (writeOutcome.kind === 'failed') {
      notify("Couldn't save keybindings file.", undefined, {error: writeOutcome.error});
      return {error: writeOutcome.error, kind: 'failed'};
    }
    return {kind: 'written'};
  };

  const exportKeybindings = (): KeybindingsExport => {
    const readOutcome = store.read();
    if (readOutcome.kind === 'missing') {
      return {kind: 'missing'};
    }
    if (readOutcome.kind === 'unreadable') {
      return {error: readOutcome.error, kind: 'unreadable'};
    }
    const parsed = parseKeybindingsText(readOutcome.text, store.location);
    return parsed.kind === 'ok'
      ? {kind: 'stored', text: readOutcome.text}
      : {diagnostics: parsed.diagnostics, kind: 'invalid', text: readOutcome.text};
  };

  /** The keymaps currently in effect; a query with no side effects. */
  const active = (): UserKeymaps => activeKeymaps(state);

  return {active, exportKeybindings, importKeybindings, reload, start};
};

// Temporary re-export: the importer still calls the legacy module until EP-D.
export {createKeybindingsModule} from './keybindings-legacy';
