/**
 * @file Tests for the fast-check run-count helper.
 */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {fastCheckRunCount, parseFastCheckRunCount} from '../testUtils/fast-check-runs';

const reverse = (values: readonly number[]): number[] => {
  const reversed: number[] = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    reversed.push(values[index]);
  }
  return reversed;
};

const reverseTwice = (values: readonly number[]): number[] => reverse(reverse(values));

describe('parseFastCheckRunCount', () => {
  test('defaults when the variable is absent', () => {
    expect(parseFastCheckRunCount()).toBe(200);
  });

  test('defaults when the value is malformed', () => {
    const malformed = ['', 'abc', '0', '-5', '1.5'];
    const parsed = malformed.map((raw) => parseFastCheckRunCount(raw));
    expect(parsed).toEqual([200, 200, 200, 200, 200]);
  });

  test('accepts a positive integer', () => {
    expect(parseFastCheckRunCount('1000')).toBe(1000);
    expect(parseFastCheckRunCount('1')).toBe(1);
  });
});

describe('fastCheckRunCount', () => {
  test('parses an explicit raw value', () => {
    expect(fastCheckRunCount('7')).toBe(7);
    expect(fastCheckRunCount('nonsense')).toBe(200);
  });
});

describe('fast-check under the shared gate', () => {
  test('runs a property through the configured helper', () => {
    const integerArrays = fc.array(fc.integer());
    const reversalIsAnInvolution = fc.property(integerArrays, (values) => {
      expect(reverseTwice(values)).toEqual(values);
    });
    fc.assert(reversalIsAnInvolution, {numRuns: fastCheckRunCount()});
  });
});
