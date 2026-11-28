/**
 * @file Shared type definitions for the JSON5 range scanner.
 *
 * Responsibilities:
 * - describe the index ranges and property records produced by the scanner.
 * - brand object keys so callers cannot confuse them with raw strings.
 *
 * Invariants:
 * - every index recorded in a range points into the original source document.
 *
 * Cross-links:
 * - `parsing-state.ts` for lexical state transitions.
 * - `parser.ts` for the public `Json5Parser` facade.
 */

/**
 * Delimits an object literal in raw JSON5 source.
 *
 * `openBraceIndex` points at the opening `{` character and `closeBraceIndex`
 * points at the matching closing `}` character.
 */
export type Json5ObjectRange = {openBraceIndex: number; closeBraceIndex: number};

/**
 * Captures a parsed key/value entry inside a JSON5 object.
 *
 * `keyStartIndex` points at the first character of the key token.
 * `valueStartIndex` is the first non-whitespace/comment character of the value.
 * `valueEndIndex` is the terminating delimiter index (`,` or `}` boundary).
 * `hasTrailingComma` is true when a comma follows the value before the next key.
 */
export type Json5ObjectProperty = {
  key: string;
  keyStartIndex: number;
  valueStartIndex: number;
  valueEndIndex: number;
  hasTrailingComma: boolean;
};

/** Read-only start/limit cursor window used for parser scans. */
export type ParseRange = {
  readonly startIndex: number;
  readonly limitIndex: number;
};

/** Read-only single cursor index wrapper used for parser helper calls. */
export type IndexCursor = {
  readonly index: number;
};

/** Read-only key wrapper used for object-property lookups. */
export type PropertyKey = {
  readonly value: string;
} & {readonly __brand: 'PropertyKey'};

/**
 * `propertyKey` constructs a `PropertyKey` from a raw key string.
 *
 * @param value String key value to wrap.
 * @returns A `PropertyKey` wrapper object containing the provided `value`.
 */
export const propertyKey = (value: string): PropertyKey => {
  // SAFETY: The branded wrapper contains the validated string key unchanged.
  return {value} as PropertyKey;
};

/** Parsed key token with its source span. */
export type ParsedObjectKey = {key: string; startIndex: number; endIndex: number};
