/**
 * @file Extracts a Node-style errno code from a thrown value.
 *
 * `errorCode` returns whatever `code` string a value carries, for filesystem
 * decisions. `boundedErrorCode` and `describeError` keep that value only when it
 * names a known errno, for log lines, where an arbitrary string could repeat a
 * path or a secret.
 */
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

import {constants} from 'node:os';

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
 * The errno names this platform can report.
 *
 * The set comes from Node, so it is exactly the vocabulary the runtime uses
 * rather than a hand-kept list. A string that merely looks errno-shaped, such as
 * `PRIVATE_TOKEN`, is not a member and is dropped.
 */
const KNOWN_ERRNO_CODES: ReadonlySet<string> = new Set(Object.keys(constants.errno));

/**
 * The constructor names a log may carry.
 *
 * `Error.name` is a writable string, so a dependency or a crafted value can set
 * it to anything, including a path. Only the standard built-in names are known
 * to be fixed, so every other name becomes `Error`.
 */
const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError'
]);

/**
 * Reads an errno `code` only when it names a known errno.
 *
 * This is the log-safe form of {@link errorCode}. A `code` property may hold any
 * string, so a thrown value could carry a path, a token, or a fragment of the
 * user's file there; anything outside Node's errno vocabulary is dropped rather
 * than logged. Filesystem decisions keep using {@link errorCode} and compare the
 * full value, because a dropped code must not be mistaken for a matching one.
 *
 * @returns The code when it is a known errno, otherwise `undefined`.
 *
 * @example
 * ```ts
 * boundedErrorCode(Object.assign(new Error('denied'), {code: 'EACCES'})); // 'EACCES'
 * boundedErrorCode(Object.assign(new Error('denied'), {code: '/home/ada'})); // undefined
 * boundedErrorCode(Object.assign(new Error('denied'), {code: 'PRIVATE_TOKEN'})); // undefined
 * ```
 */
export const boundedErrorCode = (error: unknown): string | undefined => {
  const code = errorCode(error);
  return code !== undefined && KNOWN_ERRNO_CODES.has(code) ? code : undefined;
};

/**
 * Names a thrown value by its fixed category.
 *
 * A non-`Error` value is not a constructor at all, so it reports
 * `UnknownError`. An `Error` whose `name` is not a built-in still reports
 * `Error` rather than repeating a name the value chose for itself.
 */
const boundedErrorName = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'UnknownError';
  }
  return KNOWN_ERROR_NAMES.has(error.name) ? error.name : 'Error';
};

/**
 * A bounded description of a thrown value, for a shared log line.
 *
 * A thrown message can repeat a path, quote the user's file, or name a command
 * the user wrote, so it never reaches a log. The errno code and the constructor
 * name are fixed tokens that still tell a developer which failure occurred; the
 * user-facing notification carries the actionable text.
 *
 * Both fields are checked against their bounded vocabularies: a `code` outside
 * Node's errno names and a constructor name outside the standard built-ins are
 * dropped, so a crafted value cannot smuggle a path or a secret into a log
 * through either.
 *
 * @returns The errno code, when the value has one, plus the constructor name.
 *
 * @example
 * ```ts
 * const error = Object.assign(new Error('ENOENT: no such file, open /home/ada'), {code: 'ENOENT'});
 * describeError(error); // {code: 'ENOENT', name: 'Error'}
 * describeError('not an error'); // {name: 'UnknownError'}
 * describeError(Object.assign(new Error('no'), {code: '/home/ada'})); // {name: 'Error'}
 * ```
 */
export const describeError = (error: unknown): {readonly code?: string; readonly name: string} => {
  const name = boundedErrorName(error);
  const code = boundedErrorCode(error);
  return code === undefined ? {name} : {code, name};
};
