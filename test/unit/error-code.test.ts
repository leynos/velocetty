/** @file Verifies the shared errno-code extraction every log sink uses. */
import {describe, expect, test} from 'bun:test';

import {errorCode} from '../../app/utils/error-code';

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
