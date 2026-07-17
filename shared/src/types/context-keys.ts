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
  /** Discriminant identifying this node as an identifier lookup. */
  kind: 'identifier';
  /** Context key to resolve at evaluation time. */
  key: string;
}

/** AST node representing a literal value in an expression. */
export interface WhenLiteralNode {
  /** Discriminant identifying this node as a literal value. */
  kind: 'literal';
  /** The literal's constant value. */
  value: ContextKeyValue;
}

/** AST node representing unary negation. */
export interface WhenUnaryNode {
  /** Discriminant identifying this node as a unary operation. */
  kind: 'unary';
  /** Unary operator to apply. */
  operator: WhenUnaryOperator;
  /** Sub-expression the operator is applied to. */
  operand: WhenExpressionNode;
}

/** AST node representing a logical conjunction/disjunction. */
export interface WhenLogicalNode {
  /** Discriminant identifying this node as a logical operation. */
  kind: 'logical';
  /** Logical operator combining the two operands. */
  operator: WhenLogicalOperator;
  /** Left-hand sub-expression. */
  left: WhenExpressionNode;
  /** Right-hand sub-expression. */
  right: WhenExpressionNode;
}

/** AST node representing value comparison. */
export interface WhenComparisonNode {
  /** Discriminant identifying this node as a comparison. */
  kind: 'comparison';
  /** Comparison operator to apply. */
  operator: WhenComparisonOperator;
  /** Left-hand sub-expression. */
  left: WhenExpressionNode;
  /** Right-hand sub-expression. */
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
  /** Human-readable description of why parsing failed. */
  message: string;
  /** Original `when` expression text that failed to parse. */
  source: string;
  /** Character offset within `source` where the parser gave up. */
  index: number;
}

/** Immutable compiled expression payload with source and AST. */
export interface CompiledWhenExpression {
  /** Original `when` expression text the AST was compiled from. */
  source: string;
  /** Parsed AST ready for repeated evaluation without re-parsing. */
  ast: WhenExpressionNode;
}

/** Runtime API for managing context keys and evaluating `when` expressions. */
export interface ContextKeyService {
  /** Sets a context key's value, updating any `when` expressions that depend on it. */
  set(key: string, value: ContextKeyValue): void;
  /** Reads a context key's current value. */
  get(key: string): ContextKeyValue | undefined;
  /** Reports whether a context key is currently set. */
  has(key: string): boolean;
  /** Removes a context key; returns whether it was present. */
  delete(key: string): boolean;
  /** Removes all context keys. */
  clear(): void;
  /** Captures an immutable snapshot of all current context key values. */
  snapshot(): ContextKeyMap;
  /** Parses a `when` expression into an AST without evaluating it. */
  parse(expression: string): WhenExpressionNode;
  /** Parses a `when` expression and packages it with its source for reuse. */
  compile(expression: string): CompiledWhenExpression;
  /** Parses and evaluates a `when` expression against the current context. */
  evaluate(expression: string): boolean;
  /** Evaluates a previously parsed AST against the current context. */
  evaluateAst(ast: WhenExpressionNode): boolean;
  /** Evaluates a previously compiled expression against the current context. */
  evaluateCompiled(compiled: CompiledWhenExpression): boolean;
}
