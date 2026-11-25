/**
 * @file Round-trip properties for control coercion.
 *
 * The obligation is that every value a control can display is accepted when
 * it comes back as text, and that a rejection never silently changes the
 * value. Float-sensitive numbers live here rather than in the proofs because
 * LemmaScript models `number` as a mathematical integer.
 */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {coerceInput, formatValue, type SettingValue} from '@shared/settings/coerce';
import type {ControlDescriptor} from '@shared/settings/panel-model';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

const halves = (minimum: number, maximum: number): fc.Arbitrary<number> =>
  fc.integer({min: minimum * 2, max: maximum * 2}).map((steps) => steps / 2);

const NUMBER_CONTROLS: readonly ControlDescriptor[] = [
  {kind: 'number', minimum: 6, maximum: 100, step: 0.5, isInteger: false},
  {kind: 'number', minimum: -20, maximum: 50, step: 0.5, isInteger: false},
  {kind: 'number', minimum: 1, maximum: 32, step: 1, isInteger: true}
];

const OTHER_CONTROLS: readonly ControlDescriptor[] = [
  {kind: 'select', options: ['canary', 'stable']},
  {kind: 'select', options: ['', 'alt', 'ctrl']},
  {kind: 'toggle'},
  {kind: 'colour'},
  {kind: 'text'}
];

const valueFor = (control: ControlDescriptor): fc.Arbitrary<SettingValue> => {
  switch (control.kind) {
    case 'number': {
      return control.isInteger
        ? fc.integer({min: control.minimum, max: control.maximum})
        : halves(control.minimum, control.maximum);
    }
    case 'select': {
      return fc.constantFrom(...control.options);
    }
    case 'toggle': {
      return fc.boolean();
    }
    case 'colour': {
      return fc.constantFrom('#abc', '#AABBCC', '#aabbccdd', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.4)');
    }
    case 'text': {
      return fc.string({minLength: 1}).filter((text) => text.trim().length > 0);
    }
  }
};

type ControlCase = {readonly control: ControlDescriptor; readonly value: SettingValue};

const caseFor = (control: ControlDescriptor): fc.Arbitrary<ControlCase> =>
  valueFor(control).map((value) => ({control, value}));

const numberCaseArb = fc.constantFrom(...NUMBER_CONTROLS).chain(caseFor);
const otherCaseArb = fc.constantFrom(...OTHER_CONTROLS).chain(caseFor);

describe('settings coercion properties', () => {
  test('every admitted number round-trips through its display text', () => {
    fc.assert(
      fc.property(numberCaseArb, ({control, value}) => {
        expect(coerceInput(control, formatValue(control, value))).toEqual({ok: true, value});
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('select, toggle, colour, and text values round-trip', () => {
    fc.assert(
      fc.property(otherCaseArb, ({control, value}) => {
        expect(coerceInput(control, formatValue(control, value))).toEqual({ok: true, value});
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('generated inputs exercise both acceptance and rejection', () => {
    const control: ControlDescriptor = {kind: 'number', minimum: 6, maximum: 100, step: 0.5, isInteger: false};
    const rawArb = fc.oneof(
      halves(6, 100).map(String),
      fc.constantFrom('', 'abc', '12abc', '1e', 'NaN', '0x10', '5.9', '101')
    );
    let accepted = 0;
    let rejected = 0;
    let runs = 0;
    fc.assert(
      fc.property(rawArb, (raw) => {
        runs += 1;
        const result = coerceInput(control, raw);
        if (result.ok) {
          accepted += 1;
          expect(result.value).toBe(Number(raw));
        } else {
          rejected += 1;
        }
      }),
      {numRuns: fastCheckRunCount()}
    );
    expect(accepted / runs).toBeGreaterThan(0.25);
    expect(rejected / runs).toBeGreaterThan(0.25);
  });
});
