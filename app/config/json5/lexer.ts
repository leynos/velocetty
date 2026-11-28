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
 * - `source-text.ts` for the branded document text the steps share.
 * - `keys.ts` for object-key parsing built on these scans.
 */
import {
  isIdentifierCharacter,
  isIndentationWhitespace,
  isLineTerminator,
  isWhitespaceCharacter,
  parserFailureSentinel
} from './characters';
import {sourceText, type SourceText} from './source-text';
import type {IndexCursor, ParseRange} from './types';

type AdvanceContext = {
  readonly source: SourceText;
  readonly cursor: IndexCursor;
  readonly limitIndex: number;
};

type SkipResult = {kind: 'advanced'; nextIndex: number} | {kind: 'invalid'} | {kind: 'none'};

/** Skips a line comment and returns the index of its terminating line break. */
export const skipLineComment = (source: SourceText, range: ParseRange): number => {
  let index = range.startIndex + 2;
  while (index < range.limitIndex && !isLineTerminator(source[index])) {
    index += 1;
  }
  return index;
};

const isBlockCommentEnd = (source: SourceText, cursor: IndexCursor): boolean =>
  source[cursor.index] === '*' && source[cursor.index + 1] === '/';

/** Skips a C-style block comment, or returns the failure sentinel when unterminated. */
export const skipBlockComment = (source: SourceText, range: ParseRange): number => {
  for (let index = range.startIndex + 2; index + 1 < range.limitIndex; index += 1) {
    if (isBlockCommentEnd(source, {index})) {
      return index + 2;
    }
  }
  return parserFailureSentinel;
};

const isLineCommentStart = (current: string, next: string | undefined): boolean => current === '/' && next === '/';

const isBlockCommentStart = (current: string, next: string | undefined): boolean => current === '/' && next === '*';

/** Advances over a block comment, or reports the unterminated-comment failure. */
const advanceBlockComment = (ctx: AdvanceContext): SkipResult => {
  const nextIndex = skipBlockComment(ctx.source, {startIndex: ctx.cursor.index, limitIndex: ctx.limitIndex});
  return nextIndex === parserFailureSentinel ? {kind: 'invalid'} : {kind: 'advanced', nextIndex};
};

const tryAdvanceWhitespaceOrComment = (ctx: AdvanceContext): SkipResult => {
  const current = ctx.source[ctx.cursor.index];
  const next = ctx.source[ctx.cursor.index + 1];
  if (isWhitespaceCharacter(current)) {
    return {kind: 'advanced', nextIndex: ctx.cursor.index + 1};
  }
  if (isLineCommentStart(current, next)) {
    const nextIndex = skipLineComment(ctx.source, {startIndex: ctx.cursor.index, limitIndex: ctx.limitIndex});
    return {kind: 'advanced', nextIndex};
  }
  if (isBlockCommentStart(current, next)) {
    return advanceBlockComment(ctx);
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
  const source = sourceText(raw);
  let index = range.startIndex;
  while (index < range.limitIndex) {
    const skipResult = tryAdvanceWhitespaceOrComment({
      source,
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

const lineStartIndexFor = (source: SourceText, cursor: IndexCursor): number => {
  if (cursor.index === 0) {
    return 0;
  }
  for (let index = Math.max(0, cursor.index - 1); index >= 0; index -= 1) {
    if (isLineTerminator(source[index])) {
      return index + 1;
    }
  }
  return 0;
};

/** Returns the index of the start of the line that contains `cursor.index`. */
export const getLineStartIndex = (raw: string, cursor: IndexCursor): number =>
  lineStartIndexFor(sourceText(raw), cursor);

/** Returns the leading indentation (spaces/tabs) for the line at `cursor.index`. */
export const getLineIndent = (raw: string, cursor: IndexCursor): string => {
  const source = sourceText(raw);
  const lineStartIndex = lineStartIndexFor(source, cursor);
  let index = lineStartIndex;
  while (index < source.length && isIndentationWhitespace(source[index])) {
    index += 1;
  }
  return source.slice(lineStartIndex, index);
};

/** Returns the index just past a quoted string, or `-1` when unterminated. */
export const parseQuotedStringEnd = (raw: string, range: ParseRange): number => {
  const source = sourceText(raw);
  const quote = source[range.startIndex];
  let index = range.startIndex + 1;
  while (index < range.limitIndex) {
    const current = source[index];
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
export const readCodePoint = (
  source: SourceText,
  cursor: IndexCursor
): {character: string; nextIndex: number} | null => {
  const codePoint = source.codePointAt(cursor.index);
  if (codePoint === undefined) {
    return null;
  }
  const character = String.fromCodePoint(codePoint);
  return {
    character,
    nextIndex: cursor.index + character.length
  };
};

const isUnicodeEscapeStart = (source: SourceText, cursor: IndexCursor): boolean =>
  source[cursor.index] === '\\' && source[cursor.index + 1] === 'u';

/** Parses an ES6+ braced Unicode escape (`\u{...}`) at `cursor.index`. */
const parseBracedEscape = (source: SourceText, cursor: IndexCursor): {character: string; nextIndex: number} | null => {
  // Intentional leniency: JSON5 (ES5.1) only requires a four-hex-digit
  // escape, but this parser also accepts ES6+ braced escapes for unquoted
  // identifier keys. Roundtrip parser tests cover this behaviour.
  const hexStartIndex = cursor.index + 3;
  const closeBraceIndex = source.indexOf('}', hexStartIndex);
  if (closeBraceIndex === -1) {
    return null;
  }
  const codePointHex = source.slice(hexStartIndex, closeBraceIndex);
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
};

/** Parses a four-hex-digit Unicode escape (`\uXXXX`) at `cursor.index`. */
const parseFixedEscape = (source: SourceText, cursor: IndexCursor): {character: string; nextIndex: number} | null => {
  const hexStartIndex = cursor.index + 2;
  const hexEndIndex = hexStartIndex + 4;
  const codeUnit = source.slice(hexStartIndex, hexEndIndex);
  if (!/^[0-9A-Fa-f]{4}$/.test(codeUnit)) {
    return null;
  }
  return {
    character: String.fromCodePoint(Number.parseInt(codeUnit, 16)),
    nextIndex: hexEndIndex
  };
};

/** Parses a four-hex-digit or braced Unicode escape at `cursor.index`. */
export const parseUnicodeEscapeCharacter = (
  source: SourceText,
  cursor: IndexCursor
): {character: string; nextIndex: number} | null => {
  if (!isUnicodeEscapeStart(source, cursor)) {
    return null;
  }
  return source[cursor.index + 2] === '{' ? parseBracedEscape(source, cursor) : parseFixedEscape(source, cursor);
};

/** Parses one identifier character, resolving Unicode escapes first. */
export const parseIdentifierCharacter = (
  raw: string,
  cursor: IndexCursor,
  isStart: boolean
): {character: string; nextIndex: number} | null => {
  const source = sourceText(raw);
  const parsed = parseUnicodeEscapeCharacter(source, cursor) ?? readCodePoint(source, cursor);
  if (!parsed) {
    return null;
  }
  return isIdentifierCharacter(parsed.character, isStart) ? parsed : null;
};
