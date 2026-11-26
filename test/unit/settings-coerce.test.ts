/**
 * @file Boundary table for raw control input coercion.
 *
 * Every reason code exists because some input produces it, and the values
 * just outside each admitted range are the ones a user can actually type.
 */
import {describe, expect, test} from 'bun:test';

import {coerceInput, formatValue, isColourValue} from '@shared/settings/coerce';
import type {ControlDescriptor} from '@shared/settings/panel-model';

const FRACTIONAL: ControlDescriptor = {kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false};
const INTEGER: ControlDescriptor = {kind: 'number', minimum: 1, maximum: 32, step: 1, isInteger: true};
const CHANNEL: ControlDescriptor = {kind: 'select', options: ['canary', 'stable']};
const MODIFIER: ControlDescriptor = {kind: 'select', options: ['', 'alt', 'ctrl']};
const TOGGLE: ControlDescriptor = {kind: 'toggle'};
const TEXT: ControlDescriptor = {kind: 'text'};
const COLOUR: ControlDescriptor = {kind: 'colour'};

const NO_COLOUR: string | undefined = undefined;

const rejectedReason = (control: ControlDescriptor, raw: string): string | undefined => {
  const result = coerceInput(control, raw);
  return result.ok ? undefined : result.failure.reason;
};

describe('number coercion', () => {
  test('accepts decimal numbers inside the bounds', () => {
    expect(coerceInput(FRACTIONAL, '16')).toEqual({ok: true, value: 16});
    expect(coerceInput(FRACTIONAL, ' 16 ')).toEqual({ok: true, value: 16});
    expect(coerceInput(FRACTIONAL, '6')).toEqual({ok: true, value: 6});
    expect(coerceInput(FRACTIONAL, '100')).toEqual({ok: true, value: 100});
    expect(coerceInput(FRACTIONAL, '6.5')).toEqual({ok: true, value: 6.5});
    expect(coerceInput(FRACTIONAL, '+7')).toEqual({ok: true, value: 7});
    expect(coerceInput(FRACTIONAL, '1e2')).toEqual({ok: true, value: 100});
    expect(coerceInput(FRACTIONAL, '.5')).toEqual({
      ok: false,
      failure: {reason: 'below-minimum', minimum: 6, maximum: 100}
    });
  });

  test('rejects malformed and out-of-range numbers with a specific reason', () => {
    expect(rejectedReason(FRACTIONAL, '')).toBe('empty');
    expect(rejectedReason(FRACTIONAL, '   ')).toBe('empty');
    expect(rejectedReason(FRACTIONAL, 'abc')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, '12abc')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, '0x10')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, 'NaN')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, 'Infinity')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, '1_000')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, '1,000')).toBe('not-a-number');
    expect(rejectedReason(FRACTIONAL, '5.9')).toBe('below-minimum');
    expect(rejectedReason(FRACTIONAL, '100.1')).toBe('above-maximum');
  });

  test('carries the bounds for the message', () => {
    const result = coerceInput(FRACTIONAL, '-3');
    expect(result).toEqual({ok: false, failure: {reason: 'below-minimum', minimum: 6, maximum: 100}});
  });

  test('integer controls reject fractions', () => {
    expect(coerceInput(INTEGER, '8')).toEqual({ok: true, value: 8});
    expect(rejectedReason(INTEGER, '1.5')).toBe('not-an-integer');
    expect(rejectedReason(INTEGER, '0')).toBe('below-minimum');
    expect(rejectedReason(INTEGER, '33')).toBe('above-maximum');
  });
});

describe('select coercion', () => {
  test('accepts only exact options', () => {
    expect(coerceInput(CHANNEL, 'canary')).toEqual({ok: true, value: 'canary'});
    expect(coerceInput(CHANNEL, 'stable')).toEqual({ok: true, value: 'stable'});
    expect(rejectedReason(CHANNEL, 'Canary')).toBe('not-an-option');
    expect(rejectedReason(CHANNEL, ' beta')).toBe('not-an-option');
    expect(rejectedReason(CHANNEL, '')).toBe('empty');
  });

  test('an empty option is an option, not empty input', () => {
    expect(coerceInput(MODIFIER, '')).toEqual({ok: true, value: ''});
    expect(coerceInput(MODIFIER, 'ctrl')).toEqual({ok: true, value: 'ctrl'});
  });
});

describe('toggle coercion', () => {
  test('accepts the two display strings only', () => {
    expect(coerceInput(TOGGLE, 'true')).toEqual({ok: true, value: true});
    expect(coerceInput(TOGGLE, 'false')).toEqual({ok: true, value: false});
    expect(rejectedReason(TOGGLE, '1')).toBe('not-an-option');
    expect(rejectedReason(TOGGLE, 'yes')).toBe('not-an-option');
  });
});

describe('text coercion', () => {
  test('keeps the entered text but rejects blank input', () => {
    expect(coerceInput(TEXT, 'Menlo')).toEqual({ok: true, value: 'Menlo'});
    expect(coerceInput(TEXT, ' 12px 14px ')).toEqual({ok: true, value: ' 12px 14px '});
    expect(rejectedReason(TEXT, '   ')).toBe('empty');
    expect(rejectedReason(TEXT, '')).toBe('empty');
  });
});

describe('colour coercion', () => {
  test('accepts the supported colour syntaxes', () => {
    const accepted = [
      '#abc',
      '#AABBCC',
      '#aabbccdd',
      'rgb(0, 0, 0)',
      'rgb(255, 128, 0)',
      'rgb(100%, 0%, 50%)',
      'rgb(255 0 0)',
      'rgb(255 0 0 / 50%)',
      'rgba(0, 0, 0, 0.5)',
      'rgba(0, 0, 0, 50%)',
      'rgba(1 2 3 / 0.4)',
      // A percentage channel may be fractional, and an integer may be signed.
      'rgb(50.5%, 0%, 50%)',
      'rgb(+1, 2, 3)'
    ];
    expect(accepted.map((raw) => isColourValue(raw))).toEqual(accepted.map(() => true));
    expect(accepted.map((raw) => coerceInput(COLOUR, raw))).toEqual(accepted.map((value) => ({ok: true, value})));
  });

  test('rejects malformed components, counts, and separators', () => {
    const rejected = [
      '#ab',
      '#ggg',
      'rgb()',
      'rgb(+)',
      'rgba(,,,)',
      'rgb(1, 2)',
      'rgb(1, 2, 3, 4, 5)',
      'rgb(1, , 3)',
      'rgb(1 2 3 4)',
      'rgb(a, b, c)',
      'rgb(1;2;3)',
      // The terminal's parser rejects a decimal RGB channel.
      'rgb(1.5, 2, 3)',
      'rgba(1.5, 2, 3, 0.5)',
      'rgb(1.0, 2, 3)',
      'tomato',
      'red;',
      'url(#x)'
    ];
    expect(rejected.map((raw) => rejectedReason(COLOUR, raw))).toEqual(rejected.map(() => 'not-a-colour'));
    expect(rejectedReason(COLOUR, '  ')).toBe('empty');
  });
});

describe('formatValue', () => {
  test('renders each control kind for display', () => {
    expect(formatValue(TOGGLE, true)).toBe('true');
    expect(formatValue(TOGGLE, false)).toBe('false');
    expect(formatValue(FRACTIONAL, 14)).toBe('14');
    expect(formatValue(FRACTIONAL, 6.5)).toBe('6.5');
    expect(formatValue(TEXT, 'Menlo')).toBe('Menlo');
    expect(formatValue(COLOUR, NO_COLOUR)).toBe('');
  });

  test('round-trips every admitted value through its display text', () => {
    const values = [
      {control: FRACTIONAL, value: 14},
      {control: INTEGER, value: 8},
      {control: CHANNEL, value: 'canary'},
      {control: MODIFIER, value: ''},
      {control: TOGGLE, value: true},
      {control: COLOUR, value: '#1a2b3c'}
    ] as const;
    expect(values.map(({control, value}) => coerceInput(control, formatValue(control, value)))).toEqual(
      values.map(({value}) => ({ok: true, value}))
    );
  });
});
