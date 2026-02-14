/** @file Verifies IPC response schema validation for child-process stdio types. */
import {describe, expect, test} from 'bun:test';
import {Buffer} from 'node:buffer';
import {ZodError} from 'zod';

import {ipcResponseSchemas} from '../../lib/transport/ipc-schemas';

describe('child_process stdio schema', () => {
  const schema = ipcResponseSchemas['child_process.exec'];

  test('accepts string stdout and stderr', () => {
    const result = schema.parse({stdout: 'hello', stderr: ''});
    expect(result).toEqual({stdout: 'hello', stderr: ''});
  });

  test('accepts Uint8Array stdout and stderr (IPC serialized form)', () => {
    const stdout = new Uint8Array([104, 101, 108, 108, 111]);
    const stderr = new Uint8Array([]);
    const result = schema.parse({stdout, stderr});
    expect(result).toEqual({stdout, stderr});
  });

  test('accepts Buffer stdout and stderr (main-process form)', () => {
    const stdout = Buffer.from('hello');
    const stderr = Buffer.alloc(0);
    const result = schema.parse({stdout, stderr});
    // Buffer extends Uint8Array so instanceof Uint8Array holds
    expect(result.stdout).toBeInstanceOf(Uint8Array);
    expect(result.stderr).toBeInstanceOf(Uint8Array);
  });

  test('accepts mixed string and Uint8Array fields', () => {
    const result = schema.parse({
      stdout: 'text output',
      stderr: new Uint8Array([101, 114, 114])
    });
    expect(result.stdout).toBe('text output');
    expect(result.stderr).toBeInstanceOf(Uint8Array);
  });

  test('rejects non-string non-Uint8Array values', () => {
    expect(() => schema.parse({stdout: 42, stderr: ''})).toThrow(ZodError);
    expect(() => schema.parse({stdout: '', stderr: null})).toThrow(ZodError);
    expect(() => schema.parse({stdout: '', stderr: {type: 'Buffer', data: []}})).toThrow(ZodError);
  });
});
