/**
 * @file Formatting helpers shared by the JSON5 document edits.
 *
 * These decide only how new text is spelled: key quoting, value indentation,
 * and line endings. They never decide where text goes, which is the editor's
 * job.
 */

import {stringifyJson5} from '../json5-config';

import type {PropertyKey} from './types';
import type {JsonValue} from '@shared/types/json';

/** The indentation added for one nesting level. */
export const INDENT_UNIT = '  ';

/**
 * Detects the document's line-ending style.
 *
 * @param doc - The document text.
 * @returns `\r\n` when the document uses CRLF anywhere, otherwise `\n`.
 *
 * @example
 * detectNewline('{\r\n}'); // '\r\n'
 */
export const detectNewline = (doc: string): string => (doc.includes('\r\n') ? '\r\n' : '\n');

/**
 * Spells a key, quoting it only when it is not a JSON5 identifier.
 *
 * @param key - The key to spell.
 * @returns The key as it should appear in the document.
 *
 * @example
 * formatObjectKey(propertyKey('fontSize')); // 'fontSize'
 */
export const formatObjectKey = (key: PropertyKey): string =>
  /^[\p{ID_Start}_$][\p{ID_Continue}_$]*$/u.test(key.value) ? key.value : JSON.stringify(key.value);

/**
 * Formats a value for insertion at the given indentation.
 *
 * `stringifyJson5` sorts keys and indents with two spaces, matching the plugin
 * runtime's established formatting; only the line ending is local.
 *
 * @param value - The value to format.
 * @param indent - The indentation of the property that will hold it.
 * @param newline - The document's line ending.
 * @returns The value text, with continuation lines indented.
 *
 * @example
 * formatValue(16, '  ', '\n'); // '16'
 */
export const formatValue = (value: JsonValue, indent: string, newline: string): string => {
  const serialized = stringifyJson5(value).trimEnd();
  const lines = serialized.split('\n');
  if (lines.length <= 1) {
    return serialized;
  }
  return [lines[0], ...lines.slice(1).map((line) => `${indent}${line}`)].join(newline);
};

/**
 * Replaces one slice of a document.
 *
 * @param doc - The document text.
 * @param startIndex - First index replaced.
 * @param endIndex - First index kept after the replacement.
 * @param replacement - Text to insert.
 * @returns The new document text.
 *
 * @example
 * replaceSlice('abc', 1, 2, 'X'); // 'aXc'
 */
export const replaceSlice = (doc: string, startIndex: number, endIndex: number, replacement: string): string =>
  `${doc.slice(0, startIndex)}${replacement}${doc.slice(endIndex)}`;
