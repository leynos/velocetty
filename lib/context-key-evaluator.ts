/** @file Deterministic evaluator for parsed `when` expressions. */
import type {
  ContextKeyMap,
  ContextKeyValue,
  WhenComparisonOperator,
  WhenExpressionNode
} from '@shared/types/context-keys';

import {parseWhenExpression} from './context-key-parser';

const hasOwn = Object.prototype.hasOwnProperty;

type ContextLookup = (key: string) => ContextKeyValue | undefined;

const getLookup = (context: ContextKeyMap | ReadonlyMap<string, ContextKeyValue>): ContextLookup => {
  if (context instanceof Map) {
    return (key) => context.get(key);
  }

  return (key) => (hasOwn.call(context, key) ? context[key] : undefined);
};

const toBoolean = (value: ContextKeyValue): boolean => {
  if (value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return value.length > 0;
};

const typeTag = (value: ContextKeyValue) => (value === null ? 'null' : typeof value);

const evaluateEquality = (operator: '==' | '!=', left: ContextKeyValue, right: ContextKeyValue): boolean => {
  const sameType = typeTag(left) === typeTag(right);
  const isEqual = sameType && left === right;

  return operator === '==' ? isEqual : !isEqual;
};

const performOrderedComparison = (
  operator: '<' | '<=' | '>' | '>=',
  left: number | string,
  right: number | string
): boolean => {
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
};

const evaluateOrderedComparison = (
  operator: '<' | '<=' | '>' | '>=',
  left: ContextKeyValue,
  right: ContextKeyValue
): boolean => {
  if (typeof left === 'number' && typeof right === 'number') {
    return performOrderedComparison(operator, left, right);
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return performOrderedComparison(operator, left, right);
  }

  return false;
};

const evaluateComparison = (
  operator: WhenComparisonOperator,
  left: ContextKeyValue,
  right: ContextKeyValue
): boolean => {
  switch (operator) {
    case '==':
    case '!=':
      return evaluateEquality(operator, left, right);
    case '<':
    case '<=':
    case '>':
    case '>=':
      return evaluateOrderedComparison(operator, left, right);
  }
};

const evalValue = (node: WhenExpressionNode, lookup: ContextLookup): ContextKeyValue => {
  if (node.kind === 'identifier') {
    return lookup(node.key) ?? null;
  }

  if (node.kind === 'literal') {
    return node.value;
  }

  if (node.kind === 'unary') {
    return !toBoolean(evalValue(node.operand, lookup));
  }

  if (node.kind === 'logical') {
    const left = toBoolean(evalValue(node.left, lookup));
    return node.operator === '&&'
      ? left && toBoolean(evalValue(node.right, lookup))
      : left || toBoolean(evalValue(node.right, lookup));
  }

  return evaluateComparison(node.operator, evalValue(node.left, lookup), evalValue(node.right, lookup));
};

/** Evaluates a parsed `when` AST against a typed context map. */
export const evaluateWhenExpressionAst = (
  ast: WhenExpressionNode,
  context: ContextKeyMap | ReadonlyMap<string, ContextKeyValue>
): boolean => toBoolean(evalValue(ast, getLookup(context)));

/** Parses and evaluates a `when` expression against a typed context map. */
export const evaluateWhenExpression = (
  expression: string,
  context: ContextKeyMap | ReadonlyMap<string, ContextKeyValue>
): boolean => evaluateWhenExpressionAst(parseWhenExpression(expression), context);
