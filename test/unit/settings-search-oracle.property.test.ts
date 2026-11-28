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

const WORDS = [
  'font',
  'size',
  'cursor',
  'blink',
  'colour',
  'shell',
  '@modified',
  '@modifiedly',
  'FONT',
  'Size',
  'tab'
] as const;
const CATEGORY_COUNT = 3;
const ALL = -1;

type Field = {
  readonly haystack: string;
  readonly isModified: boolean;
  readonly categoryIndex: number;
};

/**
 * The D6 normalization written independently: lower-case, then fold every run
 * of whitespace to one space and trim. This must not call the module's own
 * helper; the point is to check it, not to repeat it.
 */
const referenceNormalize = (text: string): string =>
  text
    .toLowerCase()
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .join(' ');

/**
 * The D6 semantics written independently of the implementation.
 *
 * The function must not call `tokensOf`, `isModifiedQuery`, or any other
 * helper from the search module; it is the oracle, not a mirror of the code.
 */
const referenceMatches = (query: string, fields: readonly Field[], selectedCategory: number): number[] => {
  const parts = referenceNormalize(query).split(' ');
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
const noiseArb = fc
  .array(fc.constantFrom(' ', '\t', 'F', 'o', 'n', 't', '@', 'm', 'd', '-'), {maxLength: 12})
  .map((characters) => characters.join(''));
const haystackArb = fc
  .tuple(fc.array(wordArb, {maxLength: 5}), noiseArb)
  .map(([words, noise]) => `${words.join(' ')} ${noise}`);
const fieldArb: fc.Arbitrary<Field> = fc.record({
  haystack: haystackArb,
  isModified: fc.boolean(),
  categoryIndex: fc.integer({min: 0, max: CATEGORY_COUNT - 1})
});
const fieldsArb = fc.array(fieldArb, {maxLength: 8});
const queryArb = fc
  .tuple(fc.array(wordArb, {maxLength: 3}), noiseArb)
  .map(([words, noise]) => `${words.join(' ')} ${noise}`);
const categoryArb = fc.integer({min: ALL, max: CATEGORY_COUNT - 1});

test('normalization agrees with an independent implementation', () => {
  const textArb = fc.string({maxLength: 24});
  fc.assert(
    fc.property(textArb, (text) => {
      expect(normalizeSearchText(text)).toBe(referenceNormalize(text));
    }),
    {numRuns: fastCheckRunCount()}
  );
});

describe('settings search oracle', () => {
  test('the verified filter agrees with the independent D6 matcher', () => {
    fc.assert(
      fc.property(fieldsArb, queryArb, categoryArb, (fields, query, category) => {
        // The verified core takes normalized text, exactly as the production
        // hook passes it; the reference matcher normalizes for itself.
        const searchFields = {
          haystacks: fields.map((field) => referenceNormalize(field.haystack)),
          modifiedFlags: fields.map((field) => field.isModified),
          categoryIndices: fields.map((field) => field.categoryIndex)
        };
        const normalizedFields = fields.map((field) => ({
          ...field,
          haystack: referenceNormalize(field.haystack)
        }));
        expect(searchFieldIndices(referenceNormalize(query), searchFields, category)).toEqual(
          referenceMatches(query, normalizedFields, category)
        );
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
