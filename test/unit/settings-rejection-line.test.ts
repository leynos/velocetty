/**
 * @file The bounded line a settings transport rejection may log.
 *
 * A rejection crosses from the main process, so its message and its `name` are
 * both untrusted. Only a fixed vocabulary of built-in error names may reach
 * the line; everything else is reported by category alone.
 */
import {expect, test} from 'bun:test';

import {settingsRejectionLine} from '../../lib/settings/rejection-line';

test('a built-in error name is carried after the category', () => {
  expect(settingsRejectionLine(new TypeError('EACCES: cannot write /home/ada'))).toBe(
    'settings write rejected category=transport name=TypeError'
  );
  expect(settingsRejectionLine(new RangeError('out of range'))).toBe(
    'settings write rejected category=transport name=RangeError'
  );
});

test('every built-in name the store recognises is carried verbatim', () => {
  for (const name of ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError']) {
    const error = Object.assign(new Error('x'), {name});
    expect(settingsRejectionLine(error)).toBe(`settings write rejected category=transport name=${name}`);
  }
});

test('a foreign name holding a path and a newline is dropped', () => {
  const crafted = Object.assign(new Error('boom'), {name: '/home/ada/.config/Hyper\nforged line'});
  expect(settingsRejectionLine(crafted)).toBe('settings write rejected category=transport');
});

test('a rejection that is not an object is reported by category alone', () => {
  expect(settingsRejectionLine('nope')).toBe('settings write rejected category=transport');
  expect(settingsRejectionLine(undefined)).toBe('settings write rejected category=transport');
});
