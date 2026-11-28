/**
 * @file JSON5 object parsing facade for runtime plugin settings persistence.
 *
 * Responsibilities:
 * - parse root-object and property ranges from raw JSON5 documents.
 * - preserve index metadata so roundtrip edits keep comments and formatting.
 *
 * Invariants:
 * - returned indices always stay within the original source bounds.
 * - parsing helpers never mutate the source document.
 *
 * Cross-links:
 * - `parsing-state.ts` for lexical state transitions.
 * - `object-scanner.ts` for value and brace boundary scans.
 * - `property-list.ts` for property enumeration.
 * - `../runtime/plugin-runtime-json5-roundtrip.ts` for persistence edits that
 *   consume these ranges.
 *
 * Example:
 * - `const parser = new Json5Parser(raw); parser.findRootObjectRange();`
 */
import {isString} from '../../utils/runtime-guards';
import {parserFailureSentinel} from './characters';
import {
  getLineIndent as scanLineIndent,
  getLineStartIndex as scanLineStartIndex,
  skipWhitespaceAndComments as scanWhitespaceAndComments
} from './lexer';
import {findMatchingClosingBrace} from './object-scanner';
import {parseObjectProperties as scanObjectProperties} from './property-list';
import type {IndexCursor, Json5ObjectProperty, Json5ObjectRange, ParseRange, PropertyKey} from './types';

const toKeyString = (key: PropertyKey | string): string => (isString(key) ? key : key.value);

/**
 * Parses and locates JSON5 object structures for round-trip-safe mutations.
 *
 * The parser operates on the original document string and returns index ranges
 * so callers can preserve formatting and comments while editing targeted values.
 */
export class Json5Parser {
  public constructor(private readonly raw: string) {}

  /**
   * Advances through whitespace and comments within a bounded scan range.
   *
   * @param range Scan bounds where `startIndex` is the initial cursor and
   * `limitIndex` is the exclusive end boundary.
   * @returns The next non-whitespace/comment index, or
   * `parserFailureSentinel` when an invalid token (such as an unterminated
   * block comment) is encountered.
   */
  public skipWhitespaceAndComments(range: ParseRange): number {
    return scanWhitespaceAndComments(this.raw, range);
  }

  /** Returns the index of the start of the line that contains `cursor.index`. */
  public getLineStartIndex(cursor: IndexCursor): number {
    return scanLineStartIndex(this.raw, cursor);
  }

  /** Returns the leading indentation (spaces/tabs) for the line at `cursor.index`. */
  public getLineIndent(cursor: IndexCursor): string {
    return scanLineIndent(this.raw, cursor);
  }

  /**
   * Parses properties within an object range while preserving source indices.
   *
   * Returns `null` when token order is invalid or parsing fails.
   */
  public parseObjectProperties(objectRange: Json5ObjectRange): Json5ObjectProperty[] | null {
    return scanObjectProperties(this.raw, objectRange);
  }

  /**
   * Locates the top-level object in the parser source.
   *
   * Returns `null` when no valid root object exists or trailing content remains.
   */
  public findRootObjectRange(): Json5ObjectRange | null {
    const rootStartIndex = scanWhitespaceAndComments(this.raw, {startIndex: 0, limitIndex: this.raw.length});
    if (rootStartIndex === parserFailureSentinel) {
      return null;
    }
    if (this.raw[rootStartIndex] !== '{') {
      return null;
    }
    const closeBraceIndex = findMatchingClosingBrace(this.raw, {index: rootStartIndex});
    if (closeBraceIndex === -1) {
      return null;
    }
    const trailingIndex = scanWhitespaceAndComments(this.raw, {
      startIndex: closeBraceIndex + 1,
      limitIndex: this.raw.length
    });
    if (trailingIndex === parserFailureSentinel) {
      return null;
    }
    if (trailingIndex !== this.raw.length) {
      return null;
    }
    return {openBraceIndex: rootStartIndex, closeBraceIndex};
  }

  /** Returns a parsed property by key from an object range, or `null` if missing. */
  public getObjectProperty(objectRange: Json5ObjectRange, key: PropertyKey | string): Json5ObjectProperty | null {
    const keyStr = toKeyString(key);
    const properties = this.parseObjectProperties(objectRange);
    if (!properties) {
      return null;
    }
    return properties.find((property) => property.key === keyStr) ?? null;
  }

  /** Resolves an object value range for a previously parsed property value. */
  public getObjectRangeForProperty(property: Json5ObjectProperty): Json5ObjectRange | null {
    const valueStart = scanWhitespaceAndComments(this.raw, {
      startIndex: property.valueStartIndex,
      limitIndex: property.valueEndIndex
    });
    if (valueStart === parserFailureSentinel) {
      return null;
    }
    if (this.raw[valueStart] !== '{') {
      return null;
    }
    const closeBraceIndex = findMatchingClosingBrace(this.raw, {index: valueStart});
    if (closeBraceIndex === -1 || closeBraceIndex > property.valueEndIndex) {
      return null;
    }
    return {openBraceIndex: valueStart, closeBraceIndex};
  }
}
