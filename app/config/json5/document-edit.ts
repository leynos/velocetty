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
import {ROOT_KEY, isRefusal, locateChild, resolveObjectRange, valueTextEnd, type PropertyPath} from './document-scan';
import {Json5Parser} from './parser';
import type {Json5ObjectRange, PropertyKey} from './types';

import type {JsonValue} from '@shared/types/json';

/** The refusal reasons a set can produce. */
export type SetRefusalReason = 'path-not-found' | 'duplicate-key' | 'config-not-object';

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
  let currentDoc = doc;
  const segments = path.slice(1);
  for (const [offset, segment] of segments.entries()) {
    const parser = new Json5Parser(currentDoc);
    const parentRange = resolveObjectRange(parser, path.slice(0, offset + 1));
    if (isRefusal(parentRange)) {
      return refused(parentRange);
    }
    const located = locateChild(parser, parentRange, segment);
    if (located.kind === 'refused') {
      return refused(located.reason);
    }
    const isLeaf = offset === segments.length - 1;
    if (located.kind === 'found') {
      if (isLeaf) {
        const indent = parser.getLineIndent({index: located.property.keyStartIndex});
        const formatted = formatValue(value, indent, detectNewline(currentDoc));
        return edited(
          replaceSlice(
            currentDoc,
            located.property.valueStartIndex,
            valueTextEnd(currentDoc, located.property),
            formatted
          )
        );
      }
      if (located.range === null) {
        return refused('config-not-object');
      }
      continue;
    }
    if (isLeaf) {
      return insertProperty(currentDoc, parentRange, segment, value);
    }
    const inserted = insertProperty(currentDoc, parentRange, segment, {});
    if (inserted.kind === 'refused') {
      return inserted;
    }
    currentDoc = inserted.doc;
  }
  return refused('path-not-found');
};
