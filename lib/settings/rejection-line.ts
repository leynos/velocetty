/**
 * @file The bounded log line for a transport rejection in the settings store.
 *
 * A gateway promise can reject with anything, and the rejection crosses from
 * the main process. Its message can repeat a path, a value, or a fragment of
 * the user's file; its `name` is caller-controlled text that can hold the
 * same, plus newlines that would forge extra log lines. Only a fixed
 * vocabulary reaches the line.
 */
import {isObject, isString} from '@shared/types/guards';

/**
 * The error names a rejection line may carry.
 *
 * These are the built-in error constructors. Any other name is ignored rather
 * than escaped, because a closed vocabulary is easier to audit than a
 * sanitizer.
 */
const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError'
]);

/**
 * Names a rejection by a fixed category and, when recognised, the error name.
 *
 * @param error - Whatever the gateway's promise rejected with.
 * @returns The bounded category line, without the message or a foreign name.
 *
 * @example
 * ```ts
 * settingsRejectionLine(new TypeError('bad /home/ada'));
 * // 'settings write rejected category=transport name=TypeError'
 * settingsRejectionLine(Object.assign(new Error('x'), {name: '/home/ada\nforged'}));
 * // 'settings write rejected category=transport'
 * ```
 */
export const settingsRejectionLine = (error: unknown): string => {
  const category = 'settings write rejected category=transport';
  const candidate = isObject(error) && 'name' in error && isString(error.name) ? error.name : undefined;
  return candidate !== undefined && KNOWN_ERROR_NAMES.has(candidate) ? `${category} name=${candidate}` : category;
};
