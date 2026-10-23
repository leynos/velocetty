/** @file Parity between the app-local runtime guards and the shared guards. */
import {describe, expect, test} from 'bun:test';

import {
  isBoolean as appIsBoolean,
  isFunction as appIsFunction,
  isJsonObject as appIsJsonObject,
  isJsonValue as appIsJsonValue,
  isNumber as appIsNumber,
  isObject as appIsObject,
  isString as appIsString
} from '../../app/utils/runtime-guards';
import {isBoolean, isFunction, isNumber, isObject, isString} from '../../shared/src/types/guards';
import {isJsonObject, isJsonValue} from '../../shared/src/types/json';

/** Absent value, named so the probe list reads as a set of cases. */
const absent = undefined;

/**
 * Values chosen to cover each branch the guards take.
 *
 * `Number.NaN` and `Infinity` are numbers `typeof` accepts, `null` is the
 * non-object the `isObject` null check exists for, and the nested entries
 * exercise the recursion an array cannot interrupt.
 */
// SAFETY: A prototype-less object is a legitimate probe value; it is a
// non-null object the recursion must walk like any other record.
const prototypeLessObject = Object.create(null) as unknown;

const probeValues: readonly unknown[] = [
  absent,
  null,
  true,
  false,
  0,
  1,
  -1,
  Number.NaN,
  Infinity,
  '',
  'text',
  [],
  [1, 'two', null],
  [[1], {nested: [true]}],
  {},
  {a: 1},
  {a: {b: [1, 2, {c: null}]}},
  {a: absent},
  {a: () => absent},
  {a: new Date(0)},
  new Date(0),
  Symbol('probe'),
  () => absent,
  class Probe {},
  new Map(),
  prototypeLessObject
];

/** Records which guard answered true for each probe value. */
const decisionsFor = (guards: {
  readonly boolean: (value: unknown) => boolean;
  readonly function: (value: unknown) => boolean;
  readonly jsonObject: (value: unknown) => boolean;
  readonly jsonValue: (value: unknown) => boolean;
  readonly number: (value: unknown) => boolean;
  readonly object: (value: unknown) => boolean;
  readonly string: (value: unknown) => boolean;
}): readonly string[] =>
  probeValues.map((value) =>
    [
      guards.string(value) ? 'string' : '',
      guards.number(value) ? 'number' : '',
      guards.boolean(value) ? 'boolean' : '',
      guards.function(value) ? 'function' : '',
      guards.object(value) ? 'object' : '',
      guards.jsonValue(value) ? 'jsonValue' : '',
      guards.jsonObject(value) ? 'jsonObject' : ''
    ]
      .filter(Boolean)
      .join('|')
  );

describe('app runtime guards parity', () => {
  test('decides every probe value the same way as the shared guards', () => {
    const appDecisions = decisionsFor({
      boolean: appIsBoolean,
      function: appIsFunction,
      jsonObject: appIsJsonObject,
      jsonValue: appIsJsonValue,
      number: appIsNumber,
      object: appIsObject,
      string: appIsString
    });
    const sharedDecisions = decisionsFor({
      boolean: isBoolean,
      function: isFunction,
      jsonObject: isJsonObject,
      jsonValue: isJsonValue,
      number: isNumber,
      object: isObject,
      string: isString
    });

    expect(appDecisions).toEqual(sharedDecisions);
  });

  test('narrows the same values the shared guards narrow', () => {
    // A guard that answered true everywhere would pass the decision-table
    // comparison only if the shared one did too, so pin the contract itself as
    // well: each guard must accept its own type and reject the neighbours.
    expect(appIsString('text')).toBe(true);
    expect(appIsString(1)).toBe(false);
    expect(appIsNumber(Number.NaN)).toBe(true);
    expect(appIsNumber('1')).toBe(false);
    expect(appIsBoolean(false)).toBe(true);
    expect(appIsBoolean(0)).toBe(false);
    expect(appIsFunction(() => absent)).toBe(true);
    expect(appIsFunction({})).toBe(false);
    expect(appIsObject([])).toBe(true);
    expect(appIsObject(null)).toBe(false);
    expect(appIsJsonObject([])).toBe(false);
    expect(appIsJsonObject({a: 1})).toBe(true);
    expect(appIsJsonValue([1, 'two', null])).toBe(true);
    expect(appIsJsonValue({a: () => absent})).toBe(false);
  });
});
