/** @file KB-SVC-2: the service refines the verified policy under command sequences. */
import {expect, test} from 'bun:test';
import fc from 'fast-check';

import {createKeybindingsService} from '../../app/config/keybindings';
import {parseKeybindingsText, serializeKeybindings} from '../../app/config/keybindings-codec';
import {
  type KeybindingsObservation,
  type LegacyKeymapsSource,
  decideBootstrap,
  specLatestAccepted
} from '../../app/config/keybindings-policy';
import {createMemoryKeybindingsStore, type MemoryKeybindingsStore} from '../testUtils/memory-keybindings-store';
import {KEYBINDINGS_PROPERTY_SEED, keymapsArb, textDocArb} from '../testUtils/keybindings-arbitraries';

const SOURCE = 'model-keybindings.json5';
const MAX_COMMANDS = 50;
const PROPERTY_RUNS = 60;
const PROPERTY_OPTIONS = {numRuns: PROPERTY_RUNS, seed: KEYBINDINGS_PROPERTY_SEED, verbose: true} as const;
type FileModel =
  | {readonly kind: 'text'; readonly text: string}
  | {readonly kind: 'missing'}
  | {readonly kind: 'unreadable'};

type Model = {
  file: FileModel;
  history: KeybindingsObservation[];
  pendingWriteFailure: boolean;
  started: boolean;
  writeAttempts: number;
};

type Real = {
  readonly service: ReturnType<typeof createKeybindingsService>;
  readonly store: MemoryKeybindingsStore;
};

type Setup = {readonly model: Model; readonly real: Real};

const validTextArb = keymapsArb.map((keymaps) => serializeKeybindings(keymaps));
const invalidTextArb = textDocArb.filter((text) => parseKeybindingsText(text, SOURCE).kind === 'invalid');

const legacyArb: fc.Arbitrary<LegacyKeymapsSource> = fc.oneof(
  keymapsArb.map((keymaps): LegacyKeymapsSource => ({keymaps, kind: 'parsed-keymaps'})),
  fc.constant<LegacyKeymapsSource>({kind: 'parsed-empty'}),
  fc.constant<LegacyKeymapsSource>({kind: 'parsed-invalid'}),
  fc.constant<LegacyKeymapsSource>({kind: 'freshly-created'}),
  fc.constant<LegacyKeymapsSource>({kind: 'fell-back'})
);

const observationFromFile = (file: FileModel): KeybindingsObservation => {
  switch (file.kind) {
    case 'missing': {
      return {kind: 'missing'};
    }
    case 'unreadable': {
      return {kind: 'unreadable'};
    }
    case 'text': {
      const parsed = parseKeybindingsText(file.text, SOURCE);
      return parsed.kind === 'ok' ? {keymaps: parsed.keymaps, kind: 'valid'} : {kind: 'invalid'};
    }
  }
};

const expectedActive = (history: readonly KeybindingsObservation[]) => specLatestAccepted([...history]) ?? {};

const observe = (
  model: Model,
  real: Real,
  outcome: ReturnType<Real['service']['reload']>,
  historyBefore: readonly KeybindingsObservation[]
): void => {
  expect(real.service.active()).toEqual(expectedActive(model.history));
  if (outcome.kind === 'kept') {
    const previous = specLatestAccepted([...historyBefore]);
    expect(outcome.basis).toBe(previous === null ? 'empty' : 'last-known-good');
  } else {
    expect(outcome.keymaps).toEqual(expectedActive(model.history));
  }
  expect(real.store.writeAttempts()).toBe(model.writeAttempts);
};

const command = (
  name: string,
  run: (model: Model, real: Real) => void,
  check: (model: Readonly<Model>) => boolean = () => true
): fc.Command<Model, Real> => ({check, run, toString: () => name});

const EXTERNAL_COMMANDS: readonly fc.Arbitrary<fc.Command<Model, Real>>[] = [
  validTextArb.map((text) =>
    command('set valid', (model, real) => {
      model.file = {kind: 'text', text};
      real.store.setText(text);
    })
  ),
  invalidTextArb.map((text) =>
    command('set invalid', (model, real) => {
      model.file = {kind: 'text', text};
      real.store.setText(text);
    })
  ),
  fc.constant(
    command('delete file', (model, real) => {
      model.file = {kind: 'missing'};
      real.store.setMissing();
    })
  ),
  fc.constant(
    command('make unreadable', (model, real) => {
      model.file = {kind: 'unreadable'};
      real.store.setUnreadable();
    })
  ),
  fc.constant(
    command('fail next write', (model, real) => {
      model.pendingWriteFailure = true;
      real.store.failNextWrite();
    })
  )
];

const START_COMMAND: fc.Arbitrary<fc.Command<Model, Real>> = legacyArb.map((legacy) =>
  command(
    'start',
    (model, real) => {
      model.started = true;
      const fileState = model.file.kind === 'text' ? 'present' : model.file.kind;
      const decision = decideBootstrap({file: fileState, legacy});
      const historyBefore = [...model.history];
      let observation: KeybindingsObservation | null = null;
      if (decision.kind === 'defer') {
        observation = null;
      } else if (decision.kind === 'write-nothing') {
        observation = observationFromFile(model.file);
      } else {
        const write = model.pendingWriteFailure ? 'failed' : 'written';
        model.pendingWriteFailure = false;
        model.writeAttempts += 1;
        if (write === 'written') {
          model.file = {kind: 'text', text: serializeKeybindings(decision.keymaps)};
        }
        observation = {keymaps: decision.keymaps, kind: 'valid'};
      }
      if (observation !== null) {
        model.history.push(observation);
      }

      const outcome = real.service.start(legacy);
      observe(model, real, outcome, historyBefore);
      if (decision.kind === 'seed') {
        expect(outcome).toMatchObject({kind: 'applied', origin: 'seeded'});
      } else if (observation?.kind === 'valid') {
        expect(outcome).toMatchObject({kind: 'applied', origin: 'file'});
      } else if (observation?.kind === 'missing') {
        expect(outcome).toMatchObject({kind: 'applied', origin: 'missing'});
      } else {
        expect(outcome.kind).toBe('kept');
      }
    },
    (model) => !model.started
  )
);

const RELOAD_COMMAND = fc.constant(
  command('reload', (model, real) => {
    const historyBefore = [...model.history];
    const observation = observationFromFile(model.file);
    model.history.push(observation);

    const outcome = real.service.reload();
    observe(model, real, outcome, historyBefore);
    if (observation.kind === 'valid') {
      expect(outcome).toMatchObject({kind: 'applied', origin: 'file'});
    } else if (observation.kind === 'missing') {
      expect(outcome).toMatchObject({kind: 'applied', origin: 'missing'});
    } else {
      expect(outcome.kind).toBe('kept');
    }
  })
);

const IMPORT_VALID_COMMAND: fc.Arbitrary<fc.Command<Model, Real>> = validTextArb.map((text) =>
  command('import valid', (model, real) => {
    const before = real.service.active();
    const historyBefore = [...model.history];
    model.writeAttempts += 1;
    const failed = model.pendingWriteFailure;
    model.pendingWriteFailure = false;
    if (!failed) {
      model.file = {kind: 'text', text};
    }

    const outcome = real.service.importKeybindings(text, SOURCE);

    expect(outcome.kind).toBe(failed ? 'failed' : 'written');
    expect(real.service.active()).toEqual(before);
    expect(model.history).toEqual(historyBefore);
    expect(real.store.writeAttempts()).toBe(model.writeAttempts);
  })
);

const IMPORT_INVALID_COMMAND: fc.Arbitrary<fc.Command<Model, Real>> = invalidTextArb.map((text) =>
  command('import invalid', (model, real) => {
    const before = real.service.active();
    const attemptsBefore = model.writeAttempts;
    const fileBefore = model.file;

    const outcome = real.service.importKeybindings(text, SOURCE);

    expect(outcome.kind).toBe('invalid');
    expect(real.service.active()).toEqual(before);
    expect(model.file).toEqual(fileBefore);
    expect(real.store.writeAttempts()).toBe(attemptsBefore);
  })
);

const EXPORT_COMMAND = fc.constant(
  command('export', (model, real) => {
    const attemptsBefore = model.writeAttempts;
    const outcome = real.service.exportKeybindings();

    switch (model.file.kind) {
      case 'missing': {
        expect(outcome).toEqual({kind: 'missing'});
        break;
      }
      case 'unreadable': {
        expect(outcome.kind).toBe('unreadable');
        break;
      }
      case 'text': {
        const parsed = parseKeybindingsText(model.file.text, SOURCE);
        expect(outcome).toEqual(
          parsed.kind === 'ok'
            ? {kind: 'stored', text: model.file.text}
            : {kind: 'invalid', text: model.file.text, diagnostics: parsed.diagnostics}
        );
        break;
      }
    }
    expect(real.store.writeAttempts()).toBe(attemptsBefore);
  })
);

const ALL_COMMANDS: readonly fc.Arbitrary<fc.Command<Model, Real>>[] = [
  ...EXTERNAL_COMMANDS,
  START_COMMAND,
  RELOAD_COMMAND,
  IMPORT_VALID_COMMAND,
  IMPORT_INVALID_COMMAND,
  EXPORT_COMMAND
];

// A failing sequence prints its own `replayPath` hint, so no option is needed.
const commandsArb = fc.commands([...ALL_COMMANDS], {maxCommands: MAX_COMMANDS});

const setup = (): Setup => {
  const store = createMemoryKeybindingsStore(SOURCE);
  const service = createKeybindingsService({notify: () => {}, store, warn: () => {}});
  return {
    model: {file: {kind: 'missing'}, history: [], pendingWriteFailure: false, started: false, writeAttempts: 0},
    real: {service, store}
  };
};

test('KB-SVC-2 the service refines the policy under any command sequence', () => {
  fc.assert(
    fc.property(commandsArb, (commands) => fc.modelRun(setup, commands)),
    PROPERTY_OPTIONS
  );
});

test('KB-SVC-2 non-vacuity: every command is generated', () => {
  const samples = fc.sample(commandsArb, {numRuns: 60, seed: KEYBINDINGS_PROPERTY_SEED});
  const names = new Set(samples.flatMap((commands) => [...commands].map((entry) => entry.toString())));

  expect([...names].toSorted()).toEqual([
    'delete file',
    'export',
    'fail next write',
    'import invalid',
    'import valid',
    'make unreadable',
    'reload',
    'set invalid',
    'set valid',
    'start'
  ]);
});
