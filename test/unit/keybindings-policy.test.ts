/** @file KB-POL-1 and KB-POL-2: keybindings policy transitions and the bootstrap table. */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

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
import {KEYBINDINGS_PROPERTY_SEED, keymapsArb} from '../testUtils/keybindings-arbitraries';

const seeds: UserKeymaps = {'window:new': 'ctrl+alt+shift+n'};
const other: UserKeymaps = {'pane:split': ['ctrl+shift+d', 'ctrl+shift+e']};

/** A state that has accepted `keymaps` as its last-known-good payload. */
const accepted = (keymaps: UserKeymaps): KeybindingsState => ({lastAccepted: keymaps});
/** A state that has accepted nothing yet. */
const rejected: KeybindingsState = initialKeybindingsState;

const observations: readonly {readonly label: string; readonly observation: KeybindingsObservation}[] = [
  {label: 'valid', observation: {kind: 'valid', keymaps: seeds}},
  {label: 'missing', observation: {kind: 'missing'}},
  {label: 'invalid', observation: {kind: 'invalid'}},
  {label: 'unreadable', observation: {kind: 'unreadable'}}
];

/** Any observation, including a `valid` one whose keymap is generated afresh. */
const observationArb: fc.Arbitrary<KeybindingsObservation> = fc.oneof(
  keymapsArb.map((keymaps): KeybindingsObservation => ({keymaps, kind: 'valid'})),
  fc.constant<KeybindingsObservation>({kind: 'missing'}),
  fc.constant<KeybindingsObservation>({kind: 'invalid'}),
  fc.constant<KeybindingsObservation>({kind: 'unreadable'})
);

/** A replay history long enough to outrun the exhaustive table. */
const replayHistoryArb = fc.array(observationArb, {maxLength: 12});

/**
 * Every history of at most `maxLength` observations, shortest first.
 *
 * Two distinct valid payloads are included so a replay that kept the first
 * accepted map instead of the latest would be caught.
 */
const historiesUpTo = (kinds: readonly KeybindingsObservation[], maxLength: number): KeybindingsObservation[][] => {
  const histories: KeybindingsObservation[][] = [[]];
  let frontier: KeybindingsObservation[][] = [[]];
  for (let length = 1; length <= maxLength; length += 1) {
    frontier = frontier.flatMap((history) => kinds.map((kind) => [...history, kind]));
    histories.push(...frontier);
  }
  return histories;
};

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

  test('replay agrees with the spec for every history of up to three observations', () => {
    const kinds: readonly KeybindingsObservation[] = [
      {kind: 'valid', keymaps: seeds},
      {kind: 'valid', keymaps: other},
      {kind: 'missing'},
      {kind: 'invalid'},
      {kind: 'unreadable'}
    ];
    const histories = historiesUpTo(kinds, 3);
    const replayed = histories.map((history) => replayKeybindingObservations(history).lastAccepted);
    const specified = histories.map((history) => specLatestAccepted(history));

    // 1 + 5 + 25 + 125 histories, compared as one projection so a single
    // mismatch identifies its history by index.
    expect(histories).toHaveLength(156);
    expect(replayed).toEqual(specified);
  });

  // The exhaustive table above is bounded evidence. These properties extend
  // the same correspondence past its length limit, with generated keymaps that
  // no handwritten fixture covers.
  test('replay agrees with the spec for generated histories', () => {
    fc.assert(
      fc.property(replayHistoryArb, (history) => {
        expect(replayKeybindingObservations(history).lastAccepted).toEqual(specLatestAccepted(history));
      }),
      {numRuns: 100, seed: KEYBINDINGS_PROPERTY_SEED}
    );
  });

  test('a missing observation always replaces the accepted payload with the empty map', () => {
    fc.assert(
      fc.property(replayHistoryArb, (history) => {
        const observed = [...history, {kind: 'missing'} as const];
        const replayed = replayKeybindingObservations(observed);

        // Whatever was accepted before, a missing file is an accepted empty
        // map — the contract's `missing` transition, not a fallback.
        expect(replayed.lastAccepted).toEqual({});
        expect(replayed.lastAccepted).toEqual(specLatestAccepted(observed));
      }),
      {numRuns: 100, seed: KEYBINDINGS_PROPERTY_SEED}
    );
  });

  test('activeKeymaps reports the accepted payload or the empty map', () => {
    expect(activeKeymaps(accepted(seeds))).toBe(seeds);
    expect(activeKeymaps(rejected)).toEqual(emptyUserKeymaps());
  });

  test('emptyUserKeymaps returns a fresh map, so the spec === is value equality', () => {
    const first = emptyUserKeymaps();
    const second = emptyUserKeymaps();

    // The LemmaScript contract writes `===`, which is value equality there. The
    // TypeScript implementation returns a new object each call, so a reference
    // comparison would be false; the correspondence is by value, and the
    // assertions above use `toEqual` for that reason.
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
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
