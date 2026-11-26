/**
 * @file Shared control fixtures and case arbitraries for settings coercion.
 *
 * The round-trip properties and their coverage guard must draw from the same
 * generators. A local copy would let the guard prove coverage of fixtures the
 * properties no longer use, which is the vacuity it exists to prevent.
 */
import fc from 'fast-check';

import type {SettingValue} from '@shared/settings/coerce';
import type {ControlDescriptor} from '@shared/settings/panel-model';

/** Half-step values across a span, so fractional controls stay fractional. */
export const halves = (minimum: number, maximum: number): fc.Arbitrary<number> =>
  fc.integer({min: minimum * 2, max: maximum * 2}).map((steps) => steps / 2);

/**
 * Numeric controls: two fractional spans, one of them negative, and one
 * integer control.
 */
export const NUMBER_CONTROLS: readonly ControlDescriptor[] = [
  {kind: 'number', minimum: 6, maximum: 100, step: 0.5, isInteger: false},
  {kind: 'number', minimum: -20, maximum: 50, step: 0.5, isInteger: false},
  {kind: 'number', minimum: 1, maximum: 32, step: 1, isInteger: true}
];

/**
 * Non-number controls of every kind, including a select whose empty option is
 * a real value rather than a missing choice.
 */
export const OTHER_CONTROLS: readonly ControlDescriptor[] = [
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
      return fc.constantFrom(
        '#abc',
        '#AABBCC',
        '#aabbccdd',
        'rgb(1, 2, 3)',
        'rgb(100%, 0%, 50%)',
        'rgba(1, 2, 3, 0.4)',
        'rgba(1 2 3 / 40%)'
      );
    }
    case 'text': {
      return fc.string({minLength: 1}).filter((text) => text.trim().length > 0);
    }
  }
};

/** A control paired with a value that control can display. */
export type ControlCase = {readonly control: ControlDescriptor; readonly value: SettingValue};

const caseFor = (control: ControlDescriptor): fc.Arbitrary<ControlCase> =>
  valueFor(control).map((value) => ({control, value}));

/** Cases drawn from the numeric controls. */
export const numberCaseArb = fc.constantFrom(...NUMBER_CONTROLS).chain(caseFor);

/** Cases drawn from the non-number controls. */
export const otherCaseArb = fc.constantFrom(...OTHER_CONTROLS).chain(caseFor);
