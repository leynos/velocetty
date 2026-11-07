/** @file KB-POL-1 and KB-POL-2: keybindings policy transitions and the bootstrap table. */
import {describe, expect, test} from 'bun:test';

import {
  activeKeymaps,
  bootstrapObservation,
  type BootstrapDecision,
  type BootstrapFileState,
  decideBootstrap,
  emptyUserKeymaps,
  initialKeybindingsState,
  type KeybindingsObservation,
  type KeybindingsState,
  type LegacyKeymapsSource,
  observeKeybindings,
  replayKeybindingObservations,
  specLatestAccepted,
  type UserKeymaps
} from '../../app/config/keybindings-policy';

const seeds: UserKeymaps = {'window:new': 'ctrl+alt+shift+n'};
const other: UserKeymaps = {'pane:split': ['ctrl+shift+d', 'ctrl+shift+e']};

const accepted = (keymaps: UserKeymaps): KeybindingsState => ({lastAccepted: keymaps});
const rejected: KeybindingsState = initialKeybindingsState;

const observations: readonly {readonly label: string; readonly observation: KeybindingsObservation}[] = [
  {label: 'valid', observation: {kind: 'valid', keymaps: seeds}},
  {label: 'missing', observation: {kind: 'missing'}},
  {label: 'invalid', observation: {kind: 'invalid'}},
  {label: 'unreadable', observation: {kind: 'unreadable'}}
];

const legacySources: readonly {readonly label: string; readonly legacy: LegacyKeymapsSource}[] = [
  {label: 'parsed-keymaps', legacy: {kind: 'parsed-keymaps', keymaps: seeds}},
  {label: 'parsed-empty', legacy: {kind: 'parsed-empty'}},
  {label: 'parsed-invalid', legacy: {kind: 'parsed-invalid'}},
  {label: 'freshly-created', legacy: {kind: 'freshly-created'}},
  {label: 'fell-back', legacy: {kind: 'fell-back'}}
];

const fileStates: readonly BootstrapFileState[] = ['present', 'missing', 'unreadable'];

/** States the KB-POL-2 decision independently of the implementation. */
const expectedDecision = (file: BootstrapFileState, legacy: LegacyKeymapsSource): BootstrapDecision => {
  if (file !== 'missing') {
    return {kind: 'write-nothing'};
  }

  switch (legacy.kind) {
    case 'parsed-keymaps': {
      return {kind: 'seed', keymaps: legacy.keymaps};
    }
    case 'parsed-empty':
    case 'freshly-created': {
      return {kind: 'seed', keymaps: {}};
    }
    default: {
      return {kind: 'defer'};
    }
  }
};

describe('KB-POL-1 observation transitions', () => {
  test('valid applies the observation payload', () => {
    const result = observeKeybindings(rejected, {kind: 'valid', keymaps: seeds});

    expect(result.status).toBe('applied');
    expect(result.state.lastAccepted).toBe(seeds);
    expect(result.usedLastKnownGood).toBe(false);
  });

  test('missing applies the empty map even over an accepted payload', () => {
    const result = observeKeybindings(accepted(seeds), {kind: 'missing'});

    expect(result.status).toBe('applied');
    expect(result.state.lastAccepted).toEqual({});
    expect(result.usedLastKnownGood).toBe(false);
  });

  test.each([
    {label: 'invalid', observation: {kind: 'invalid'} as const},
    {label: 'unreadable', observation: {kind: 'unreadable'} as const}
  ])('$label keeps the state and reports the fallback basis', ({observation}) => {
    const withoutBasis = observeKeybindings(rejected, observation);
    expect(withoutBasis.status).toBe('kept');
    expect(withoutBasis.state).toBe(rejected);
    expect(withoutBasis.usedLastKnownGood).toBe(false);

    const withBasis = observeKeybindings(accepted(seeds), observation);
    expect(withBasis.status).toBe('kept');
    expect(withBasis.state.lastAccepted).toBe(seeds);
    expect(withBasis.usedLastKnownGood).toBe(true);
  });

  test.each(observations)('$label is idempotent', ({observation}) => {
    const once = observeKeybindings(accepted(other), observation);

    expect(observeKeybindings(once.state, observation).state).toEqual(once.state);
  });

  test.each<{
    readonly label: string;
    readonly history: KeybindingsObservation[];
    readonly expected: UserKeymaps | null;
  }>([
    {label: 'valid then invalid', history: [{kind: 'valid', keymaps: seeds}, {kind: 'invalid'}], expected: seeds},
    {
      label: 'missing wins over an earlier payload',
      history: [{kind: 'valid', keymaps: seeds}, {kind: 'missing'}],
      expected: {}
    },
    {
      label: 'a later valid overrides an earlier payload',
      history: [{kind: 'valid', keymaps: seeds}, {kind: 'missing'}, {kind: 'valid', keymaps: other}],
      expected: other
    },
    {label: 'rejected history', history: [{kind: 'invalid'}, {kind: 'unreadable'}], expected: null},
    {label: 'empty history', history: [], expected: null}
  ])('replay leaves $label in the last-known-good state', ({history, expected}) => {
    const replayed = replayKeybindingObservations(history);

    expect(replayed.lastAccepted).toEqual(expected);
    expect(replayed.lastAccepted).toEqual(specLatestAccepted(history));
  });

  test('activeKeymaps reports the accepted payload or the empty map', () => {
    expect(activeKeymaps(accepted(seeds))).toBe(seeds);
    expect(activeKeymaps(rejected)).toEqual(emptyUserKeymaps());
  });
});

describe('KB-POL-2 bootstrap decision table', () => {
  const rows = fileStates.flatMap((file) => legacySources.map((source) => ({file, ...source})));

  test.each(rows)('$file with $label gives the contractual decision', ({file, legacy}) => {
    expect(decideBootstrap({file, legacy})).toEqual(expectedDecision(file, legacy));
  });

  test('the table exercises every file state and legacy class', () => {
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map((row) => row.file)).size).toBe(fileStates.length);
    expect(new Set(rows.map((row) => row.label)).size).toBe(legacySources.length);
  });

  test.each<{
    readonly label: string;
    readonly write: 'written' | 'failed';
    readonly expected: KeybindingsObservation;
  }>([
    {
      label: 'written',
      write: 'written',
      expected: {kind: 'valid', keymaps: seeds}
    },
    {
      label: 'failed',
      write: 'failed',
      expected: {kind: 'valid', keymaps: seeds}
    }
  ])('a $label seed is applied in memory as the observation payload', ({write, expected}) => {
    expect(bootstrapObservation({kind: 'seed', keymaps: seeds}, write)).toEqual(expected);
  });

  test.each([
    {
      label: 'a seed that was never attempted',
      decision: {kind: 'seed', keymaps: seeds} as const,
      write: 'not-attempted' as const
    },
    {label: 'a deferred decision', decision: {kind: 'defer'} as const, write: 'not-attempted' as const},
    {label: 'a write-nothing decision', decision: {kind: 'write-nothing'} as const, write: 'not-attempted' as const}
  ])('$label applies no observation', ({decision, write}) => {
    expect(bootstrapObservation(decision, write)).toBeNull();
  });
});
