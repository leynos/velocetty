/** @file KB-LAYER-1: user keymaps override core keymaps, one command at a time. */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import type {rawConfig} from '@shared/types/config';
import {_init} from '../../app/config/init';
import mapKeys from '../../app/utils/map-keys';

const PROPERTY_SEED = 20_261_032;
const PROPERTY_RUNS = 200;
const REQUIRED_SHARE = 0.2;
const SAMPLE_COUNT = 2000;
const PROPERTY_OPTIONS = {numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED} as const;

/** Commands shared by both layers, so every sample has an overlapping case. */
const sharedCommandArb = fc.constantFrom('window:new', 'window:close', 'editor:paste');
/** Commands that can appear in either layer but rarely both. */
const accidentalCommandArb = fc.constantFrom('tab:next', 'tab:previous', 'pane:split', 'pane:close');
const commandArb = fc.oneof(sharedCommandArb, accidentalCommandArb);

/** A shortcut with no `:prefix` command and no deprecated `cmd` alias. */
const shortcutArb = fc.constantFrom('ctrl+a', 'alt+b', 'shift+c', 'command+d');

type Binding = string | string[];

const keymapsArb: fc.Arbitrary<Record<string, Binding>> = fc.dictionary(commandArb, shortcutArb, {
  maxKeys: 5,
  noNullPrototype: true
});

const baseConfig = (keymaps: Record<string, Binding>): rawConfig => ({
  config: {
    css: '',
    defaultProfile: 'default',
    profiles: [{name: 'default', config: {}}],
    termCSS: ''
  },
  keymaps,
  localPlugins: [],
  plugins: []
});

/** The expected merge: user value wins, then normalizes to an array. */
const expectedKeymaps = (defaults: Record<string, Binding>, user: Record<string, Binding>) => {
  const merged: Record<string, Binding> = {};
  for (const [command, binding] of Object.entries(defaults)) {
    merged[command] = binding;
  }
  for (const [command, binding] of Object.entries(user)) {
    merged[command] = binding;
  }

  const normalized: Record<string, string[]> = {};
  for (const [command, binding] of Object.entries(merged)) {
    normalized[command] = Array.isArray(binding) ? binding : [binding];
  }
  return normalized;
};

const layerKeymaps = (defaults: Record<string, Binding>, user: Record<string, Binding>, isSwapped = false) =>
  mapKeys(isSwapped ? {...user, ...defaults} : {...defaults, ...user});

const hasOverlap = ([defaults, user]: readonly [Record<string, Binding>, Record<string, Binding>]) =>
  Object.keys(defaults).some((command) => Object.hasOwn(user, command));

const hasDisjointCommand = ([defaults, user]: readonly [Record<string, Binding>, Record<string, Binding>]) =>
  Object.keys(defaults).some((command) => !Object.hasOwn(user, command)) ||
  Object.keys(user).some((command) => !Object.hasOwn(defaults, command));

test('KB-LAYER-1 user keymaps win for their commands and core keymaps survive otherwise', () => {
  fc.assert(
    fc.property(fc.tuple(keymapsArb, keymapsArb), ([defaults, user]) => {
      const parsed = _init(baseConfig(user), baseConfig(defaults), () => {});
      expect(parsed.keymaps).toEqual(expectedKeymaps(defaults, user));
    }),
    PROPERTY_OPTIONS
  );
});

test('the swapped spread order fails the property, so the law is not vacuous', () => {
  expect(() => {
    fc.assert(
      fc.property(fc.tuple(keymapsArb, keymapsArb), ([defaults, user]) => {
        expect(layerKeymaps(defaults, user, true)).toEqual(expectedKeymaps(defaults, user));
      }),
      PROPERTY_OPTIONS
    );
  }).toThrow();
});

test('an empty user binding unbinds a core shortcut', () => {
  const defaults = {'window:new': 'ctrl+n'} satisfies Record<string, Binding>;
  const user = {'window:new': []} satisfies Record<string, Binding>;

  const parsed = _init(baseConfig(user), baseConfig(defaults), () => {});

  expect(parsed.keymaps).toEqual({'window:new': []});
});

describe('KB-LAYER-1 layering coverage', () => {
  const samples = fc.sample(fc.tuple(keymapsArb, keymapsArb), {numRuns: SAMPLE_COUNT, seed: PROPERTY_SEED});
  const shareOf = (predicate: (sample: (typeof samples)[number]) => boolean): number =>
    samples.filter((sample) => predicate(sample)).length / samples.length;

  test('overlapping and disjoint commands are both well represented', () => {
    const shares = {
      'disjoint commands': shareOf(hasDisjointCommand),
      'overlapping commands': shareOf(hasOverlap)
    };

    for (const [label, share] of Object.entries(shares)) {
      expect(`${label}: ${share > REQUIRED_SHARE ? 'covered' : 'sparse'}`).toBe(`${label}: covered`);
    }
  });
});
