/**
 * @file Insert or replace one property in a user's JSON5 config document.
 *
 * A set replaces exactly the value span, or inserts one property at the
 * member indent. Nothing else moves, so the user's comments, ordering,
 * quoting, and line endings survive.
 *
 * The function is pure: it returns the edited document or a specific refusal.
 * Re-parsing the candidate and comparing it with the intended value belongs
 * to `config-file-writer.ts`, which is the only writer.
 */

import {INDENT_UNIT, detectNewline, formatObjectKey, formatValue, replaceSlice} from './document-format';
import {type DocumentEditResult, type Json5Document, edited, refused} from './document-result';
import {
  ROOT_KEY,
  isRefusal,
  locateChild,
  resolveObjectRange,
  valueTextEnd,
  type LocatedChild,
  type PropertyPath
} from './document-scan';
import {Json5Parser} from './parser';
import type {Json5ObjectProperty, Json5ObjectRange, PropertyKey} from './types';

import type {JsonValue} from '@shared/types/json';

/** The refusal reasons a set can produce. */
export type SetRefusalReason = 'path-not-found' | 'duplicate-key' | 'config-not-object';

/** The document, path, and value one set must apply. */
type SetRequest = {
  readonly doc: Json5Document;
  readonly path: PropertyPath;
  readonly value: JsonValue;
};

type FoundChild = Extract<LocatedChild, {readonly kind: 'found'}>;

const memberIndentFor = (parser: Json5Parser, objectRange: Json5ObjectRange): string => {
  const first = parser.parseObjectProperties(objectRange)?.[0];
  if (first) {
    return parser.getLineIndent({index: first.keyStartIndex});
  }
  return `${parser.getLineIndent({index: objectRange.openBraceIndex})}${INDENT_UNIT}`;
};

const insertProperty = (
  doc: string,
  objectRange: Json5ObjectRange,
  key: PropertyKey,
  value: JsonValue
): DocumentEditResult => {
  const parser = new Json5Parser(doc);
  const properties = parser.parseObjectProperties(objectRange);
  if (!properties) {
    return refused('config-not-object');
  }
  const newline = detectNewline(doc);
  const memberIndent = memberIndentFor(parser, objectRange);
  const formatted = `${memberIndent}${formatObjectKey(key)}: ${formatValue(value, memberIndent, newline)}`;
  if (properties.length === 0) {
    const parentIndent = parser.getLineIndent({index: objectRange.openBraceIndex});
    return edited(
      replaceSlice(
        doc,
        objectRange.closeBraceIndex,
        objectRange.closeBraceIndex,
        `${newline}${formatted}${newline}${parentIndent}`
      )
    );
  }
  const lastProperty = properties.pop();
  if (!lastProperty) {
    return refused('config-not-object');
  }
  const closeLineStart = parser.getLineStartIndex({index: objectRange.closeBraceIndex});
  const insertionIndex = /^[ \t]*$/.test(doc.slice(closeLineStart, objectRange.closeBraceIndex))
    ? closeLineStart
    : objectRange.closeBraceIndex;
  // The separating comma belongs immediately after the previous value, which
  // may sit before a trailing comment; placing it at the insertion point would
  // put it on the next line.
  let prefix = doc.slice(0, insertionIndex);
  const commaIndex = valueTextEnd(doc, lastProperty);
  if (!lastProperty.hasTrailingComma && commaIndex <= insertionIndex) {
    prefix = `${prefix.slice(0, commaIndex)},${prefix.slice(commaIndex)}`;
  }
  const leadingNewline = prefix.endsWith('\n') ? '' : newline;
  return edited(`${prefix}${leadingNewline}${formatted}${newline}${doc.slice(insertionIndex)}`);
};

/** Replaces the value span of an existing property, keeping its line around it. */
const replacePropertyValue = (
  doc: Json5Document,
  property: Json5ObjectProperty,
  value: JsonValue
): DocumentEditResult => {
  const parser = new Json5Parser(doc);
  const indent = parser.getLineIndent({index: property.keyStartIndex});
  const formatted = formatValue(value, indent, detectNewline(doc));
  return edited(replaceSlice(doc, property.valueStartIndex, valueTextEnd(doc, property), formatted));
};

/**
 * Continues a set through a property that exists.
 *
 * A leaf replaces the value; an intermediate segment must be an object, which
 * the next step resolves from the updated document.
 */
const setUnderFound = (request: SetRequest, offset: number, found: FoundChild): DocumentEditResult => {
  if (offset === request.path.length - 1) {
    return replacePropertyValue(request.doc, found.property, request.value);
  }
  if (found.range === null) {
    return refused('config-not-object');
  }
  return setUnderPath(request, offset + 1);
};

/** Creates a missing intermediate object, then continues the set inside it. */
const insertAtMissing = (
  request: SetRequest,
  offset: number,
  parentRange: Json5ObjectRange,
  segment: PropertyKey
): DocumentEditResult => {
  if (offset === request.path.length - 1) {
    return insertProperty(request.doc, parentRange, segment, request.value);
  }
  const inserted = insertProperty(request.doc, parentRange, segment, {});
  if (inserted.kind === 'refused') {
    return inserted;
  }
  return setUnderPath({...request, doc: inserted.doc}, offset + 1);
};

/** Applies the segment at `offset`, which is always below `config`. */
const setUnderPath = (request: SetRequest, offset: number): DocumentEditResult => {
  const parser = new Json5Parser(request.doc);
  const parentRange = resolveObjectRange(parser, request.path.slice(0, offset));
  if (isRefusal(parentRange)) {
    return refused(parentRange);
  }
  const segment = request.path[offset];
  const located = locateChild(parser, parentRange, segment);
  if (located.kind === 'refused') {
    return refused(located.reason);
  }
  if (located.kind === 'found') {
    return setUnderFound(request, offset, located);
  }
  return insertAtMissing(request, offset, parentRange, segment);
};

/**
 * Sets one property under `config`, creating missing intermediate objects.
 *
 * The document must have an object root with an object `config` member. A
 * duplicate key on the path, or a non-object where an object is needed, is
 * refused rather than repaired.
 *
 * @param doc - The document to edit.
 * @param path - The property path, beginning with `config`.
 * @param value - The value to store.
 * @returns The edited document or the reason the edit was refused.
 *
 * @example
 * setPropertyAtPath(json5Document('{config: {}}'), [propertyKey('config'), propertyKey('fontSize')], 16);
 * // {kind: 'edited', doc: '{\n  config: {fontSize: 16}\n}'}
 */
export const setPropertyAtPath = (doc: Json5Document, path: PropertyPath, value: JsonValue): DocumentEditResult => {
  if (path.length < 2 || path[0]?.value !== ROOT_KEY) {
    return refused('path-not-found');
  }
  return setUnderPath({doc, path, value}, 1);
};
