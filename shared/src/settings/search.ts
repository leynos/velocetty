/**
 * @file Search over the settings panel model.
 *
 * The filter is the load-bearing part of the settings search box: a wrong
 * result silently hides a setting, so `searchFieldIndices` carries a
 * LemmaScript contract and is proved sound, complete, and order-preserving
 * (`shared/src/settings/search.dfy`). Text normalization (case folding and
 * whitespace folding) happens outside the verified core because Unicode case
 * mapping is not part of the proved model.
 */

/**
 * Splits a normalized query into the tokens that must all match.
 *
 * The exact token `@modified` is a filter, not a substring, so it never
 * reaches the returned list. Empty tokens (from repeated spaces) are dropped.
 *
 * @param query - A normalized query string.
 * @returns The substring tokens to match.
 *
 * @example
 * tokensOf('font  size'); // ['font', 'size']
 * tokensOf('@modified font'); // ['font']
 */
export function tokensOf(query: string): readonly string[] {
  //@ verify
  //@ pure
  return query.split(' ').filter((part) => part.length > 0 && part !== '@modified');
}

/**
 * Reports whether the query asks for modified settings only.
 *
 * @param query - A normalized query string.
 * @returns True when an exact `@modified` token is present.
 *
 * @example
 * isModifiedQuery('font @modified'); // true
 * isModifiedQuery('@modifiedly'); // false
 */
export function isModifiedQuery(query: string): boolean {
  //@ verify
  //@ pure
  return query.split(' ').some((part) => part === '@modified');
}

/**
 * Reports whether every token occurs in the haystack.
 *
 * An empty token list matches everything, which is what makes a bare
 * `@modified` query list every modified setting.
 *
 * @param haystack - Normalized searchable text for one field.
 * @param tokens - Substring tokens that must all occur.
 * @returns True when the field satisfies the token part of the query.
 *
 * @example
 * haystackMatchesTokens('font size', ['font']); // true
 * haystackMatchesTokens('font size', ['cursor']); // false
 */
export function haystackMatchesTokens(haystack: string, tokens: readonly string[]): boolean {
  //@ verify
  //@ pure
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Reports whether one field satisfies the whole query.
 *
 * A field matches when the modified filter (if any) passes, its category
 * filter passes, and every token occurs in its haystack. The category result
 * arrives as a boolean because that is the form the verified search loop
 * already holds, and it keeps the mathematical predicate to four arguments.
 *
 * @param query - A normalized query string.
 * @param haystack - Normalized searchable text for the field.
 * @param isModified - Whether the field is present in the user config file.
 * @param categoryMatches - Whether the field is in the selected category.
 * @returns True when the field belongs in the results.
 *
 * @example
 * fieldMatchesQuery('font', 'font size', false, true); // true
 * fieldMatchesQuery('@modified', 'font size', false, true); // false
 */
export function fieldMatchesQuery(
  query: string,
  haystack: string,
  isModified: boolean,
  categoryMatches: boolean
): boolean {
  //@ verify
  //@ pure
  if (isModifiedQuery(query) && !isModified) {
    return false;
  }
  if (!categoryMatches) {
    return false;
  }
  return haystackMatchesTokens(haystack, tokensOf(query));
}

/** The parallel per-field arrays a search runs over. */
export type SearchFields = Readonly<{
  /** Normalized searchable text, one entry per field. */
  readonly haystacks: readonly string[];
  /** Whether each field is present in the user config file. */
  readonly modifiedFlags: readonly boolean[];
  /** The category index of each field. */
  readonly categoryIndices: readonly number[];
}>;

/**
 * Returns the model indices that satisfy the query, in model order.
 *
 * The three parallel arrays describe one field each and must be the same
 * length. `selectedCategory` is an index into the caller's category list, or
 * -1 for "all settings".
 *
 * @param query - A normalized query string.
 * @param fields - The parallel per-field arrays to filter.
 * @param selectedCategory - The selected category index, or -1 for all.
 * @returns Strictly increasing indices of matching fields.
 *
 * @example
 * ```ts
 * searchFieldIndices('font', {haystacks: ['font size', 'cursor shape'], modifiedFlags: [false, false], categoryIndices: [0, 1]}, -1); // [0]
 * ```
 */
export function searchFieldIndices(query: string, fields: SearchFields, selectedCategory: number): number[] {
  //@ verify
  //@ requires query.length >= 0
  //@ requires fields.haystacks.length === fields.modifiedFlags.length
  //@ requires fields.haystacks.length === fields.categoryIndices.length
  //@ ensures forall(k: nat, k < \result.length ==> 0 <= \result[k] && \result[k] < fields.haystacks.length)
  //@ ensures forall(k: nat, k < \result.length ==> fieldMatchesQuery(query, fields.haystacks[\result[k]], fields.modifiedFlags[\result[k]], selectedCategory < 0 || fields.categoryIndices[\result[k]] === selectedCategory))
  //@ ensures forall(j: nat, j < fields.haystacks.length && fieldMatchesQuery(query, fields.haystacks[j], fields.modifiedFlags[j], selectedCategory < 0 || fields.categoryIndices[j] === selectedCategory) ==> \result.includes(j))
  //@ ensures forall(k: nat, 0 < k && k < \result.length ==> \result[k-1] < \result[k])
  const result: number[] = [];
  for (let index = 0; index < fields.haystacks.length; index = index + 1) {
    //@ invariant index >= 0 && index <= fields.haystacks.length
    //@ invariant forall(k: nat, k < result.length ==> 0 <= result[k] && result[k] < index)
    //@ invariant forall(k: nat, k < result.length && result[k] < fields.haystacks.length && result[k] < fields.modifiedFlags.length && result[k] < fields.categoryIndices.length ==> fieldMatchesQuery(query, fields.haystacks[result[k]], fields.modifiedFlags[result[k]], selectedCategory < 0 || fields.categoryIndices[result[k]] === selectedCategory))
    //@ invariant forall(j: nat, j < index && j < fields.haystacks.length && j < fields.modifiedFlags.length && j < fields.categoryIndices.length && fieldMatchesQuery(query, fields.haystacks[j], fields.modifiedFlags[j], selectedCategory < 0 || fields.categoryIndices[j] === selectedCategory) ==> result.includes(j))
    //@ invariant forall(k: nat, 0 < k && k < result.length ==> result[k-1] < result[k])
    // SAFETY: the loop condition bounds `index` by `fields.haystacks.length`.
    const haystack = fields.haystacks[index] as string;
    // SAFETY: the preconditions make `modifiedFlags` as long as `haystacks`.
    const isModified = fields.modifiedFlags[index] as boolean;
    // SAFETY: the preconditions make `categoryIndices` as long as `haystacks`.
    const categoryIndex = fields.categoryIndices[index] as number;
    const categoryMatches = selectedCategory < 0 || categoryIndex === selectedCategory;
    if (fieldMatchesQuery(query, haystack, isModified, categoryMatches)) {
      result.push(index);
    }
  }
  return result;
}

/**
 * Normalizes text for search: lower-cases it and folds whitespace runs.
 *
 * This runs outside the verified core, so its Unicode case mapping is a
 * deliberate, documented boundary rather than a proved property.
 *
 * @param text - Raw text from a label, key, description, or query.
 * @returns Lower-cased text with single spaces and no outer padding.
 *
 * @example
 * normalizeSearchText('  Font   Size '); // 'font size'
 */
export const normalizeSearchText = (text: string): string =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ');
