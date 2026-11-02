/** @file JSON5-backed user keybindings service, bootstrap, and import/export laws. */
/*
 * The service owns the last-known-good state. It reads and writes through the
 * neutral ports in `keybindings-ports`, so the rules that matter (no reload
 * writes, no unreadable file is overwritten, import is verbatim) are testable
 * without a filesystem and without any presentation dependency.
 */
import type {configValidationDiagnostic} from '@shared/types/config';
import {
  activeKeymaps,
  bootstrapObservation,
  decideBootstrap,
  initialKeybindingsState,
  observeKeybindings,
  type BootstrapDecision,
  type KeybindingsObservation,
  type LegacyKeymapsSource,
  type UserKeymaps
} from './keybindings-policy';
import type {
  KeybindingsBasis,
  KeybindingsExport,
  KeybindingsImportOutcome,
  KeybindingsImportRequest,
  KeybindingsLoadOutcome,
  KeybindingsReporter,
  KeybindingsStorageFailure,
  KeybindingsStore,
  KeybindingsTextCodec,
  KeybindingsWriteOutcome
} from './keybindings-ports';

export type {
  KeybindingsBasis,
  KeybindingsExport,
  KeybindingsImportOutcome,
  KeybindingsImportRequest,
  KeybindingsLoadOutcome,
  KeybindingsNotice,
  KeybindingsReadOutcome,
  KeybindingsReporter,
  KeybindingsStorageFailure,
  KeybindingsStore,
  KeybindingsTextCodec,
  KeybindingsWriteOutcome
} from './keybindings-ports';
export type {ConfigImportNotify} from './import-report';

/** A bootstrap decision that writes a seed. */
type SeedDecision = Extract<BootstrapDecision, {kind: 'seed'}>;

/** Normalises the write outcome to the two states the policy understands. */
const seedWriteStatus = (outcome: KeybindingsWriteOutcome): 'written' | 'failed' =>
  outcome.kind === 'written' ? 'written' : 'failed';

/**
 * Names where the applied keymaps came from.
 *
 * A seed that could not be written still applies in memory, but only a written
 * file counts as a completed migration.
 */
const seedOrigin = (outcome: KeybindingsWriteOutcome): 'seeded' | 'seeded-unsaved' =>
  outcome.kind === 'written' ? 'seeded' : 'seeded-unsaved';

/** A rejected read to report, with the bounded reason that explains it. */
type RejectedRead =
  | {readonly cause: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]}
  | {readonly cause: 'unreadable'; readonly failure: KeybindingsStorageFailure};

/**
 * Reduces diagnostics to the pair that decides whether a repeat is new.
 *
 * A reload that fails the same way must not notify again, so the service
 * compares these signatures instead of the whole diagnostic objects.
 *
 * @example
 * ```ts
 * diagnosticsSignature([{message: 'bad', path: '/x', suggestedFix: ''}]); // '/x/bad'
 * ```
 */
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
 * const service = createKeybindingsService({codec, report, store});
 * service.start({kind: 'parsed-empty'}); // seeds an empty file when missing
 * service.exportKeybindings(); // {kind: 'stored', text: '...'}
 * ```
 */
export const createKeybindingsService = (dependencies: {
  readonly codec: KeybindingsTextCodec;
  readonly store: KeybindingsStore;
  readonly report: KeybindingsReporter;
}) => {
  const {codec, report, store} = dependencies;
  let state = initialKeybindingsState;
  let isStarted = false;
  let lastShownDiagnostics = '';

  /** Advances the state through the verified policy and reports what it did. */
  const applyObservation = (observation: KeybindingsObservation) => {
    const result = observeKeybindings(state, observation);
    state = result.state;
    return result;
  };

  /** The keymaps in effect, copied so callers cannot mutate accepted state. */
  const exposedKeymaps = (): UserKeymaps => copyKeymaps(activeKeymaps(state));

  /** Reports the current keymaps unchanged because start-up deferred the seed. */
  const describeDeferred = (): KeybindingsLoadOutcome => ({
    basis: state.lastAccepted === null ? 'empty' : 'last-known-good',
    cause: 'deferred',
    diagnostics: [],
    keymaps: exposedKeymaps(),
    kind: 'kept'
  });

  /** Applies a rejected read and tells the edge what is actually in effect. */
  const describeRejectedRead = (rejected: RejectedRead): KeybindingsLoadOutcome => {
    const result = applyObservation({kind: rejected.cause});
    const basis: KeybindingsBasis = result.usedLastKnownGood ? 'last-known-good' : 'empty';
    if (rejected.cause === 'invalid') {
      const signature = diagnosticsSignature(rejected.diagnostics);
      if (signature !== lastShownDiagnostics) {
        lastShownDiagnostics = signature;
        report({basis, diagnostics: rejected.diagnostics, kind: 'invalid-file'});
      }
      return {basis, cause: rejected.cause, diagnostics: rejected.diagnostics, keymaps: exposedKeymaps(), kind: 'kept'};
    }
    report({basis, failure: rejected.failure, kind: 'unreadable-file'});
    return {basis, cause: rejected.cause, diagnostics: [], keymaps: exposedKeymaps(), kind: 'kept'};
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
      return describeRejectedRead({cause: 'unreadable', failure: readOutcome.failure});
    }

    const parsed = codec.parse(readOutcome.text, store.label);
    if (parsed.kind === 'invalid') {
      report({diagnostics: parsed.diagnostics, kind: 'diagnostics', label: store.label});
      return describeRejectedRead({cause: 'invalid', diagnostics: parsed.diagnostics});
    }
    lastShownDiagnostics = '';
    applyObservation({keymaps: parsed.keymaps, kind: 'valid'});
    return {keymaps: exposedKeymaps(), kind: 'applied', origin: 'file'};
  };

  /** Writes the seed and applies it, reporting how far the migration got. */
  const seedFile = (decision: SeedDecision): KeybindingsLoadOutcome => {
    const writeOutcome = store.write(codec.serialize(decision.keymaps));
    if (writeOutcome.kind === 'failed') {
      report({failure: writeOutcome.failure, kind: 'seed-failed'});
    }
    const observation = bootstrapObservation(decision, seedWriteStatus(writeOutcome));
    if (observation === null) {
      return describeDeferred();
    }
    lastShownDiagnostics = '';
    applyObservation(observation);
    return {keymaps: exposedKeymaps(), kind: 'applied', origin: seedOrigin(writeOutcome)};
  };

  /**
   * Runs the start-up bootstrap, or a plain reload when start-up already ran.
   *
   * Only this call may seed; every later state change goes through `reload`.
   * Start-up cleanup belongs to the edge that owns the adapter, not here.
   */
  const start = (legacy: LegacyKeymapsSource): KeybindingsLoadOutcome => {
    // Start-up bootstrap runs once; a second call is just a reload.
    if (isStarted) {
      return readCurrentFile();
    }
    isStarted = true;

    const decision = decideBootstrap({file: store.read().kind, legacy});
    if (decision.kind === 'write-nothing') {
      return readCurrentFile();
    }
    if (decision.kind === 'defer') {
      return describeDeferred();
    }
    return seedFile(decision);
  };

  /** Reads and applies the file again; never writes. */
  const reload = (): KeybindingsLoadOutcome => readCurrentFile();

  /**
   * Validates importer-supplied text and stores it verbatim.
   *
   * The active keymaps change on the next reload, so an import cannot leave the
   * session in a state that disagrees with the file on disk.
   */
  const importKeybindings = ({sourceLabel, text}: KeybindingsImportRequest): KeybindingsImportOutcome => {
    const parsed = codec.parse(text, sourceLabel);
    if (parsed.kind === 'invalid') {
      return {diagnostics: parsed.diagnostics, kind: 'invalid'};
    }
    const writeOutcome = store.write(text);
    if (writeOutcome.kind === 'failed') {
      report({failure: writeOutcome.failure, kind: 'import-failed'});
      return {failure: writeOutcome.failure, kind: 'failed'};
    }
    return {kind: 'written'};
  };

  /**
   * Returns the stored text for an exporter, reporting why when it cannot.
   *
   * The text is returned unchanged rather than re-serialised, so an export
   * preserves the user's comments and formatting.
   */
  const exportKeybindings = (): KeybindingsExport => {
    const readOutcome = store.read();
    if (readOutcome.kind === 'missing') {
      return {kind: 'missing'};
    }
    if (readOutcome.kind === 'unreadable') {
      return {failure: readOutcome.failure, kind: 'unreadable'};
    }
    const parsed = codec.parse(readOutcome.text, store.label);
    return parsed.kind === 'ok'
      ? {kind: 'stored', text: readOutcome.text}
      : {diagnostics: parsed.diagnostics, kind: 'invalid', text: readOutcome.text};
  };

  /** The keymaps currently in effect; a query with no side effects. */
  const active = (): UserKeymaps => exposedKeymaps();

  return {active, exportKeybindings, importKeybindings, reload, start};
};
