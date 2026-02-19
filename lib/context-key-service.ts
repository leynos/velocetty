/** @file Deterministic context key service with `when` parser and evaluator. */
import type {
  CompiledWhenExpression,
  ContextKeyMap,
  ContextKeyService,
  ContextKeyValue
} from '@shared/types/context-keys';

import {
  compileWhenExpression,
  evaluateWhenExpression,
  evaluateWhenExpressionAst,
  parseWhenExpression,
  WhenExpressionSyntaxError
} from './context-key-expression';

const compareLexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const toSnapshot = (values: ReadonlyMap<string, ContextKeyValue>): ContextKeyMap => {
  const snapshot: Record<string, ContextKeyValue> = {};
  for (const [key, value] of Array.from(values.entries()).sort(([left], [right]) => compareLexical(left, right))) {
    snapshot[key] = value;
  }

  return Object.freeze(snapshot);
};

/** Creates a context key service with deterministic snapshots and evaluation. */
export const createContextKeyService = (initialContext: ContextKeyMap = {}): ContextKeyService => {
  const values = new Map<string, ContextKeyValue>();
  const compiledBySource = new Map<string, CompiledWhenExpression>();

  for (const key of Object.keys(initialContext).sort(compareLexical)) {
    values.set(key, initialContext[key]);
  }

  const compile = (expression: string): CompiledWhenExpression => {
    const cached = compiledBySource.get(expression);
    if (cached) {
      return cached;
    }

    const compiled = compileWhenExpression(expression);
    compiledBySource.set(expression, compiled);
    return compiled;
  };

  return {
    set: (key, value) => {
      values.set(key, value);
    },
    get: (key) => values.get(key),
    has: (key) => values.has(key),
    delete: (key) => values.delete(key),
    clear: () => values.clear(),
    snapshot: () => toSnapshot(values),
    parse: parseWhenExpression,
    compile,
    evaluate: (expression) => evaluateWhenExpressionAst(compile(expression).ast, values),
    evaluateAst: (ast) => evaluateWhenExpressionAst(ast, values),
    evaluateCompiled: (compiled) => evaluateWhenExpressionAst(compiled.ast, values)
  };
};

export {
  compileWhenExpression,
  evaluateWhenExpression,
  evaluateWhenExpressionAst,
  parseWhenExpression,
  WhenExpressionSyntaxError
};
