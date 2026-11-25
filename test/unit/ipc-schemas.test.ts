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

describe('clipboard command schemas', () => {
  test('accepts a list of file paths', () => {
    expect(ipcResponseSchemas['clipboard.readFilePaths'].parse(['/tmp/a.txt'])).toEqual(['/tmp/a.txt']);
  });

  test('rejects non-string file paths', () => {
    expect(() => ipcResponseSchemas['clipboard.readFilePaths'].parse([42])).toThrow(ZodError);
  });

  test('accepts clipboard text', () => {
    expect(ipcResponseSchemas['clipboard.readText'].parse('hello')).toBe('hello');
  });

  test('accepts a void payload for write commands', () => {
    // A write command resolves with no value; the schema must accept that
    // absence rather than reject the handler's result.
    expect(ipcResponseSchemas['clipboard.writeText'].safeParse(void 0).success).toBe(true);
  });
});

describe('settings command schemas', () => {
  const snapshot = {
    revision: 3,
    filePath: '/home/user/.config/Hyper/config.json5',
    fileStatus: {kind: 'ok' as const},
    userValues: {fontSize: 16},
    defaultValues: {fontSize: 12},
    profileOverriddenKeys: ['fontSize']
  };

  test('accepts a settings snapshot', () => {
    expect(ipcResponseSchemas['settings:getSnapshot'].parse(snapshot)).toEqual(snapshot);
  });

  test('accepts every file status shape', () => {
    const statuses = [
      {kind: 'ok'},
      {kind: 'missing'},
      {kind: 'legacy-json'},
      {kind: 'unparseable', diagnostics: [{path: '/', message: 'bad', suggestedFix: 'fix it'}]},
      {kind: 'invalid', diagnostics: [{path: '/config/fontSize', message: 'bad', suggestedFix: 'fix it'}]}
    ];
    for (const fileStatus of statuses) {
      expect(ipcResponseSchemas['settings:getSnapshot'].safeParse({...snapshot, fileStatus}).success).toBe(true);
    }
  });

  test('rejects an unknown file status', () => {
    expect(
      ipcResponseSchemas['settings:getSnapshot'].safeParse({...snapshot, fileStatus: {kind: 'unexpected'}}).success
    ).toBe(false);
  });

  test('accepts applied, rejected, and failed write outcomes', () => {
    const outcomes = [
      {kind: 'applied', snapshot},
      {kind: 'rejected', diagnostics: [{path: '/config/fontSize', message: 'bad', suggestedFix: 'fix it'}]},
      {kind: 'failed', reason: 'user-config-invalid'},
      {kind: 'failed', reason: 'io-error', detail: 'EPERM'}
    ];
    for (const outcome of outcomes) {
      expect(ipcResponseSchemas['settings:setValue'].safeParse(outcome).success).toBe(true);
      expect(ipcResponseSchemas['settings:resetValue'].safeParse(outcome).success).toBe(true);
    }
  });

  test('rejects a malformed write outcome', () => {
    expect(ipcResponseSchemas['settings:setValue'].safeParse({kind: 'applied'}).success).toBe(false);
  });
});
