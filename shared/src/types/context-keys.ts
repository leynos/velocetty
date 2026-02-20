/** @file Shared context key contracts and `when` expression AST definitions. */

/** Primitive value types supported by context keys and `when` expressions. */
export type ContextKeyValue = boolean | string | number | null;

/** Read-only map shape used for deterministic context key snapshots. */
export type ContextKeyMap = Readonly<Record<string, ContextKeyValue>>;

/** Unary operator supported by the `when` grammar. */
export type WhenUnaryOperator = '!';
/** Logical operators supported by the `when` grammar. */
export type WhenLogicalOperator = '&&' | '||';
/** Comparison operators supported by the `when` grammar. */
export type WhenComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';

/** AST node representing an identifier lookup in the context map. */
export interface WhenIdentifierNode {
  kind: 'identifier';
  key: string;
}

/** AST node representing a literal value in an expression. */
export interface WhenLiteralNode {
  kind: 'literal';
  value: ContextKeyValue;
}

/** AST node representing unary negation. */
export interface WhenUnaryNode {
  kind: 'unary';
  operator: WhenUnaryOperator;
  operand: WhenExpressionNode;
}

/** AST node representing a logical conjunction/disjunction. */
export interface WhenLogicalNode {
  kind: 'logical';
  operator: WhenLogicalOperator;
  left: WhenExpressionNode;
  right: WhenExpressionNode;
}

/** AST node representing value comparison. */
export interface WhenComparisonNode {
  kind: 'comparison';
  operator: WhenComparisonOperator;
  left: WhenExpressionNode;
  right: WhenExpressionNode;
}

/** Union of all AST nodes produced by the `when` parser. */
export type WhenExpressionNode =
  | WhenIdentifierNode
  | WhenLiteralNode
  | WhenUnaryNode
  | WhenLogicalNode
  | WhenComparisonNode;

/** Parse error payload for invalid `when` expressions. */
export interface WhenExpressionParseError {
  message: string;
  source: string;
  index: number;
}

/** Immutable compiled expression payload with source and AST. */
export interface CompiledWhenExpression {
  source: string;
  ast: WhenExpressionNode;
}

/** Runtime API for managing context keys and evaluating `when` expressions. */
export interface ContextKeyService {
  set(key: string, value: ContextKeyValue): void;
  get(key: string): ContextKeyValue | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  snapshot(): ContextKeyMap;
  parse(expression: string): WhenExpressionNode;
  compile(expression: string): CompiledWhenExpression;
  evaluate(expression: string): boolean;
  evaluateAst(ast: WhenExpressionNode): boolean;
  evaluateCompiled(compiled: CompiledWhenExpression): boolean;
}
