/** @file Deterministic tokenizer for `when` expressions. */
import type {ContextKeyValue, WhenComparisonOperator} from '@shared/types/context-keys';

import {WhenExpressionSyntaxError} from './context-key-syntax-error';

export type TokenKind = 'identifier' | 'literal' | 'operator' | 'lparen' | 'rparen' | 'eof';
export type Token = {kind: TokenKind; lexeme: string; index: number; literal?: ContextKeyValue};

export const COMPARISON_OPERATORS: readonly WhenComparisonOperator[] = ['==', '!=', '<', '<=', '>', '>='];
const TWO_CHAR_OPERATORS = ['&&', '||', ...COMPARISON_OPERATORS] as const;
const SINGLE_CHAR_OPERATORS = ['!', '<', '>'] as const;

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
  return escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
};

const processEscapeSequence = (reader: SourceReader, pos: Position): {value: string; nextPosition: Position} => {
  const escaped = reader.source[pos.value + 1];
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
  const literal = lexeme === 'true' ? true : lexeme === 'false' ? false : lexeme === 'null' ? null : undefined;
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

const tryTokenizeParenthesis = (reader: SourceReader, pos: Position): TokenizeResult => {
  const char = reader.source[pos.value];
  if (char !== '(' && char !== ')') {
    return null;
  }

  return {
    token: {kind: char === '(' ? 'lparen' : 'rparen', lexeme: char, index: pos.value},
    next: pos.value + 1
  };
};

const tryTokenizeTwoCharOperator = (reader: SourceReader, pos: Position): TokenizeResult => {
  const twoChar = reader.source.slice(pos.value, pos.value + 2);
  if (!TWO_CHAR_OPERATORS.includes(twoChar as (typeof TWO_CHAR_OPERATORS)[number])) {
    return null;
  }

  return {
    token: {kind: 'operator', lexeme: twoChar, index: pos.value},
    next: pos.value + 2
  };
};

const tryTokenizeSingleCharOperator = (reader: SourceReader, pos: Position): TokenizeResult => {
  const char = reader.source[pos.value];
  if (!SINGLE_CHAR_OPERATORS.includes(char as (typeof SINGLE_CHAR_OPERATORS)[number])) {
    return null;
  }

  return {
    token: {kind: 'operator', lexeme: char, index: pos.value},
    next: pos.value + 1
  };
};

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
