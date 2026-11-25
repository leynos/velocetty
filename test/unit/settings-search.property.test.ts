/**
 * @file Metamorphic properties for the settings search filter.
 *
 * The LemmaScript proof covers soundness, completeness, and order for one
 * query. These properties relate queries to each other: token composition,
 * whitespace folding, per-category counting, and the `@modified` filter. All
 * inputs are already normalized, which is the contract `searchFieldIndices`
 * documents.
 */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {searchFieldIndices} from '@shared/settings/search';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

const WORDS = ['font', 'size', 'cursor', 'colour', 'shell', 'blink'] as const;
const CATEGORY_COUNT = 3;
const ALL = -1;

type Field = {
  readonly haystack: string;
  readonly isModified: boolean;
  readonly categoryIndex: number;
};

const wordArb = fc.constantFrom(...WORDS);
const haystackArb = fc.array(wordArb, {maxLength: 5}).map((words) => words.join(' '));
const fieldArb: fc.Arbitrary<Field> = fc.record({
  haystack: haystackArb,
  isModified: fc.boolean(),
  categoryIndex: fc.integer({min: 0, max: CATEGORY_COUNT - 1})
});
const fieldsArb = fc.array(fieldArb, {maxLength: 8});
const nonEmptyFieldsArb = fc.array(fieldArb, {minLength: 1, maxLength: 8});
const tokenQueryArb = fc.array(wordArb, {maxLength: 3}).map((words) => words.join(' '));
const categoryArb = fc.integer({min: ALL, max: CATEGORY_COUNT - 1});

const search = (fields: readonly Field[], query: string, selectedCategory = ALL): number[] =>
  searchFieldIndices(
    query,
    fields.map((field) => field.haystack),
    fields.map((field) => field.isModified),
    fields.map((field) => field.categoryIndex),
    selectedCategory
  );

const intersect = (left: readonly number[], right: readonly number[]): number[] => {
  const rightSet = new Set(right);
  return left.filter((index) => rightSet.has(index));
};

describe('settings search properties', () => {
  test('two token queries compose by intersection', () => {
    fc.assert(
      fc.property(fieldsArb, tokenQueryArb, tokenQueryArb, categoryArb, (fields, first, second, category) => {
        const combined = search(fields, `${first} ${second}`.trim(), category);
        expect(combined).toEqual(intersect(search(fields, first, category), search(fields, second, category)));
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('extra whitespace never changes the result', () => {
    fc.assert(
      fc.property(fieldsArb, tokenQueryArb, categoryArb, (fields, query, category) => {
        const padded = `  ${query.split(' ').join('   ')}  `;
        expect(search(fields, padded, category)).toEqual(search(fields, query, category));
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('per-category counts sum to the all-settings count', () => {
    fc.assert(
      fc.property(fieldsArb, tokenQueryArb, (fields, query) => {
        const all = search(fields, query, ALL).length;
        let sum = 0;
        for (let category = 0; category < CATEGORY_COUNT; category += 1) {
          sum += search(fields, query, category).length;
        }
        expect(sum).toBe(all);
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('the modified filter never returns an unmodified field', () => {
    fc.assert(
      fc.property(fieldsArb, (fields) => {
        const results = search(fields, '@modified');
        const unmodified = results.filter((index) => fields[index]?.isModified === false);
        expect(unmodified).toEqual([]);
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('the modified filter still honours the category selection', () => {
    fc.assert(
      fc.property(fieldsArb, fc.integer({min: 0, max: CATEGORY_COUNT - 1}), (fields, category) => {
        const results = search(fields, '@modified', category);
        const wrongCategory = results.filter((index) => fields[index]?.categoryIndex !== category);
        expect(wrongCategory).toEqual([]);
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('generated runs exercise non-empty and excluding results', () => {
    let nonEmpty = 0;
    let excluded = 0;
    let runs = 0;
    fc.assert(
      fc.property(nonEmptyFieldsArb, tokenQueryArb, (fields, query) => {
        runs += 1;
        const results = search(fields, query);
        if (results.length > 0) {
          nonEmpty += 1;
        }
        if (results.length < fields.length) {
          excluded += 1;
        }
        expect(new Set(results).size).toBe(results.length);
      }),
      {numRuns: fastCheckRunCount()}
    );
    expect(nonEmpty / runs).toBeGreaterThan(0.2);
    expect(excluded / runs).toBeGreaterThan(0.2);
  });
});
