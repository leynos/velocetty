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

import {coerceInput, formatValue} from '@shared/settings/coerce';
import type {ControlDescriptor} from '@shared/settings/panel-model';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';
import {halves, numberCaseArb, otherCaseArb, type ControlCase} from '../testUtils/settings-coercion-arbitraries';

const COVERAGE_SAMPLE_COUNT = 2000;
const COVERAGE_SEED = 20_261_126;
const REQUIRED_SHARE = 0.05;

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

describe('settings coercion arbitrary coverage', () => {
  // A fixed seed makes this a reproducible guard: a generator change that
  // starves a control family fails here instead of depending on chance.
  const samples = fc.sample(fc.tuple(numberCaseArb, otherCaseArb), {
    numRuns: COVERAGE_SAMPLE_COUNT,
    seed: COVERAGE_SEED
  });
  const numericControls = samples.map(([numeric]) => numeric.control);
  const nonNumericCases = samples.map(([, nonNumeric]) => nonNumeric);

  /** The fraction of numeric samples that satisfy `predicate`. */
  const numericShare = (predicate: (control: ControlDescriptor) => boolean): number =>
    numericControls.filter((control) => predicate(control)).length / numericControls.length;

  /** The fraction of non-numeric samples that satisfy `predicate`. */
  const nonNumericShare = (predicate: (sample: ControlCase) => boolean): number =>
    nonNumericCases.filter((sample) => predicate(sample)).length / nonNumericCases.length;

  test('every control family and the empty select option is well represented', () => {
    const shares = {
      'fractional number controls': numericShare((control) => control.kind === 'number' && !control.isInteger),
      'integer number controls': numericShare((control) => control.kind === 'number' && control.isInteger),
      'select controls': nonNumericShare(({control}) => control.kind === 'select'),
      'toggle controls': nonNumericShare(({control}) => control.kind === 'toggle'),
      'colour controls': nonNumericShare(({control}) => control.kind === 'colour'),
      'text controls': nonNumericShare(({control}) => control.kind === 'text'),
      'the empty select option': nonNumericShare(({value}) => value === '')
    };

    for (const [label, share] of Object.entries(shares)) {
      expect(`${label}: ${share > REQUIRED_SHARE ? 'covered' : 'sparse'}`).toBe(`${label}: covered`);
    }
  });
});
