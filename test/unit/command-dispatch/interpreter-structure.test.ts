/**
 * @file Structural guard: the interpreter must go through the proved machine.
 *
 * `INV-INTERPRETER-REFINES` is only meaningful if the shipped interpreter
 * actually consults the machine. A proof of a state machine that the
 * implementation quietly bypasses would prove nothing about the product.
 *
 * The check is deliberately syntactic: it reads the dispatcher's source and
 * asserts exactly one `step(` call site and exactly one promise-resolution
 * call site. Behavioural properties in `dispatcher.test.ts` cover what the
 * interpreter does; this file covers what it must not do.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/interpreter-structure.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/dispatcher.ts`
 * - `../../../lib/command-dispatch/policy/invocation-machine.ts`
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';

import {expect, test} from 'bun:test';

const DISPATCHER_PATH = path.join(import.meta.dir, '../../../lib/command-dispatch/dispatcher.ts');
const source = readFileSync(DISPATCHER_PATH, 'utf8');

/** Counts non-overlapping occurrences of `needle` in `haystack`. */
const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

test('the interpreter consults the machine from exactly one call site', () => {
  expect(countOccurrences(source, 'step(')).toBe(1);
});

test('the interpreter resolves its promise from exactly one call site', () => {
  // `resolve(` covers both `resolve(...)` and the promise constructor's
  // parameter when it is invoked; the constructor itself is named differently
  // on purpose so this count stays meaningful.
  expect(countOccurrences(source, 'resolve(')).toBe(1);
});

test('the single resolution point is the settlement function', () => {
  const lines = source.split('\n');
  const resolveLine = lines.findIndex((line) => line.includes('resolve('));

  expect(resolveLine).toBeGreaterThanOrEqual(0);
  // Walk back to the enclosing function declaration.
  const enclosing = lines
    .slice(0, resolveLine + 1)
    .toReversed()
    .find((line) => line.includes('const performSettle'));

  expect(enclosing).toBeDefined();
});

test('the interpreter adds an abort listener only behind a caller-supplied signal', () => {
  expect(countOccurrences(source, "addEventListener('abort'")).toBe(1);
  expect(source).toContain('signal !== NEVER_ABORTS_SIGNAL');
});
