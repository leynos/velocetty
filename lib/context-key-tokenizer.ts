/** @file Deterministic tokenizer for `when` expressions. */
import type {ContextKeyValue, WhenComparisonOperator} from '@shared/types/context-keys';

import {WhenExpressionSyntaxError} from './context-key-syntax-error';

export type Token =
  | {kind: 'identifier'; lexeme: string; index: number}
  | {kind: 'literal'; lexeme: string; index: number; literal: ContextKeyValue}
  | {kind: 'operator'; lexeme: WhenComparisonOperator | '&&' | '||' | '!'; index: number}
  | {kind: 'lparen' | 'rparen' | 'eof'; lexeme: string; index: number};
export type TokenKind = Token['kind'];

export const COMPARISON_OPERATORS: readonly WhenComparisonOperator[] = ['==', '!=', '<', '<=', '>', '>='];
const TWO_CHAR_OPERATORS = ['&&', '||', ...COMPARISON_OPERATORS] as const;
const SINGLE_CHAR_OPERATORS = ['!', '<', '>'] as const;

/**
 * Narrows a lexeme to a comparison operator.
 *
 * Exported because the parser asks the same question of a token it has already
 * read; keeping one list means the two can never disagree about which lexemes
 * are comparisons.
 */
export const isComparisonOperator = (value: string): value is WhenComparisonOperator =>
  value === '==' || value === '!=' || value === '<' || value === '<=' || value === '>' || value === '>=';

const isTwoCharOperator = (value: string): value is (typeof TWO_CHAR_OPERATORS)[number] =>
  value === '&&' || value === '||' || isComparisonOperator(value);

const isSingleCharOperator = (value: string): value is (typeof SINGLE_CHAR_OPERATORS)[number] =>
  value === '!' || value === '<' || value === '>';

class SourceReader {
  constructor(
    readonly source: string,
    private cursor: number = 0
  ) {}

  get position(): number {
    return this.cursor;
  }

  get isAtEnd(): boolean {
    return this.cursor >= this.source.length;
  }

  peek(offset: number = 0): string | undefined {
    return this.source[this.cursor + offset];
  }

  advance(count: number = 1): void {
    this.cursor += count;
  }

  slice(start: number, end?: number): string {
    return this.source.slice(start, end);
  }

  remaining(): string {
    return this.source.slice(this.cursor);
  }
}

/** Encapsulates a position in source text for type-safe position tracking. */
class Position {
  constructor(readonly value: number) {}

  advance(count: number = 1): Position {
    return new Position(this.value + count);
  }

  static readonly ZERO = new Position(0);
}

type ReadResult = {token: Token; consumed: number};

type TokenizeResult = {token: Token; next: number} | null;

const isWhitespace = (char: string) => /\s/u.test(char);
const isDigit = (char: string) => /[0-9]/u.test(char);
const isIdentifierStart = (char: string) => /[A-Za-z_$]/u.test(char);
const isIdentifierPart = (char: string) => /[A-Za-z0-9_.$]/u.test(char);
const isNumberStart = (reader: SourceReader, pos: Position): boolean => {
  const char = reader.source[pos.value];
  if (isDigit(char)) {
    return true;
  }
  if (char === '-' && isDigit(reader.source[pos.value + 1] ?? '')) {
    return true;
  }
  return false;
};

const mapEscapeSequence = (escaped: string): string => {
  switch (escaped) {
    case 'n': {
      return '\n';
    }
    case 'r': {
      return '\r';
    }
    case 't': {
      return '\t';
    }
    default: {
      return escaped;
    }
  }
};

const processEscapeSequence = (reader: SourceReader, pos: Position) => {
  const escaped = reader.source.at(pos.value + 1);
  if (escaped === undefined) {
    throw new WhenExpressionSyntaxError('Unterminated string literal', reader.source, pos.value);
  }

  return {
    value: mapEscapeSequence(escaped),
    nextPosition: pos.advance(2)
  };
};

const readString = (reader: SourceReader, startPos: Position): ReadResult => {
  const {source} = reader;
  const quote = source[startPos.value];
  let cursor = startPos.advance();
  let value = '';

  while (cursor.value < source.length) {
    const char = source[cursor.value];
    if (char === quote) {
      return {
        token: {
          kind: 'literal',
          lexeme: source.slice(startPos.value, cursor.value + 1),
          index: startPos.value,
          literal: value
        },
        consumed: cursor.value + 1 - startPos.value
      };
    }

    if (char === '\\') {
      const {value: escapedValue, nextPosition} = processEscapeSequence(reader, cursor);
      value += escapedValue;
      cursor = nextPosition;
      continue;
    }

    value += char;
    cursor = cursor.advance();
  }

  throw new WhenExpressionSyntaxError('Unterminated string literal', source, startPos.value);
};

const readFractionalPart = (reader: SourceReader, pos: Position, start: Position): Position => {
  const {source} = reader;
  if (source[pos.value] !== '.') {
    return pos;
  }

  let current = pos.advance();
  const fractionStart = current;
  while (current.value < source.length && isDigit(source[current.value])) {
    current = current.advance();
  }

  if (fractionStart.value === current.value) {
    throw new WhenExpressionSyntaxError('Invalid numeric literal', source, start.value);
  }

  return current;
};

const isExponentMarker = (char: string): boolean => {
  return char === 'e' || char === 'E';
};

const advanceAfterOptionalSign = (reader: SourceReader, pos: Position): Position => {
  const char = reader.source[pos.value];
  if (char === '+' || char === '-') {
    return pos.advance();
  }
  return pos;
};

const readExponentDigits = (reader: SourceReader, pos: Position, start: Position): Position => {
  const digitStart = pos;
  let current = pos;

  while (current.value < reader.source.length && isDigit(reader.source[current.value])) {
    current = current.advance();
  }

  if (digitStart.value === current.value) {
    throw new WhenExpressionSyntaxError('Invalid numeric literal exponent', reader.source, start.value);
  }

  return current;
};

const readExponentPart = (reader: SourceReader, pos: Position, start: Position): Position => {
  const {source} = reader;
  if (!isExponentMarker(source[pos.value])) {
    return pos;
  }

  const afterMarker = pos.advance();
  const afterOptionalSign = advanceAfterOptionalSign(reader, afterMarker);
  return readExponentDigits(reader, afterOptionalSign, start);
};

const readNumber = (reader: SourceReader, startPos: Position): ReadResult => {
  const {source} = reader;
  let cursor = startPos;
  if (source[cursor.value] === '-') {
    cursor = cursor.advance();
  }

  while (cursor.value < source.length && isDigit(source[cursor.value])) {
    cursor = cursor.advance();
  }

  cursor = readFractionalPart(reader, cursor, startPos);
  cursor = readExponentPart(reader, cursor, startPos);

  const lexeme = source.slice(startPos.value, cursor.value);
  const literal = Number(lexeme);
  if (!Number.isFinite(literal)) {
    throw new WhenExpressionSyntaxError(`Invalid numeric literal '${lexeme}'`, source, startPos.value);
  }

  return {
    token: {kind: 'literal', lexeme, index: startPos.value, literal},
    consumed: cursor.value - startPos.value
  };
};

const readIdentifier = (reader: SourceReader, startPos: Position): ReadResult => {
  const {source} = reader;
  let cursor = startPos.advance();
  while (cursor.value < source.length && isIdentifierPart(source[cursor.value])) {
    cursor = cursor.advance();
  }

  const lexeme = source.slice(startPos.value, cursor.value);
  let literal: boolean | null | undefined;
  switch (lexeme) {
    case 'true': {
      literal = true;
      break;
    }
    case 'false': {
      literal = false;
      break;
    }
    case 'null': {
      literal = null;
      break;
    }
    default: {
      literal = undefined;
    }
  }
  if (literal !== undefined) {
    return {
      token: {kind: 'literal', lexeme, index: startPos.value, literal},
      consumed: cursor.value - startPos.value
    };
  }

  return {
    token: {kind: 'identifier', lexeme, index: startPos.value},
    consumed: cursor.value - startPos.value
  };
};

const tryTokenizeWhitespace = (reader: SourceReader, pos: Position): number | null => {
  return isWhitespace(reader.source[pos.value]) ? pos.value + 1 : null;
};

/**
 * Wraps a token as a successful read, or passes `null` through as a miss.
 *
 * Each mapper below decides the token's kind and lexeme; this only decides that
 * a successful read consumes the lexeme it matched, which is what keeps the
 * three tokenizers' cursor arithmetic identical.
 */
const emitToken = (token: Token | null, pos: Position): TokenizeResult =>
  token && {token, next: pos.value + token.lexeme.length};

const parenthesisToken = (char: string, pos: Position): Token | null => {
  if (char === '(') {
    return {kind: 'lparen', lexeme: char, index: pos.value};
  }
  return char === ')' ? {kind: 'rparen', lexeme: char, index: pos.value} : null;
};

/**
 * The two operator mappers stay separate on purpose: sharing one predicate
 * would let the two-character reader accept a lone `!`, then consume a
 * character it never matched.
 */
const twoCharOperatorToken = (lexeme: string, pos: Position): Token | null =>
  isTwoCharOperator(lexeme) ? {kind: 'operator', lexeme, index: pos.value} : null;

const singleCharOperatorToken = (lexeme: string, pos: Position): Token | null =>
  isSingleCharOperator(lexeme) ? {kind: 'operator', lexeme, index: pos.value} : null;

const tryTokenizeParenthesis = (reader: SourceReader, pos: Position): TokenizeResult =>
  emitToken(parenthesisToken(reader.source[pos.value], pos), pos);

const tryTokenizeTwoCharOperator = (reader: SourceReader, pos: Position): TokenizeResult =>
  emitToken(twoCharOperatorToken(reader.source.slice(pos.value, pos.value + 2), pos), pos);

const tryTokenizeSingleCharOperator = (reader: SourceReader, pos: Position): TokenizeResult =>
  emitToken(singleCharOperatorToken(reader.source[pos.value], pos), pos);

const tryTokenizeString = (reader: SourceReader, pos: Position): TokenizeResult => {
  const char = reader.source[pos.value];
  if (char !== '"' && char !== "'") {
    return null;
  }

  const result = readString(reader, pos);
  return {token: result.token, next: pos.value + result.consumed};
};

const tryTokenizeNumber = (reader: SourceReader, pos: Position): TokenizeResult => {
  if (!isNumberStart(reader, pos)) {
    return null;
  }

  const result = readNumber(reader, pos);
  return {token: result.token, next: pos.value + result.consumed};
};

const tryTokenizeIdentifier = (reader: SourceReader, pos: Position): TokenizeResult => {
  if (!isIdentifierStart(reader.source[pos.value])) {
    return null;
  }

  const result = readIdentifier(reader, pos);
  return {token: result.token, next: pos.value + result.consumed};
};

/** Tokenizes a `when` expression string into parser tokens. */
export const tokenize = (source: string): Token[] => {
  const reader = new SourceReader(source);
  const tokens: Token[] = [];
  let pos = Position.ZERO;

  while (pos.value < reader.source.length) {
    const whitespaceCursor = tryTokenizeWhitespace(reader, pos);
    if (whitespaceCursor !== null) {
      pos = new Position(whitespaceCursor);
      continue;
    }

    const tokenized =
      tryTokenizeParenthesis(reader, pos) ??
      tryTokenizeTwoCharOperator(reader, pos) ??
      tryTokenizeSingleCharOperator(reader, pos) ??
      tryTokenizeString(reader, pos) ??
      tryTokenizeNumber(reader, pos) ??
      tryTokenizeIdentifier(reader, pos);

    if (tokenized) {
      tokens.push(tokenized.token);
      pos = new Position(tokenized.next);
      continue;
    }

    const char = source[pos.value];
    throw new WhenExpressionSyntaxError(`Unexpected token '${char}'`, source, pos.value);
  }

  tokens.push({kind: 'eof', lexeme: '<eof>', index: source.length});
  return tokens;
};
