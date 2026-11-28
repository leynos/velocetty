/**
 * @file Tests for the shared dictionary translator.
 */
import {describe, expect, test} from 'bun:test';

import {createTranslator} from '../../lib/i18n/create-translator';

describe('createTranslator', () => {
  test('returns the dictionary entry for a known key', () => {
    expect(createTranslator({hello: 'Hello'})('hello')).toBe('Hello');
  });

  test('falls back to the key itself', () => {
    expect(createTranslator({})('missing')).toBe('missing');
  });

  test('later dictionaries win', () => {
    const t = createTranslator({hello: 'Hello'}, {hello: 'Hi'});
    expect(t('hello')).toBe('Hi');
  });
});
