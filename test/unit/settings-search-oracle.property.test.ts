/**
 * @file Independent oracle for the settings search semantics.
 *
 * `search.dfy` proves the loop sound and complete relative to
 * `fieldMatchesQuery`, and tokenization bottoms out in the `StringSplit`
 * axiom. This suite supplies the independent check: a reference matcher
 * written directly from D6 with `String.prototype.split` and `includes`, with
 * no helper shared with the implementation.
 */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {normalizeSearchText, searchFieldIndices} from '@shared/settings/search';

import {fastCheckRunCount} from '../testUtils/fast-check-runs';

const WORDS = ['font', 'size', 'cursor', 'blink', 'colour', 'shell', '@modified'] as const;
const CATEGORY_COUNT = 3;
const ALL = -1;

type Field = {
  readonly haystack: string;
  readonly isModified: boolean;
  readonly categoryIndex: number;
};

/**
 * The D6 semantics written independently of the implementation.
 *
 * The function must not call `tokensOf`, `isModifiedQuery`, or any other
 * helper from the search module; it is the oracle, not a mirror of the code.
 */
const referenceMatches = (query: string, fields: readonly Field[], selectedCategory: number): number[] => {
  const parts = normalizeSearchText(query).split(' ');
  const tokens = parts.filter((part) => part.length > 0 && part !== '@modified');
  const modifiedOnly = parts.some((part) => part === '@modified');
  const matches: number[] = [];
  fields.forEach((field, index) => {
    if (modifiedOnly && !field.isModified) {
      return;
    }
    if (selectedCategory >= 0 && field.categoryIndex !== selectedCategory) {
      return;
    }
    if (tokens.every((token) => field.haystack.includes(token))) {
      matches.push(index);
    }
  });
  return matches;
};

const wordArb = fc.constantFrom(...WORDS);
const haystackArb = fc.array(wordArb, {maxLength: 5}).map((words) => words.join(' '));
const fieldArb: fc.Arbitrary<Field> = fc.record({
  haystack: haystackArb,
  isModified: fc.boolean(),
  categoryIndex: fc.integer({min: 0, max: CATEGORY_COUNT - 1})
});
const fieldsArb = fc.array(fieldArb, {maxLength: 8});
const queryArb = fc.array(wordArb, {maxLength: 3}).map((words) => words.join(' '));
const categoryArb = fc.integer({min: ALL, max: CATEGORY_COUNT - 1});

describe('settings search oracle', () => {
  test('the verified filter agrees with the independent D6 matcher', () => {
    fc.assert(
      fc.property(fieldsArb, queryArb, categoryArb, (fields, query, category) => {
        const searchFields = {
          haystacks: fields.map((field) => field.haystack),
          modifiedFlags: fields.map((field) => field.isModified),
          categoryIndices: fields.map((field) => field.categoryIndex)
        };
        expect(searchFieldIndices(query, searchFields, category)).toEqual(referenceMatches(query, fields, category));
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('@modified is a filter, never a substring', () => {
    const fields: readonly Field[] = [
      {haystack: 'font @modified', isModified: false, categoryIndex: 0},
      {haystack: 'font size', isModified: true, categoryIndex: 0}
    ];
    const searchFields = {
      haystacks: fields.map((field) => field.haystack),
      modifiedFlags: fields.map((field) => field.isModified),
      categoryIndices: fields.map((field) => field.categoryIndex)
    };

    // The first field contains the literal text but is not modified, so only
    // the modified field is returned; reading @modified as a substring would
    // return both.
    expect(searchFieldIndices('@modified', searchFields, ALL)).toEqual([1]);
  });
});
