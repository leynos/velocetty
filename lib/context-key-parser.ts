/** @file Parser and compiler for deterministic `when` expressions. */
import type {
  CompiledWhenExpression,
  ContextKeyValue,
  WhenComparisonOperator,
  WhenExpressionNode,
  WhenExpressionParseError
} from '@shared/types/context-keys';

type TokenKind = 'identifier' | 'literal' | 'operator' | 'lparen' | 'rparen' | 'eof';
type Token = {kind: TokenKind; lexeme: string; index: number; literal?: ContextKeyValue};

const COMPARISON_OPERATORS: readonly WhenComparisonOperator[] = ['==', '!=', '<', '<=', '>', '>='];
const TWO_CHAR_OPERATORS = ['&&', '||', ...COMPARISON_OPERATORS] as const;

/** Structured parse error with stable source/index metadata. */
export class WhenExpressionSyntaxError extends SyntaxError implements WhenExpressionParseError {
  readonly source: string;
  readonly index: number;

  constructor(message: string, source: string, index: number) {
    super(message);
    this.name = 'WhenExpressionSyntaxError';
    this.source = source;
    this.index = index;
  }
}

const isWhitespace = (char: string) => /\s/u.test(char);
const isDigit = (char: string) => /[0-9]/u.test(char);
const isIdentifierStart = (char: string) => /[A-Za-z_$]/u.test(char);
const isIdentifierPart = (char: string) => /[A-Za-z0-9_.$]/u.test(char);

const mapEscapeSequence = (escaped: string): string => {
  return escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
};

const processEscapeSequence = (source: string, cursor: number): {value: string; nextCursor: number} => {
  const escaped = source[cursor + 1];
  if (escaped === undefined) {
    throw new WhenExpressionSyntaxError('Unterminated string literal', source, cursor);
  }

  return {
    value: mapEscapeSequence(escaped),
    nextCursor: cursor + 2
  };
};

const readString = (source: string, start: number): {token: Token; next: number} => {
  const quote = source[start];
  let cursor = start + 1;
  let value = '';

  while (cursor < source.length) {
    const char = source[cursor];
    if (char === quote) {
      return {
        token: {
          kind: 'literal',
          lexeme: source.slice(start, cursor + 1),
          index: start,
          literal: value
        },
        next: cursor + 1
      };
    }

    if (char === '\\') {
      const {value: escapedValue, nextCursor} = processEscapeSequence(source, cursor);
      value += escapedValue;
      cursor = nextCursor;
      continue;
    }

    value += char;
    cursor += 1;
  }

  throw new WhenExpressionSyntaxError('Unterminated string literal', source, start);
};

const readFractionalPart = (source: string, cursor: number, start: number): number => {
  if (source[cursor] !== '.') {
    return cursor;
  }

  let nextCursor = cursor + 1;
  const fractionStart = nextCursor;
  while (nextCursor < source.length && isDigit(source[nextCursor])) {
    nextCursor += 1;
  }

  if (fractionStart === nextCursor) {
    throw new WhenExpressionSyntaxError('Invalid numeric literal', source, start);
  }

  return nextCursor;
};

const readExponentPart = (source: string, cursor: number, start: number): number => {
  if (source[cursor] !== 'e' && source[cursor] !== 'E') {
    return cursor;
  }

  let nextCursor = cursor + 1;
  if (source[nextCursor] === '+' || source[nextCursor] === '-') {
    nextCursor += 1;
  }

  const exponentStart = nextCursor;
  while (nextCursor < source.length && isDigit(source[nextCursor])) {
    nextCursor += 1;
  }

  if (exponentStart === nextCursor) {
    throw new WhenExpressionSyntaxError('Invalid numeric literal exponent', source, start);
  }

  return nextCursor;
};

const readNumber = (source: string, start: number): {token: Token; next: number} => {
  let cursor = start;
  if (source[cursor] === '-') {
    cursor += 1;
  }

  while (cursor < source.length && isDigit(source[cursor])) {
    cursor += 1;
  }

  cursor = readFractionalPart(source, cursor, start);
  cursor = readExponentPart(source, cursor, start);

  const lexeme = source.slice(start, cursor);
  const literal = Number(lexeme);
  if (!Number.isFinite(literal)) {
    throw new WhenExpressionSyntaxError(`Invalid numeric literal '${lexeme}'`, source, start);
  }

  return {
    token: {kind: 'literal', lexeme, index: start, literal},
    next: cursor
  };
};

const readIdentifier = (source: string, start: number): {token: Token; next: number} => {
  let cursor = start + 1;
  while (cursor < source.length && isIdentifierPart(source[cursor])) {
    cursor += 1;
  }

  const lexeme = source.slice(start, cursor);
  const literal = lexeme === 'true' ? true : lexeme === 'false' ? false : lexeme === 'null' ? null : undefined;
  if (literal !== undefined || lexeme === 'null') {
    return {
      token: {kind: 'literal', lexeme, index: start, literal},
      next: cursor
    };
  }

  return {
    token: {kind: 'identifier', lexeme, index: start},
    next: cursor
  };
};

type TokenizeResult = {token: Token; next: number} | null;

const tryTokenizeWhitespace = (source: string, cursor: number): number | null => {
  return isWhitespace(source[cursor]) ? cursor + 1 : null;
};

const tryTokenizeParenthesis = (source: string, cursor: number): TokenizeResult => {
  const char = source[cursor];
  if (char !== '(' && char !== ')') {
    return null;
  }

  return {
    token: {kind: char === '(' ? 'lparen' : 'rparen', lexeme: char, index: cursor},
    next: cursor + 1
  };
};

const tryTokenizeTwoCharOperator = (source: string, cursor: number): TokenizeResult => {
  const twoChar = source.slice(cursor, cursor + 2);
  if (!TWO_CHAR_OPERATORS.includes(twoChar as (typeof TWO_CHAR_OPERATORS)[number])) {
    return null;
  }

  return {
    token: {kind: 'operator', lexeme: twoChar, index: cursor},
    next: cursor + 2
  };
};

const tryTokenizeSingleCharOperator = (source: string, cursor: number): TokenizeResult => {
  const char = source[cursor];
  if (char !== '!' && char !== '<' && char !== '>') {
    return null;
  }

  return {
    token: {kind: 'operator', lexeme: char, index: cursor},
    next: cursor + 1
  };
};

const tryTokenizeString = (source: string, cursor: number): TokenizeResult => {
  const char = source[cursor];
  if (char !== '"' && char !== "'") {
    return null;
  }

  return readString(source, cursor);
};

const tryTokenizeNumber = (source: string, cursor: number): TokenizeResult => {
  const char = source[cursor];
  if (!isDigit(char) && !(char === '-' && isDigit(source[cursor + 1] ?? ''))) {
    return null;
  }

  return readNumber(source, cursor);
};

const tryTokenizeIdentifier = (source: string, cursor: number): TokenizeResult => {
  if (!isIdentifierStart(source[cursor])) {
    return null;
  }

  return readIdentifier(source, cursor);
};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const whitespaceCursor = tryTokenizeWhitespace(source, cursor);
    if (whitespaceCursor !== null) {
      cursor = whitespaceCursor;
      continue;
    }

    const tokenized =
      tryTokenizeParenthesis(source, cursor) ??
      tryTokenizeTwoCharOperator(source, cursor) ??
      tryTokenizeSingleCharOperator(source, cursor) ??
      tryTokenizeString(source, cursor) ??
      tryTokenizeNumber(source, cursor) ??
      tryTokenizeIdentifier(source, cursor);

    if (tokenized) {
      tokens.push(tokenized.token);
      cursor = tokenized.next;
      continue;
    }

    const char = source[cursor];
    throw new WhenExpressionSyntaxError(`Unexpected token '${char}'`, source, cursor);
  }

  tokens.push({kind: 'eof', lexeme: '<eof>', index: source.length});
  return tokens;
};

class Parser {
  private cursor = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[]
  ) {}

  parse(): WhenExpressionNode {
    const expression = this.parseOr();
    this.expect('eof');
    return expression;
  }

  private parseOr(): WhenExpressionNode {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      left = {kind: 'logical', operator: '||', left, right: this.parseAnd()};
    }
    return left;
  }

  private parseAnd(): WhenExpressionNode {
    let left = this.parseComparison();
    while (this.matchOperator('&&')) {
      left = {kind: 'logical', operator: '&&', left, right: this.parseComparison()};
    }
    return left;
  }

  private parseComparison(): WhenExpressionNode {
    const left = this.parseUnary();
    if (!this.matchComparisonOperator()) {
      return left;
    }

    return {
      kind: 'comparison',
      operator: this.previous().lexeme as WhenComparisonOperator,
      left,
      right: this.parseUnary()
    };
  }

  private parseUnary(): WhenExpressionNode {
    return this.matchOperator('!') ? {kind: 'unary', operator: '!', operand: this.parseUnary()} : this.parsePrimary();
  }

  private parsePrimary(): WhenExpressionNode {
    if (this.match('lparen')) {
      const expression = this.parseOr();
      this.expect('rparen');
      return expression;
    }

    if (this.match('identifier')) {
      return {kind: 'identifier', key: this.previous().lexeme};
    }

    if (this.match('literal')) {
      return {kind: 'literal', value: this.previous().literal as ContextKeyValue};
    }

    const token = this.peek();
    throw new WhenExpressionSyntaxError(`Unexpected token '${token.lexeme}'`, this.source, token.index);
  }

  private match(kind: TokenKind): boolean {
    if (!this.check(kind)) {
      return false;
    }

    this.cursor += 1;
    return true;
  }

  private matchOperator(operator: string): boolean {
    const token = this.peek();
    if (token.kind !== 'operator' || token.lexeme !== operator) {
      return false;
    }

    this.cursor += 1;
    return true;
  }

  private matchComparisonOperator(): boolean {
    const token = this.peek();
    if (token.kind !== 'operator' || !COMPARISON_OPERATORS.includes(token.lexeme as WhenComparisonOperator)) {
      return false;
    }

    this.cursor += 1;
    return true;
  }

  private expect(kind: TokenKind): void {
    if (this.match(kind)) {
      return;
    }

    const token = this.peek();
    throw new WhenExpressionSyntaxError(`Expected ${kind} but found '${token.lexeme}'`, this.source, token.index);
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private peek(): Token {
    return this.tokens[this.cursor];
  }

  private previous(): Token {
    return this.tokens[this.cursor - 1];
  }
}

const freezeNode = (node: WhenExpressionNode): WhenExpressionNode => {
  if (node.kind === 'unary') {
    return Object.freeze({...node, operand: freezeNode(node.operand)});
  }

  if (node.kind === 'logical' || node.kind === 'comparison') {
    return Object.freeze({...node, left: freezeNode(node.left), right: freezeNode(node.right)});
  }

  return Object.freeze({...node});
};

/** Parses a `when` expression into an immutable AST. */
export const parseWhenExpression = (expression: string): WhenExpressionNode =>
  freezeNode(new Parser(expression, tokenize(expression)).parse());

/** Compiles a `when` expression to a stable source/AST payload. */
export const compileWhenExpression = (expression: string): CompiledWhenExpression =>
  Object.freeze({source: expression, ast: parseWhenExpression(expression)});
