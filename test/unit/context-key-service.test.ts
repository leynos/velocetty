/** @file Verifies deterministic `when` parsing and context-key evaluation behaviour. */
import {expect, test} from 'bun:test';
import type {ContextKeyMap, ContextKeyValue, WhenExpressionNode} from '@shared/types/context-keys';

import {
  WhenExpressionSyntaxError,
  createContextKeyService,
  evaluateWhenExpression,
  evaluateWhenExpressionAst,
  parseWhenExpression
} from '../../lib/context-key-service';

const createMap = (entries: readonly [string, ContextKeyValue][]): ContextKeyMap => {
  const map: Record<string, ContextKeyValue> = {};
  for (const [key, value] of entries) {
    map[key] = value;
  }
  return map;
};

test('parses logical precedence and grouping into stable AST shapes', () => {
  const precedenceAst = parseWhenExpression('terminalFocus || settingsOpen && !findWidgetVisible');

  expect(precedenceAst).toEqual({
    kind: 'logical',
    operator: '||',
    left: {
      kind: 'identifier',
      key: 'terminalFocus'
    },
    right: {
      kind: 'logical',
      operator: '&&',
      left: {
        kind: 'identifier',
        key: 'settingsOpen'
      },
      right: {
        kind: 'unary',
        operator: '!',
        operand: {
          kind: 'identifier',
          key: 'findWidgetVisible'
        }
      }
    }
  } satisfies WhenExpressionNode);

  const groupedAst = parseWhenExpression('(terminalFocus || settingsOpen) && !findWidgetVisible');

  expect(groupedAst).toEqual({
    kind: 'logical',
    operator: '&&',
    left: {
      kind: 'logical',
      operator: '||',
      left: {
        kind: 'identifier',
        key: 'terminalFocus'
      },
      right: {
        kind: 'identifier',
        key: 'settingsOpen'
      }
    },
    right: {
      kind: 'unary',
      operator: '!',
      operand: {
        kind: 'identifier',
        key: 'findWidgetVisible'
      }
    }
  } satisfies WhenExpressionNode);
});

test('evaluates logical operators and unary negation deterministically', () => {
  const context = createMap([
    ['terminalFocus', true],
    ['settingsOpen', false],
    ['findWidgetVisible', false],
    ['paneCount', 2]
  ]);

  expect(evaluateWhenExpression('terminalFocus && !settingsOpen', context)).toBe(true);
  expect(evaluateWhenExpression('settingsOpen || findWidgetVisible', context)).toBe(false);
  expect(evaluateWhenExpression('terminalFocus && paneCount', context)).toBe(true);
  expect(evaluateWhenExpression('settingsOpen || paneCount > 1', context)).toBe(true);
});

test('supports comparison operators with type-aware semantics', () => {
  const context = createMap([
    ['paneCount', 2],
    ['tabType', 'terminal'],
    ['activeShell', null],
    ['remoteAttached', true],
    ['emptyLabel', '']
  ]);

  expect(evaluateWhenExpression('paneCount == 2', context)).toBe(true);
  expect(evaluateWhenExpression('paneCount != 3', context)).toBe(true);
  expect(evaluateWhenExpression('paneCount < 3', context)).toBe(true);
  expect(evaluateWhenExpression('paneCount <= 2', context)).toBe(true);
  expect(evaluateWhenExpression('paneCount > 1', context)).toBe(true);
  expect(evaluateWhenExpression('paneCount >= 2', context)).toBe(true);

  expect(evaluateWhenExpression('tabType == "terminal"', context)).toBe(true);
  expect(evaluateWhenExpression('tabType != "settings"', context)).toBe(true);
  expect(evaluateWhenExpression('tabType > "alpha"', context)).toBe(true);

  expect(evaluateWhenExpression('activeShell == null', context)).toBe(true);
  expect(evaluateWhenExpression('activeShell != null', context)).toBe(false);

  expect(evaluateWhenExpression('paneCount == "2"', context)).toBe(false);
  expect(evaluateWhenExpression('remoteAttached < 1', context)).toBe(false);
  expect(evaluateWhenExpression('emptyLabel', context)).toBe(false);
});

test('reports parse errors with stable source indices', () => {
  const assertParseError = (expression: string, index: number, messagePart: string) => {
    try {
      parseWhenExpression(expression);
      throw new Error('Expected parse failure');
    } catch (error) {
      expect(error).toBeInstanceOf(WhenExpressionSyntaxError);
      const parseError = error as WhenExpressionSyntaxError;
      expect(parseError.index).toBe(index);
      expect(parseError.source).toBe(expression);
      expect(parseError.message).toContain(messagePart);
    }
  };

  assertParseError('terminalFocus &&', 16, 'Unexpected token');
  assertParseError('(terminalFocus || settingsOpen', 30, 'Expected rparen');
  assertParseError('paneCount >>> 1', 11, 'Unexpected token');
});

test('service snapshots are deterministic and independent of insertion order', () => {
  const expression = 'paneCount > 1 && terminalFocus && tabType == "terminal"';

  const serviceA = createContextKeyService();
  serviceA.set('terminalFocus', true);
  serviceA.set('paneCount', 2);
  serviceA.set('tabType', 'terminal');

  const serviceB = createContextKeyService();
  serviceB.set('tabType', 'terminal');
  serviceB.set('terminalFocus', true);
  serviceB.set('paneCount', 2);

  const snapshotA = serviceA.snapshot();
  const snapshotB = serviceB.snapshot();

  expect(Object.keys(snapshotA)).toEqual(['paneCount', 'tabType', 'terminalFocus']);
  expect(snapshotA).toEqual(snapshotB);

  const ast = serviceA.parse(expression);
  const resultSeriesA = Array.from({length: 8}, () => serviceA.evaluate(expression));
  const resultSeriesB = Array.from({length: 8}, () => serviceB.evaluateAst(ast));

  expect(resultSeriesA).toEqual([true, true, true, true, true, true, true, true]);
  expect(resultSeriesB).toEqual(resultSeriesA);

  const frozenSnapshot = serviceA.snapshot() as Record<string, ContextKeyValue>;
  expect(() => {
    frozenSnapshot.paneCount = 99;
  }).toThrow();
  expect(serviceA.evaluateCompiled(serviceA.compile(expression))).toBe(true);
});

test('evaluateWhenExpressionAst respects missing keys as null and supports repeated evaluation', () => {
  const ast = parseWhenExpression('missingKey == null || paneCount >= 3');
  const context = createMap([['paneCount', 2]]);

  const sequence = Array.from({length: 6}, () => evaluateWhenExpressionAst(ast, context));

  expect(sequence).toEqual([true, true, true, true, true, true]);
});
