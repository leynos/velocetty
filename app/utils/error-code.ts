/** @file Extracts a Node-style errno code from a thrown value. */
/*
 * Log lines and user-facing diagnostics carry this code rather than the raw
 * error: an error's message can repeat a path or quote the user's file, while
 * an errno code is a fixed token. Every sink that needs the code calls this one
 * extraction, so the copies cannot drift apart and start leaking a path from
 * just one of them.
 *
 * The extraction stays a guard rather than an error type because the value it
 * inspects is whatever a `catch` clause caught, which TypeScript types as
 * `unknown` and which may be anything a dependency chose to throw.
 */

import {isObject, isString} from './runtime-guards';

/**
 * Reads the errno `code` a thrown value carries, when it has a string one.
 *
 * @returns The code, or `undefined` when the value carries none.
 *
 * @example
 * ```ts
 * try {
 *   readFileSync(filePath, 'utf8');
 * } catch (error) {
 *   console.error('Failed to read the configuration.', {code: errorCode(error) ?? 'unknown'});
 * }
 * ```
 */
export const errorCode = (error: unknown): string | undefined => {
  if (!isObject(error) || !('code' in error)) {
    return undefined;
  }
  const {code} = error;
  return isString(code) ? code : undefined;
};

/**
 * A bounded description of a thrown value, for a shared log line.
 *
 * A thrown message can repeat a path, quote the user's file, or name a command
 * the user wrote, so it never reaches a log. The errno code and the constructor
 * name are fixed tokens that still tell a developer which failure occurred; the
 * user-facing notification carries the actionable text.
 *
 * @returns The errno code, when the value has one, plus the constructor name.
 *
 * @example
 * ```ts
 * const error = Object.assign(new Error('ENOENT: no such file, open /home/ada'), {code: 'ENOENT'});
 * describeError(error); // {code: 'ENOENT', name: 'Error'}
 * describeError('not an error'); // {name: 'UnknownError'}
 * ```
 */
export const describeError = (error: unknown): {readonly code?: string; readonly name: string} => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code = errorCode(error);
  return code === undefined ? {name} : {code, name};
};
