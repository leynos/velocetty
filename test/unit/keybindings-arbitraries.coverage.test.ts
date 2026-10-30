/** @file Non-vacuity guard for the keymap arbitraries used by KB-COD-1. */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {parseKeybindingsText} from '../../app/config/keybindings-codec';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import {isString} from '../../app/utils/runtime-guards';
import {
  hasIntegerLikeKey,
  hasPrototypeNamedKey,
  KEYBINDINGS_PROPERTY_SEED,
  keymapsArb,
  textDocArb
} from '../testUtils/keybindings-arbitraries';

const SAMPLE_COUNT = 2000;
const REQUIRED_SHARE = 0.05;

type BindingClass = 'string' | 'array' | 'empty-array';

const bindingsOf = (keymaps: UserKeymaps): readonly (string | string[])[] => Object.values(keymaps);

const classify = (binding: string | string[]): BindingClass => {
  if (!Array.isArray(binding)) {
    return 'string';
  }
  return binding.length === 0 ? 'empty-array' : 'array';
};

const shareOf = (samples: readonly UserKeymaps[], predicate: (keymaps: UserKeymaps) => boolean): number =>
  samples.filter((keymaps) => predicate(keymaps)).length / samples.length;

const hasBindingClass = (samples: readonly UserKeymaps[], bindingClass: BindingClass): number =>
  shareOf(samples, (keymaps) => bindingsOf(keymaps).some((binding) => classify(binding) === bindingClass));

describe('keymap arbitrary coverage', () => {
  const samples = fc.sample(keymapsArb, {numRuns: SAMPLE_COUNT, seed: KEYBINDINGS_PROPERTY_SEED});

  test('each key and binding class appears in more than five per cent of samples', () => {
    const shares = {
      'array values': hasBindingClass(samples, 'array'),
      'empty arrays': hasBindingClass(samples, 'empty-array'),
      'integer-like keys': shareOf(samples, hasIntegerLikeKey),
      'prototype-named keys': shareOf(samples, hasPrototypeNamedKey),
      'string values': hasBindingClass(samples, 'string')
    };

    for (const [label, share] of Object.entries(shares)) {
      expect(`${label}: ${share > REQUIRED_SHARE ? 'covered' : 'sparse'}`).toBe(`${label}: covered`);
    }
  });

  test('the totality property sees both outcomes in more than ten per cent of samples', () => {
    const documents = fc.sample(textDocArb, {numRuns: SAMPLE_COUNT, seed: KEYBINDINGS_PROPERTY_SEED});
    const accepted = documents.filter((text) => parseKeybindingsText(text, 'sample.json5').kind === 'ok').length;
    const acceptedShare = accepted / documents.length;

    expect(acceptedShare).toBeGreaterThan(0.1);
    expect(1 - acceptedShare).toBeGreaterThan(0.1);
  });

  test('prototype-named samples own the key without replacing the prototype', () => {
    const withProto = samples.find((keymaps) => Object.hasOwn(keymaps, '__proto__'));

    expect(withProto).toBeDefined();
    expect(Object.getPrototypeOf(withProto)).toBe(Object.prototype);
    const ownValue = Object.getOwnPropertyDescriptor(withProto, '__proto__')?.value;
    const isBindingValue = isString(ownValue) || (Array.isArray(ownValue) && ownValue.every((item) => isString(item)));
    expect(isBindingValue).toBe(true);
  });
});
