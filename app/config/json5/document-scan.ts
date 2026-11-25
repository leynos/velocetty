/**
 * @file Low-level scanning shared by the JSON5 document edits.
 *
 * The parser reports a property's value end at the terminating delimiter, so
 * it includes trailing whitespace and a trailing same-line comment. These
 * helpers recover the true value end and resolve object ranges by path; both
 * the set and the remove edit need them.
 */

import type {Json5Parser} from './parser';
import type {Json5ObjectProperty, Json5ObjectRange, PropertyKey} from './types';

/** A path from the document root to one property. */
export type PropertyPath = readonly PropertyKey[];

/** Why an edit was refused. */
export type DocumentRefusalReason = 'path-not-found' | 'duplicate-key' | 'config-not-object';

/** Branded parser input, shared by the edits that consume these helpers. */
export type ScanDocument = string;

export const ROOT_KEY = 'config';

export const isRefusal = (value: Json5ObjectRange | DocumentRefusalReason): value is DocumentRefusalReason =>
  typeof value === 'string';

export const lineEndIndex = (doc: string, fromIndex: number): number => {
  let index = fromIndex;
  while (index < doc.length && doc[index] !== '\n' && doc[index] !== '\r') {
    index += 1;
  }
  return index;
};

/** Scans past a quoted string, returning the index after its closing quote. */
export const skipQuoted = (doc: string, quoteIndex: number, limitIndex: number): number => {
  const quote = doc[quoteIndex];
  let index = quoteIndex + 1;
  while (index < limitIndex) {
    if (doc[index] === '\\') {
      index += 2;
      continue;
    }
    if (doc[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return limitIndex;
};

/**
 * Finds the end of the value text inside a property span.
 *
 * @param doc - The document text.
 * @param property - The property whose value end is being found.
 * @returns The index just after the value's last character.
 */
export const valueTextEnd = (doc: string, property: Json5ObjectProperty): number => {
  let index = property.valueStartIndex;
  let end = property.valueStartIndex;
  while (index < property.valueEndIndex) {
    const character = doc.charAt(index);
    if (character === '"' || character === "'") {
      index = skipQuoted(doc, index, property.valueEndIndex);
      end = index;
      continue;
    }
    if (character === '/' && doc[index + 1] === '/') {
      index = lineEndIndex(doc, index);
      continue;
    }
    if (character === '/' && doc[index + 1] === '*') {
      const close = doc.indexOf('*/', index + 2);
      index = close === -1 ? property.valueEndIndex : close + 2;
      continue;
    }
    if (!/\s/.test(character)) {
      end = index + 1;
    }
    index += 1;
  }
  return end;
};

export const scanTrailingCommentEnd = (doc: string, fromIndex: number): number => {
  let index = fromIndex;
  while (doc[index] === ' ' || doc[index] === '\t') {
    index += 1;
  }
  if (doc.startsWith('//', index)) {
    return lineEndIndex(doc, index);
  }
  if (doc.startsWith('/*', index)) {
    const close = doc.indexOf('*/', index + 2);
    return close === -1 ? index : close + 2;
  }
  return index;
};

export const terminatorLength = (doc: string, atIndex: number): number => {
  if (doc.startsWith('\r\n', atIndex)) {
    return 2;
  }
  return doc[atIndex] === '\n' || doc[atIndex] === '\r' ? 1 : 0;
};

export const findConfigRange = (parser: Json5Parser): Json5ObjectRange | DocumentRefusalReason => {
  const root = parser.findRootObjectRange();
  if (!root) {
    return 'config-not-object';
  }
  const config = parser.getObjectProperty(root, ROOT_KEY);
  if (!config) {
    return 'path-not-found';
  }
  return parser.getObjectRangeForProperty(config) ?? 'config-not-object';
};

export type LocatedChild =
  | {readonly kind: 'found'; readonly property: Json5ObjectProperty; readonly range: Json5ObjectRange | null}
  | {readonly kind: 'missing'}
  | {readonly kind: 'refused'; readonly reason: DocumentRefusalReason};

export const locateChild = (parser: Json5Parser, parentRange: Json5ObjectRange, key: PropertyKey): LocatedChild => {
  const properties = parser.parseObjectProperties(parentRange);
  if (!properties) {
    return {kind: 'refused', reason: 'config-not-object'};
  }
  const matches = properties.filter((property) => property.key === key.value);
  if (matches.length > 1) {
    return {kind: 'refused', reason: 'duplicate-key'};
  }
  const property = matches.pop();
  if (!property) {
    return {kind: 'missing'};
  }
  return {kind: 'found', property, range: parser.getObjectRangeForProperty(property)};
};

/** Resolves a path below `config` to the object range it names. */
export const resolveObjectRange = (
  parser: Json5Parser,
  segments: PropertyPath
): Json5ObjectRange | DocumentRefusalReason => {
  const configRange = findConfigRange(parser);
  if (isRefusal(configRange)) {
    return configRange;
  }
  let range = configRange;
  for (const segment of segments.slice(1)) {
    const located = locateChild(parser, range, segment);
    if (located.kind === 'refused') {
      return located.reason;
    }
    if (located.kind === 'missing') {
      return 'path-not-found';
    }
    if (located.range === null) {
      return 'config-not-object';
    }
    range = located.range;
  }
  return range;
};
