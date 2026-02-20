/** @file Parser and compiler for deterministic `when` expressions. */
import type {
  CompiledWhenExpression,
  ContextKeyValue,
  WhenComparisonOperator,
  WhenExpressionNode
} from '@shared/types/context-keys';

import {COMPARISON_OPERATORS, tokenize, type Token, type TokenKind} from './context-key-tokenizer';
import {WhenExpressionSyntaxError} from './context-key-syntax-error';

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

export {WhenExpressionSyntaxError} from './context-key-syntax-error';
