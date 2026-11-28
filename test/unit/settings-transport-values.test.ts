/**
 * @file The transport-safe encoding of parsed JSON5 config values.
 *
 * `JSON5.parse` yields `NaN` and `Infinity`, which the renderer's JSON schema
 * rejects. The mapper turns them into the JSON5 text that denotes them and
 * returns a copy, so the snapshot a component receives cannot mutate the
 * parsed document.
 */
import {describe, expect, test} from 'bun:test';

import {transportSafeValues} from '../../app/settings/transport-values';

describe('transportSafeValues', () => {
  test('encodes non-finite numbers as their JSON5 text', () => {
    expect(transportSafeValues({fontSize: Number.NaN, scrollback: Infinity, depth: -Infinity})).toEqual({
      fontSize: 'NaN',
      scrollback: 'Infinity',
      depth: '-Infinity'
    });
  });

  test('encodes nested objects and arrays and keeps finite numbers', () => {
    const encoded = transportSafeValues({
      fontSize: 14,
      profiles: [{name: 'default', config: {fontSize: -Infinity}}]
    });

    expect(encoded).toEqual({
      fontSize: 14,
      profiles: [{name: 'default', config: {fontSize: '-Infinity'}}]
    });
  });

  test('keeps nulls, booleans, and strings unchanged', () => {
    expect(transportSafeValues({a: null, b: true, c: 'NaN', d: '#abc'})).toEqual({
      a: null,
      b: true,
      c: 'NaN',
      d: '#abc'
    });
  });

  test('returns a copy rather than the caller object', () => {
    const input = {fontSize: 14};
    const encoded = transportSafeValues(input);

    expect(encoded).not.toBe(input);
    expect(encoded).toEqual(input);
  });
});
