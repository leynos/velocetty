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

const assertSyntaxError = (expression: string, index: number, messagePart: string) => {
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

test('parses literals and escape sequences into stable AST values', () => {
  expect(parseWhenExpression(`'foo\\'bar\\n'`)).toEqual({
    kind: 'literal',
    value: "foo'bar\n"
  } satisfies WhenExpressionNode);

  expect(parseWhenExpression('"foo\\"bar\\t"')).toEqual({
    kind: 'literal',
    value: 'foo"bar\t'
  } satisfies WhenExpressionNode);

  expect(parseWhenExpression('true')).toEqual({kind: 'literal', value: true} satisfies WhenExpressionNode);
  expect(parseWhenExpression('false')).toEqual({kind: 'literal', value: false} satisfies WhenExpressionNode);
  expect(parseWhenExpression('null')).toEqual({kind: 'literal', value: null} satisfies WhenExpressionNode);

  expect(parseWhenExpression('-42')).toEqual({kind: 'literal', value: -42} satisfies WhenExpressionNode);
  expect(parseWhenExpression('3.125')).toEqual({kind: 'literal', value: 3.125} satisfies WhenExpressionNode);
  expect(parseWhenExpression('1.23e-4')).toEqual({kind: 'literal', value: 1.23e-4} satisfies WhenExpressionNode);
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

test('coerces booleans and enforces type-aware comparison semantics', () => {
  const context = createMap([
    ['zero', 0],
    ['negativeOne', -1],
    ['empty', ''],
    ['text', 'x'],
    ['nothing', null],
    ['notANumber', Number.NaN]
  ]);

  expect(evaluateWhenExpression('zero', context)).toBe(false);
  expect(evaluateWhenExpression('negativeOne', context)).toBe(true);
  expect(evaluateWhenExpression('empty', context)).toBe(false);
  expect(evaluateWhenExpression('text', context)).toBe(true);
  expect(evaluateWhenExpression('nothing', context)).toBe(false);
  expect(evaluateWhenExpression('notANumber', context)).toBe(false);

  expect(evaluateWhenExpression('!zero', context)).toBe(true);
  expect(evaluateWhenExpression('!negativeOne', context)).toBe(false);
  expect(evaluateWhenExpression('!empty', context)).toBe(true);
  expect(evaluateWhenExpression('!text', context)).toBe(false);
  expect(evaluateWhenExpression('!nothing', context)).toBe(true);
  expect(evaluateWhenExpression('!notANumber', context)).toBe(true);

  expect(evaluateWhenExpression('"2" == 2', context)).toBe(false);
  expect(evaluateWhenExpression('true == 1', context)).toBe(false);
  expect(evaluateWhenExpression('false == 0', context)).toBe(false);
  expect(evaluateWhenExpression('2 < "3"', context)).toBe(false);
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
  assertSyntaxError('terminalFocus &&', 16, 'Unexpected token');
  assertSyntaxError('(terminalFocus || settingsOpen', 30, 'Expected rparen');
  assertSyntaxError('paneCount >>> 1', 11, 'Unexpected token');
});

test('reports empty, whitespace-only, and stray-token parse failures consistently', () => {
  assertSyntaxError('', 0, 'Unexpected token');
  assertSyntaxError('   ', 3, 'Unexpected token');
  assertSyntaxError(')', 0, 'Unexpected token');
  assertSyntaxError('&& terminalFocus', 0, 'Unexpected token');
  assertSyntaxError('count < other < third', 14, 'Expected eof');
});

test('reports literal parse errors with stable syntax diagnostics', () => {
  assertSyntaxError("'unterminated", 0, 'Unterminated string literal');
  assertSyntaxError('1.', 0, 'Invalid numeric literal');
  assertSyntaxError('1e', 0, 'Invalid numeric literal exponent');
});

test('parses identifier and escape-sequence edge cases into stable literal values', () => {
  expect(parseWhenExpression('foo.bar && $shell && _pane')).toEqual({
    kind: 'logical',
    operator: '&&',
    left: {
      kind: 'logical',
      operator: '&&',
      left: {
        kind: 'identifier',
        key: 'foo.bar'
      },
      right: {
        kind: 'identifier',
        key: '$shell'
      }
    },
    right: {
      kind: 'identifier',
      key: '_pane'
    }
  } satisfies WhenExpressionNode);

  expect(parseWhenExpression(String.raw`"line\rbreak\\done"`)).toEqual({
    kind: 'literal',
    value: 'line\rbreak\\done'
  } satisfies WhenExpressionNode);

  expect(parseWhenExpression(String.raw`"\q"`)).toEqual({
    kind: 'literal',
    value: 'q'
  } satisfies WhenExpressionNode);
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

test('service respects initial context and returns sorted frozen snapshots', () => {
  const service = createContextKeyService({zKey: 3, aKey: 1, mKey: 2});
  const snapshot = service.snapshot();

  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.keys(snapshot)).toEqual(['aKey', 'mKey', 'zKey']);
  expect(snapshot).toEqual({aKey: 1, mKey: 2, zKey: 3});

  expect(service.has('aKey')).toBe(true);
  expect(service.has('mKey')).toBe(true);
  expect(service.has('zKey')).toBe(true);
});

test('service lifecycle operations update snapshots and evaluations', () => {
  const service = createContextKeyService();
  const compiled = service.compile('a && !b');

  service.set('a', true);
  service.set('b', false);
  expect(service.has('a')).toBe(true);
  expect(service.has('b')).toBe(true);
  expect(service.snapshot()).toEqual({a: true, b: false});
  expect(service.evaluateCompiled(compiled)).toBe(true);

  service.delete('b');
  expect(service.has('b')).toBe(false);
  expect(service.snapshot()).toEqual({a: true});
  expect(service.evaluateCompiled(compiled)).toBe(true);

  service.clear();
  expect(service.has('a')).toBe(false);
  expect(service.snapshot()).toEqual({});
  expect(service.evaluateCompiled(compiled)).toBe(false);
});

test('service snapshots are independent and compile cache is stable', () => {
  const service = createContextKeyService();
  service.set('x', 1);
  service.set('y', 2);

  const first = service.snapshot();
  const second = service.snapshot();

  expect(first).not.toBe(second);
  expect(first).toEqual(second);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(second)).toBe(true);

  service.set('x', 3);
  const third = service.snapshot();
  expect(third).toEqual({x: 3, y: 2});
  expect(first).toEqual({x: 1, y: 2});

  const compiledA = service.compile('x > 1 && y == 2');
  const compiledB = service.compile('x > 1 && y == 2');
  expect(compiledA).toBe(compiledB);
  expect(service.evaluateCompiled(compiledA)).toBe(true);

  service.set('x', 1);
  expect(service.evaluateCompiled(compiledA)).toBe(false);
});

test('evaluateWhenExpressionAst respects missing keys as null and supports repeated evaluation', () => {
  const ast = parseWhenExpression('missingKey == null || paneCount >= 3');
  const context = createMap([['paneCount', 2]]);

  const sequence = Array.from({length: 6}, () => evaluateWhenExpressionAst(ast, context));

  expect(sequence).toEqual([true, true, true, true, true, true]);
});

test('evaluateWhenExpressionAst is deterministic for object and map contexts and ignores prototype keys', () => {
  const ast = parseWhenExpression('count > 1 && ownFlag && inheritedFlag == null');
  const prototypeContext = {inheritedFlag: true};
  const objectContext = Object.assign(Object.create(prototypeContext), {
    count: 2,
    ownFlag: true
  }) as ContextKeyMap;
  const mapContext = new Map<string, ContextKeyValue>([
    ['count', 2],
    ['ownFlag', true]
  ]);

  const objectResults = Array.from({length: 4}, () => evaluateWhenExpressionAst(ast, objectContext));
  const mapResults = Array.from({length: 4}, () => evaluateWhenExpressionAst(ast, mapContext));

  expect(objectResults).toEqual([true, true, true, true]);
  expect(mapResults).toEqual(objectResults);
});
