/**
 * @file Lexical scanning helpers for JSON5 documents.
 *
 * Responsibilities:
 * - skip whitespace and comments within bounded scan ranges.
 * - resolve line starts, indentation, quoted string endings, and identifier
 *   characters, including Unicode escapes.
 *
 * Invariants:
 * - helpers never mutate the source document and respect the supplied limit.
 * - an unterminated block comment yields `parserFailureSentinel`.
 *
 * Cross-links:
 * - `characters.ts` for character predicates.
 * - `keys.ts` for object-key parsing built on these scans.
 */
import {
  isIdentifierCharacter,
  isIndentationWhitespace,
  isLineTerminator,
  isWhitespaceCharacter,
  parserFailureSentinel
} from './characters';
import type {IndexCursor, ParseRange} from './types';

type AdvanceContext = {
  readonly cursor: IndexCursor;
  readonly limitIndex: number;
};

type SkipResult = {kind: 'advanced'; nextIndex: number} | {kind: 'invalid'} | {kind: 'none'};

/** Skips a line comment and returns the index of its terminating line break. */
export const skipLineComment = (raw: string, range: ParseRange): number => {
  let index = range.startIndex + 2;
  while (index < range.limitIndex && !isLineTerminator(raw[index])) {
    index += 1;
  }
  return index;
};

const hasRoomForCommentEnd = (cursor: IndexCursor, limitIndex: number): boolean => cursor.index + 1 < limitIndex;

const isBlockCommentEnd = (raw: string, cursor: IndexCursor): boolean =>
  raw[cursor.index] === '*' && raw[cursor.index + 1] === '/';

/** Skips a C-style block comment, or returns the failure sentinel when unterminated. */
export const skipBlockComment = (raw: string, range: ParseRange): number => {
  // Skip the opening comment delimiter.
  let index = range.startIndex + 2;
  while (hasRoomForCommentEnd({index}, range.limitIndex) && !isBlockCommentEnd(raw, {index})) {
    index += 1;
  }
  return hasRoomForCommentEnd({index}, range.limitIndex) ? index + 2 : parserFailureSentinel;
};

const tryAdvanceWhitespaceOrComment = (raw: string, ctx: AdvanceContext): SkipResult => {
  const current = raw[ctx.cursor.index];
  const next = raw[ctx.cursor.index + 1];
  if (isWhitespaceCharacter(current)) {
    return {kind: 'advanced', nextIndex: ctx.cursor.index + 1};
  }
  if (current === '/' && next === '/') {
    const nextIndex = skipLineComment(raw, {startIndex: ctx.cursor.index, limitIndex: ctx.limitIndex});
    return {kind: 'advanced', nextIndex};
  }
  if (current === '/' && next === '*') {
    const nextIndex = skipBlockComment(raw, {startIndex: ctx.cursor.index, limitIndex: ctx.limitIndex});
    if (nextIndex === parserFailureSentinel) {
      return {kind: 'invalid'};
    }
    return {kind: 'advanced', nextIndex};
  }
  return {kind: 'none'};
};

/**
 * Advances through whitespace and comments within a bounded scan range.
 *
 * Returns the first non-whitespace/comment index or `-1` when an unterminated
 * block comment is encountered.
 */
export const skipWhitespaceAndComments = (raw: string, range: ParseRange): number => {
  let index = range.startIndex;
  while (index < range.limitIndex) {
    const skipResult = tryAdvanceWhitespaceOrComment(raw, {
      cursor: {index},
      limitIndex: range.limitIndex
    });
    if (skipResult.kind === 'advanced') {
      index = skipResult.nextIndex;
      continue;
    }
    if (skipResult.kind === 'invalid') {
      return parserFailureSentinel;
    }
    break;
  }
  return index;
};

/** Returns the index of the start of the line that contains `cursor.index`. */
export const getLineStartIndex = (raw: string, cursor: IndexCursor): number => {
  if (cursor.index === 0) {
    return 0;
  }
  for (let index = Math.max(0, cursor.index - 1); index >= 0; index -= 1) {
    if (isLineTerminator(raw[index])) {
      return index + 1;
    }
  }
  return 0;
};

/** Returns the leading indentation (spaces/tabs) for the line at `cursor.index`. */
export const getLineIndent = (raw: string, cursor: IndexCursor): string => {
  const lineStartIndex = getLineStartIndex(raw, cursor);
  let index = lineStartIndex;
  while (index < raw.length && isIndentationWhitespace(raw[index])) {
    index += 1;
  }
  return raw.slice(lineStartIndex, index);
};

/** Returns the index just past a quoted string, or `-1` when unterminated. */
export const parseQuotedStringEnd = (raw: string, range: ParseRange): number => {
  const quote = raw[range.startIndex];
  let index = range.startIndex + 1;
  while (index < range.limitIndex) {
    const current = raw[index];
    if (current === '\\') {
      if (index + 1 >= range.limitIndex) {
        return -1;
      }
      index += 2;
      continue;
    }
    if (current === quote) {
      return index + 1;
    }
    index += 1;
  }
  return -1;
};

/** Reads the code point at `cursor.index`, advancing by its UTF-16 length. */
export const readCodePoint = (raw: string, cursor: IndexCursor): {character: string; nextIndex: number} | null => {
  const codePoint = raw.codePointAt(cursor.index);
  if (codePoint === undefined) {
    return null;
  }
  const character = String.fromCodePoint(codePoint);
  return {
    character,
    nextIndex: cursor.index + character.length
  };
};

/** Parses a four-hex-digit or braced Unicode escape at `cursor.index`. */
export const parseUnicodeEscapeCharacter = (
  raw: string,
  cursor: IndexCursor
): {character: string; nextIndex: number} | null => {
  if (raw[cursor.index] !== '\\' || raw[cursor.index + 1] !== 'u') {
    return null;
  }

  // Intentional leniency: JSON5 (ES5.1) only requires a four-hex-digit
  // escape, but this parser also accepts ES6+ braced escapes for unquoted
  // identifier keys. Roundtrip parser tests cover this behaviour.
  if (raw[cursor.index + 2] === '{') {
    const hexStartIndex = cursor.index + 3;
    const closeBraceIndex = raw.indexOf('}', hexStartIndex);
    if (closeBraceIndex === -1) {
      return null;
    }
    const codePointHex = raw.slice(hexStartIndex, closeBraceIndex);
    if (!/^[0-9A-Fa-f]{1,6}$/.test(codePointHex)) {
      return null;
    }
    const codePoint = Number.parseInt(codePointHex, 16);
    if (codePoint > 0x10_ff_ff) {
      return null;
    }
    return {
      character: String.fromCodePoint(codePoint),
      nextIndex: closeBraceIndex + 1
    };
  }

  const hexStartIndex = cursor.index + 2;
  const hexEndIndex = hexStartIndex + 4;
  const codeUnit = raw.slice(hexStartIndex, hexEndIndex);
  if (!/^[0-9A-Fa-f]{4}$/.test(codeUnit)) {
    return null;
  }

  return {
    character: String.fromCodePoint(Number.parseInt(codeUnit, 16)),
    nextIndex: hexEndIndex
  };
};

/** Parses one identifier character, resolving Unicode escapes first. */
export const parseIdentifierCharacter = (
  raw: string,
  cursor: IndexCursor,
  isStart: boolean
): {character: string; nextIndex: number} | null => {
  const parsed = parseUnicodeEscapeCharacter(raw, cursor) ?? readCodePoint(raw, cursor);
  if (!parsed) {
    return null;
  }
  return isIdentifierCharacter(parsed.character, isStart) ? parsed : null;
};
