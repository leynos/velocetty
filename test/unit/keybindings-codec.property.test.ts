/** @file KB-COD-1 round trip and KB-COD-2 parser totality as fast-check properties. */
import {expect, test} from 'bun:test';
import fc from 'fast-check';

import {
  type KeybindingsParseOutcome,
  parseKeybindingsText,
  serializeKeybindings
} from '../../app/config/keybindings-codec';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import {isKeymapConfig} from '../../app/config/json5-config';
import {bindingArb, KEYBINDINGS_PROPERTY_SEED, keymapsArb, textDocArb} from '../testUtils/keybindings-arbitraries';

const PROPERTY_RUNS = 500;
const SOURCE = 'property-keybindings.json5';
const PROPERTY_OPTIONS = {numRuns: PROPERTY_RUNS, seed: KEYBINDINGS_PROPERTY_SEED} as const;

const sortedEntries = (keymaps: UserKeymaps) =>
  Object.entries(keymaps).toSorted(([left], [right]) => left.localeCompare(right));

const withEntriesInReverse = (keymaps: UserKeymaps): UserKeymaps =>
  Object.fromEntries(Object.entries(keymaps).toReversed());

const expectOk = (outcome: KeybindingsParseOutcome): UserKeymaps => {
  expect(outcome.kind).toBe('ok');
  if (outcome.kind !== 'ok') {
    throw new Error('Expected an ok outcome.');
  }
  return outcome.keymaps;
};

const assertRoundTrip = (keymaps: UserKeymaps): void => {
  const text = serializeKeybindings(keymaps);
  const parsed = expectOk(parseKeybindingsText(text, SOURCE));

  expect(sortedEntries(parsed)).toEqual(sortedEntries(keymaps));
  expect(serializeKeybindings(parsed)).toBe(text);
  expect(serializeKeybindings(withEntriesInReverse(keymaps))).toBe(text);
};

const assertDiagnostics = (outcome: KeybindingsParseOutcome): void => {
  expect(outcome.kind).toBe('invalid');
  if (outcome.kind !== 'invalid') {
    return;
  }
  expect(outcome.diagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of outcome.diagnostics) {
    expect(diagnostic.path.trim()).not.toBe('');
    expect(diagnostic.message.trim()).not.toBe('');
    expect(diagnostic.suggestedFix.trim()).not.toBe('');
  }
};

test('KB-COD-1 serialization round-trips through the parser', () => {
  fc.assert(
    fc.property(keymapsArb, (keymaps) => {
      assertRoundTrip(keymaps);
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-COD-2 the parser is total and its outcomes are well formed', () => {
  fc.assert(
    fc.property(textDocArb, (text) => {
      const outcome = parseKeybindingsText(text, SOURCE);

      if (outcome.kind === 'ok') {
        expect(isKeymapConfig(outcome.keymaps)).toBe(true);
        assertRoundTrip(outcome.keymaps);
      } else {
        assertDiagnostics(outcome);
      }
    }),
    PROPERTY_OPTIONS
  );
});

test('KB-COD-2 a valid binding always survives serialization', () => {
  fc.assert(
    fc.property(bindingArb, (binding) => {
      const keymaps: UserKeymaps = {'window:new': binding};
      const text = serializeKeybindings(keymaps);
      const parsed = expectOk(parseKeybindingsText(text, SOURCE));

      expect(parsed).toEqual(keymaps);
    }),
    PROPERTY_OPTIONS
  );
});
