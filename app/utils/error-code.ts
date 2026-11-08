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
