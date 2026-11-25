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
 * A field matches when the modified filter (if any) passes, its category is
 * the selected one (unless "all" is selected), and every token occurs in its
 * haystack.
 *
 * @param query - A normalized query string.
 * @param haystack - Normalized searchable text for the field.
 * @param isModified - Whether the field is present in the user config file.
 * @param categoryIndex - The field's category index.
 * @param selectedCategory - The selected category index, or -1 for all.
 * @returns True when the field belongs in the results.
 *
 * @example
 * fieldMatchesQuery('font', 'font size', false, 0, -1); // true
 * fieldMatchesQuery('@modified', 'font size', false, 0, -1); // false
 */
export function fieldMatchesQuery(
  query: string,
  haystack: string,
  isModified: boolean,
  categoryIndex: number,
  selectedCategory: number
): boolean {
  //@ verify
  //@ pure
  return (
    (!isModifiedQuery(query) || isModified) &&
    (selectedCategory < 0 || categoryIndex === selectedCategory) &&
    haystackMatchesTokens(haystack, tokensOf(query))
  );
}

/**
 * Returns the model indices that satisfy the query, in model order.
 *
 * The three parallel arrays describe one field each and must be the same
 * length. `selectedCategory` is an index into the caller's category list, or
 * -1 for "all settings".
 *
 * @param query - A normalized query string.
 * @param haystacks - Normalized searchable text, one entry per field.
 * @param modifiedFlags - Whether each field is modified.
 * @param categoryIndices - The category index of each field.
 * @param selectedCategory - The selected category index, or -1 for all.
 * @returns Strictly increasing indices of matching fields.
 *
 * @example
 * searchFieldIndices('font', ['font size', 'cursor shape'], [false, false], [0, 1], -1); // [0]
 */
export function searchFieldIndices(
  query: string,
  haystacks: readonly string[],
  modifiedFlags: readonly boolean[],
  categoryIndices: readonly number[],
  selectedCategory: number
): number[] {
  //@ verify
  //@ requires query.length >= 0
  //@ requires haystacks.length === modifiedFlags.length
  //@ requires haystacks.length === categoryIndices.length
  //@ ensures forall(k: nat, k < \result.length ==> 0 <= \result[k] && \result[k] < haystacks.length)
  //@ ensures forall(k: nat, k < \result.length ==> fieldMatchesQuery(query, haystacks[\result[k]], modifiedFlags[\result[k]], categoryIndices[\result[k]], selectedCategory))
  //@ ensures forall(j: nat, j < haystacks.length && fieldMatchesQuery(query, haystacks[j], modifiedFlags[j], categoryIndices[j], selectedCategory) ==> \result.includes(j))
  //@ ensures forall(k: nat, 0 < k && k < \result.length ==> \result[k-1] < \result[k])
  const tokens = tokensOf(query);
  const modifiedOnly = isModifiedQuery(query);
  const result: number[] = [];
  for (let index = 0; index < haystacks.length; index = index + 1) {
    //@ invariant index >= 0 && index <= haystacks.length
    //@ invariant forall(k: nat, k < result.length ==> 0 <= result[k] && result[k] < index)
    //@ invariant forall(k: nat, k < result.length && result[k] < haystacks.length && result[k] < modifiedFlags.length && result[k] < categoryIndices.length ==> fieldMatchesQuery(query, haystacks[result[k]], modifiedFlags[result[k]], categoryIndices[result[k]], selectedCategory))
    //@ invariant forall(j: nat, j < index && j < haystacks.length && j < modifiedFlags.length && j < categoryIndices.length && fieldMatchesQuery(query, haystacks[j], modifiedFlags[j], categoryIndices[j], selectedCategory) ==> result.includes(j))
    //@ invariant forall(k: nat, 0 < k && k < result.length ==> result[k-1] < result[k])
    // SAFETY: the loop condition bounds `index` by `haystacks.length`.
    const haystack = haystacks[index] as string;
    // SAFETY: the preconditions make `modifiedFlags` as long as `haystacks`.
    const isModified = modifiedFlags[index] as boolean;
    // SAFETY: the preconditions make `categoryIndices` as long as `haystacks`.
    const categoryIndex = categoryIndices[index] as number;
    if (
      (!modifiedOnly || isModified) &&
      (selectedCategory < 0 || categoryIndex === selectedCategory) &&
      haystackMatchesTokens(haystack, tokens)
    ) {
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
