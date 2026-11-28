/**
 * @file Low-level scanning shared by the JSON5 document edits.
 *
 * The parser reports a property's value end at the terminating delimiter, so
 * it includes trailing whitespace and a trailing same-line comment. These
 * helpers recover the true value end and resolve object ranges by path; both
 * the set and the remove edit need them.
 *
 * Positions and bounded windows travel as small typed objects so a bare index
 * cannot be mistaken for the other end of a range.
 */

import {isString} from '../../utils/runtime-guards';
import {isLineTerminator} from './characters';
import type {Json5Parser} from './parser';
import {propertyKey, type Json5ObjectProperty, type Json5ObjectRange, type PropertyKey} from './types';

/** A path from the document root to one property. */
export type PropertyPath = readonly PropertyKey[];

/** Why an edit was refused. */
export type DocumentRefusalReason = 'path-not-found' | 'duplicate-key' | 'config-not-object';

/** Branded parser input, shared by the edits that consume these helpers. */
export type ScanDocument = string;

/** A document and one position within it. */
export type TextPosition = {readonly doc: string; readonly index: number};

/** A document and the bounded window `[startIndex, limitIndex)` within it. */
export type TextSpan = {readonly doc: string; readonly startIndex: number; readonly limitIndex: number};

export const ROOT_KEY = 'config';

export const isRefusal = (value: Json5ObjectRange | DocumentRefusalReason): value is DocumentRefusalReason =>
  isString(value);

// JSON5 accepts every ECMAScript line terminator, so a comment may end at
// U+2028 or U+2029 as well as at CR or LF.
const isLineTerminatorAt = (doc: string, index: number): boolean => isLineTerminator(doc[index] ?? '');

const isQuoteCharacter = (character: string): boolean => character === '"' || character === "'";

const isIndentationCharacter = (character: string): boolean => character === ' ' || character === '\t';

// `\s` covers every whitespace JavaScript recognises, which is deliberately
// broader than JSON5's own whitespace set for finding the value text.
const valueWhitespacePattern = /\s/;

/** Returns the index of the first line break at or after `position`. */
export const lineEndIndex = (position: TextPosition): number => {
  const {doc} = position;
  let index = position.index;
  while (index < doc.length && !isLineTerminatorAt(doc, index)) {
    index += 1;
  }
  return index;
};

/** Scans past a quoted string, returning the index after its closing quote. */
export const skipQuoted = (span: TextSpan): number => {
  const {doc, startIndex, limitIndex} = span;
  const quote = doc[startIndex];
  let index = startIndex + 1;
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

const blockCommentEnd = (span: TextSpan): number => {
  const close = span.doc.indexOf('*/', span.startIndex + 2);
  return close === -1 ? span.limitIndex : close + 2;
};

/** Returns the index after a comment starting at `span.startIndex`, if any. */
const commentEndAt = (span: TextSpan): number | null => {
  if (span.doc.startsWith('//', span.startIndex)) {
    return lineEndIndex({doc: span.doc, index: span.startIndex});
  }
  if (span.doc.startsWith('/*', span.startIndex)) {
    return blockCommentEnd(span);
  }
  return null;
};

/**
 * Finds the end of the value text inside a property span.
 *
 * @param doc - The document text.
 * @param property - The property whose value end is being found.
 * @returns The index just after the value's last character.
 */
export const valueTextEnd = (doc: string, property: Json5ObjectProperty): number => {
  const limitIndex = property.valueEndIndex;
  let index = property.valueStartIndex;
  let end = property.valueStartIndex;
  while (index < limitIndex) {
    const character = doc.charAt(index);
    if (isQuoteCharacter(character)) {
      index = skipQuoted({doc, startIndex: index, limitIndex});
      end = index;
      continue;
    }
    const commentEnd = character === '/' ? commentEndAt({doc, startIndex: index, limitIndex}) : null;
    if (commentEnd !== null) {
      index = commentEnd;
      continue;
    }
    if (!valueWhitespacePattern.test(character)) {
      end = index + 1;
    }
    index += 1;
  }
  return end;
};

/** Returns the index after a trailing same-line comment, or the scan start. */
export const scanTrailingCommentEnd = (position: TextPosition): number => {
  const {doc} = position;
  let index = position.index;
  while (isIndentationCharacter(doc[index])) {
    index += 1;
  }
  if (doc.startsWith('//', index)) {
    return lineEndIndex({doc, index});
  }
  if (doc.startsWith('/*', index)) {
    const close = doc.indexOf('*/', index + 2);
    return close === -1 ? index : close + 2;
  }
  return index;
};

/** Returns the length of the line terminator at `position`, or `0`. */
export const terminatorLength = (position: TextPosition): number => {
  // CRLF is one terminator; every other recognised terminator spans one unit.
  if (position.doc.startsWith('\r\n', position.index)) {
    return 2;
  }
  return isLineTerminatorAt(position.doc, position.index) ? 1 : 0;
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

/**
 * Finds the object range of the root `config` member.
 *
 * A duplicated `config` key is refused rather than resolved to its first
 * occurrence, so an edit can never silently target the wrong object.
 *
 * @param parser - The parser holding the document.
 * @returns The object range, or the reason it cannot be resolved.
 *
 * @example
 * findConfigRange(new Json5Parser('{config: {}}'));
 * // {openBraceIndex: 9, closeBraceIndex: 10}
 */
export const findConfigRange = (parser: Json5Parser): Json5ObjectRange | DocumentRefusalReason => {
  const root = parser.findRootObjectRange();
  if (!root) {
    return 'config-not-object';
  }
  const located = locateChild(parser, root, propertyKey(ROOT_KEY));
  if (located.kind === 'refused') {
    return located.reason;
  }
  if (located.kind === 'missing') {
    return 'path-not-found';
  }
  return located.range ?? 'config-not-object';
};

/** Resolves one segment below `parentRange` to the object range it names. */
export const childObjectRange = (
  parser: Json5Parser,
  parentRange: Json5ObjectRange,
  segment: PropertyKey
): Json5ObjectRange | DocumentRefusalReason => {
  const located = locateChild(parser, parentRange, segment);
  if (located.kind === 'refused') {
    return located.reason;
  }
  if (located.kind === 'missing') {
    return 'path-not-found';
  }
  return located.range ?? 'config-not-object';
};

/** Resolves a path below `config` to the object range it names. */
export const resolveObjectRange = (
  parser: Json5Parser,
  segments: PropertyPath
): Json5ObjectRange | DocumentRefusalReason => {
  let range = findConfigRange(parser);
  for (const segment of segments.slice(1)) {
    if (isRefusal(range)) {
      return range;
    }
    range = childObjectRange(parser, range, segment);
  }
  return range;
};
