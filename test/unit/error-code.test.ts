/** @file Verifies the shared errno-code extraction every log sink uses. */
import {describe, expect, test} from 'bun:test';

import {boundedErrorCode, describeError, errorCode} from '../../app/utils/error-code';

describe('errorCode', () => {
  test('returns the code a Node filesystem error carries', () => {
    const error = Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'});

    expect(errorCode(error)).toBe('EACCES');
  });

  test('keeps a raw message out of the result', () => {
    // The message repeats a path; only the fixed token may reach a log line.
    const error = Object.assign(new Error('ENOENT: no such file, open /home/user/.config'), {code: 'ENOENT'});

    const code = errorCode(error);
    expect(code).toBe('ENOENT');
    expect(code).not.toContain('/home/user');
  });

  test('rejects a non-string code and values that carry none', () => {
    expect(errorCode({code: 42})).toBeUndefined();
    expect(errorCode({message: 'no code here'})).toBeUndefined();
    expect(errorCode(new Error('plain error'))).toBeUndefined();
  });

  test('rejects primitives and nullish values', () => {
    for (const value of [undefined, null, 'ENOENT', 1, true]) {
      expect(errorCode(value)).toBeUndefined();
    }
  });
});

describe('boundedErrorCode', () => {
  test('keeps an errno token', () => {
    const error = Object.assign(new Error('denied'), {code: 'EACCES'});

    expect(boundedErrorCode(error)).toBe('EACCES');
  });

  test('drops a code that is not a known errno', () => {
    // `code` accepts any string, so it could hold a path, a token, or a message.
    const values = [
      '/home/ada/secret',
      'EACCES: permission denied',
      'eacces',
      'PRIVATE_TOKEN',
      'A'.repeat(33),
      'no code'
    ];
    for (const code of values) {
      const error = Object.assign(new Error('x'), {code});
      expect(boundedErrorCode(error)).toBeUndefined();
    }
  });
});

describe('describeError', () => {
  test('keeps a built-in constructor name and an errno code', () => {
    const error = Object.assign(new TypeError('denied'), {code: 'EACCES'});

    expect(describeError(error)).toEqual({code: 'EACCES', name: 'TypeError'});
  });

  test('drops an errno-shaped token that is not an errno', () => {
    const error = Object.assign(new Error('x'), {code: 'PRIVATE_TOKEN'});

    expect(describeError(error)).toEqual({name: 'Error'});
  });

  test('drops a path smuggled through either field', () => {
    const error = Object.assign(new Error('x'), {name: '/home/ada/secret', code: '/home/ada/secret'});

    expect(describeError(error)).toEqual({name: 'Error'});
    expect(JSON.stringify(describeError(error))).not.toContain('/home/ada');
  });

  test('reports UnknownError for a value that is not an Error', () => {
    expect(describeError('not an error')).toEqual({name: 'UnknownError'});
  });
});
