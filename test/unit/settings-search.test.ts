/**
 * @file Named examples for the settings search filter.
 *
 * The property suite covers the general obligation; these examples pin the
 * behaviour the product scenarios describe, in the words the UI uses.
 */
import {describe, expect, test} from 'bun:test';

import {isModifiedQuery, normalizeSearchText, searchFieldIndices, tokensOf} from '@shared/settings/search';

const HAYSTACKS = ['font size', 'cursor shape', 'cursor blink', 'scrollback', 'shell'];
const MODIFIED = [true, false, false, true, false];
const CATEGORIES = [0, 1, 1, 2, 2];
const ALL = -1;

const search = (query: string, selectedCategory = ALL): number[] =>
  searchFieldIndices(query, HAYSTACKS, MODIFIED, CATEGORIES, selectedCategory);

describe('tokensOf', () => {
  test('splits on spaces and drops empty tokens', () => {
    expect(tokensOf('font  size')).toEqual(['font', 'size']);
    expect(tokensOf('  font  ')).toEqual(['font']);
  });

  test('drops the exact modified token but keeps lookalikes', () => {
    expect(tokensOf('@modified font')).toEqual(['font']);
    expect(tokensOf('@modifiedly')).toEqual(['@modifiedly']);
  });
});

describe('isModifiedQuery', () => {
  test('recognizes the exact token only', () => {
    expect(isModifiedQuery('font @modified')).toBe(true);
    expect(isModifiedQuery('@modifiedly')).toBe(false);
    expect(isModifiedQuery('font')).toBe(false);
  });
});

describe('normalizeSearchText', () => {
  test('lower-cases and folds whitespace', () => {
    expect(normalizeSearchText('  Font   SIZE ')).toBe('font size');
  });
});

describe('searchFieldIndices', () => {
  test('an empty query lists every field in model order', () => {
    expect(search('')).toEqual([0, 1, 2, 3, 4]);
  });

  test('a single token matches substrings', () => {
    expect(search('font')).toEqual([0]);
    expect(search('cursor')).toEqual([1, 2]);
  });

  test('every token must match', () => {
    expect(search('cursor blink')).toEqual([2]);
    expect(search('cursor scrollback')).toEqual([]);
  });

  test('the modified filter selects only changed settings', () => {
    expect(search('@modified')).toEqual([0, 3]);
    expect(search('@modified cursor')).toEqual([]);
  });

  test('a lookalike token is matched as a substring, not as the filter', () => {
    expect(search('@modifiedly')).toEqual([]);
    expect(search('@modifiedly', ALL)).toEqual([]);
  });

  test('a selected category filters the results', () => {
    expect(search('', 1)).toEqual([1, 2]);
    expect(search('scroll', 2)).toEqual([3]);
    expect(search('font', 1)).toEqual([]);
  });

  test('a query with no matches returns an empty list', () => {
    expect(search('zzzz')).toEqual([]);
  });

  test('results are strictly increasing', () => {
    const results = search('e');
    expect(results.length).toBeGreaterThan(1);
    const isStrictlyIncreasing = results.every((value, index) => index === 0 || results[index - 1] < value);
    expect(isStrictlyIncreasing).toBe(true);
  });

  test('a query can both include and exclude fields', () => {
    const results = search('c');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(HAYSTACKS.length);
  });

  test('extra spaces do not change the result', () => {
    expect(search('  cursor   blink  ')).toEqual(search('cursor blink'));
  });
});
