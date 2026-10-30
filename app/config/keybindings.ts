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
  /**
   * Removes leftovers from a write that crashed before its rename.
   *
   * Start-up calls this once, before deciding whether to seed. Reload, import,
   * and export never clean the directory.
   */
  readonly removeStaleTemporaryFiles?: () => void;
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

/** Text supplied by an importer, with the name its diagnostics should cite. */
export type KeybindingsImportRequest = Readonly<{
  readonly sourceLabel: string;
  readonly text: string;
}>;

/** A rejected read to report, with the diagnostics that explain it. */
type RejectedRead = Readonly<{
  readonly cause: 'invalid' | 'unreadable';
  readonly diagnostics: readonly configValidationDiagnostic[];
}>;

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

const diagnosticsSignature = (diagnostics: readonly configValidationDiagnostic[]): string =>
  JSON.stringify(diagnostics.map((entry) => [entry.path, entry.message]));

/**
 * Copies a keymaps payload, including every shortcut array.
 *
 * The verified policy retains an opaque payload, so it cannot promise that the
 * payload's contents stay unchanged. Copying at the service boundary keeps a
 * caller from rewriting the accepted state through a returned map.
 */
const copyKeymaps = (keymaps: UserKeymaps): UserKeymaps =>
  Object.fromEntries(
    Object.entries(keymaps).map(([command, shortcuts]) => [
      command,
      Array.isArray(shortcuts) ? [...shortcuts] : shortcuts
    ])
  );

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

  /** The keymaps in effect, copied so callers cannot mutate accepted state. */
  const exposedKeymaps = (): UserKeymaps => copyKeymaps(activeKeymaps(state));

  const describeDeferred = (): KeybindingsLoadOutcome => ({
    basis: state.lastAccepted === null ? 'empty' : 'last-known-good',
    cause: 'deferred',
    diagnostics: [],
    keymaps: exposedKeymaps(),
    kind: 'kept'
  });

  /** Applies a rejected read and tells the user what is actually in effect. */
  const describeRejectedRead = ({cause, diagnostics}: RejectedRead): KeybindingsLoadOutcome => {
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
        notify(`Couldn't parse keybindings file. ${inEffect}${describePrimaryDiagnostic(diagnostics)}`);
      }
    } else {
      notify(`Couldn't read keybindings file. ${inEffect}`);
    }
    return {basis, cause, diagnostics, keymaps: exposedKeymaps(), kind: 'kept'};
  };

  /** Reads and applies whatever the file currently holds; never writes. */
  const readCurrentFile = (): KeybindingsLoadOutcome => {
    const readOutcome = store.read();
    if (readOutcome.kind === 'missing') {
      applyObservation({kind: 'missing'});
      lastShownDiagnostics = '';
      return {keymaps: exposedKeymaps(), kind: 'applied', origin: 'missing'};
    }
    if (readOutcome.kind === 'unreadable') {
      warnFn(`[config-keybindings] Couldn't read "${store.location}".`, readOutcome.error);
      return describeRejectedRead({cause: 'unreadable', diagnostics: []});
    }

    const parsed = parseKeybindingsText(readOutcome.text, store.location);
    if (parsed.kind === 'invalid') {
      warnFn('[config-keybindings] User keybindings diagnostics.', {
        diagnostics: parsed.diagnostics,
        source: store.location
      });
      return describeRejectedRead({cause: 'invalid', diagnostics: parsed.diagnostics});
    }
    lastShownDiagnostics = '';
    applyObservation({keymaps: parsed.keymaps, kind: 'valid'});
    return {keymaps: exposedKeymaps(), kind: 'applied', origin: 'file'};
  };

  const start = (legacy: LegacyKeymapsSource): KeybindingsLoadOutcome => {
    // Start-up bootstrap runs once; a second call is just a reload.
    if (isStarted) {
      return readCurrentFile();
    }
    isStarted = true;
    // A crashed write can leave a temporary file behind; start-up is the only
    // phase that may remove it.
    store.removeStaleTemporaryFiles?.();

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
    return {keymaps: exposedKeymaps(), kind: 'applied', origin: 'seeded'};
  };

  const reload = (): KeybindingsLoadOutcome => readCurrentFile();

  const importKeybindings = ({sourceLabel, text}: KeybindingsImportRequest): KeybindingsImportOutcome => {
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
  const active = (): UserKeymaps => exposedKeymaps();

  return {active, exportKeybindings, importKeybindings, reload, start};
};
