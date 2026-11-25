/**
 * @file Remove one property from a user's JSON5 config document.
 *
 * A removal deletes the key, its value, one separating comma, a trailing
 * same-line comment, and the whole line when the property occupied its own
 * line. Comments elsewhere in the document are untouched.
 */

import {type DocumentEditResult, type Json5Document, edited, refused} from './document-result';
import {
  ROOT_KEY,
  isRefusal,
  lineEndIndex,
  locateChild,
  findConfigRange,
  scanTrailingCommentEnd,
  terminatorLength,
  valueTextEnd,
  type PropertyPath
} from './document-scan';
import {Json5Parser} from './parser';
import type {Json5ObjectProperty, Json5ObjectRange, PropertyKey} from './types';

type Span = {readonly startIndex: number; readonly endIndex: number};

const ownLineSpan = (doc: string, parser: Json5Parser, property: Json5ObjectProperty): Span | null => {
  const lineStart = parser.getLineStartIndex({index: property.keyStartIndex});
  if (!/^[ \t]*$/.test(doc.slice(lineStart, property.keyStartIndex))) {
    return null;
  }
  const afterValue = scanTrailingCommentEnd(doc, valueTextEnd(doc, property));
  const restEnd = lineEndIndex(doc, afterValue);
  if (!/^[ \t]*$/.test(doc.slice(afterValue, restEnd))) {
    return null;
  }
  return {startIndex: lineStart, endIndex: restEnd + terminatorLength(doc, restEnd)};
};

const precedingSeparator = (
  parser: Json5Parser,
  doc: string,
  properties: readonly Json5ObjectProperty[],
  property: Json5ObjectProperty
): number | null => {
  const index = properties.indexOf(property);
  const previous = index > 0 ? properties[index - 1] : undefined;
  if (!previous) {
    return null;
  }
  const comma = parser.skipWhitespaceAndComments({
    startIndex: valueTextEnd(doc, previous),
    limitIndex: property.keyStartIndex
  });
  return doc[comma] === ',' ? comma : null;
};

const inlineSpan = (
  doc: string,
  parser: Json5Parser,
  properties: readonly Json5ObjectProperty[],
  property: Json5ObjectProperty
): Span => {
  const valueEnd = valueTextEnd(doc, property);
  if (property.hasTrailingComma) {
    const comma = parser.skipWhitespaceAndComments({startIndex: valueEnd, limitIndex: doc.length});
    const end = doc[comma] === ',' ? comma + 1 : scanTrailingCommentEnd(doc, valueEnd);
    return {startIndex: property.keyStartIndex, endIndex: end};
  }
  const separator = precedingSeparator(parser, doc, properties, property);
  return {startIndex: separator ?? property.keyStartIndex, endIndex: scanTrailingCommentEnd(doc, valueEnd)};
};

const removeProperty = (doc: string, parentRange: Json5ObjectRange, key: PropertyKey): DocumentEditResult => {
  const parser = new Json5Parser(doc);
  const properties = parser.parseObjectProperties(parentRange);
  if (!properties) {
    return refused('config-not-object');
  }
  const matches = properties.filter((property) => property.key === key.value);
  if (matches.length > 1) {
    return refused('duplicate-key');
  }
  const property = matches.pop();
  if (!property) {
    return refused('path-not-found');
  }
  const span = ownLineSpan(doc, parser, property) ?? inlineSpan(doc, parser, properties, property);
  return edited(`${doc.slice(0, span.startIndex)}${doc.slice(span.endIndex)}`);
};

/**
 * Removes one property under `config`.
 *
 * @param doc - The document to edit.
 * @param path - The property path, beginning with `config`.
 * @returns The edited document, or the reason the removal was refused.
 *
 * @example
 * removePropertyAtPath(json5Document('{config: {fontSize: 14, shell: "bash"}}'), [
 *   propertyKey('config'),
 *   propertyKey('fontSize')
 * ]);
 * // {kind: 'edited', doc: '{config: { shell: "bash"}}'}
 */
export const removePropertyAtPath = (doc: Json5Document, path: PropertyPath): DocumentEditResult => {
  if (path.length < 2 || path[0]?.value !== ROOT_KEY) {
    return refused('path-not-found');
  }
  const parser = new Json5Parser(doc);
  let parentRange = findConfigRange(parser);
  if (isRefusal(parentRange)) {
    return refused(parentRange);
  }
  const segments = path.slice(1);
  for (const [offset, segment] of segments.entries()) {
    if (offset === segments.length - 1) {
      return removeProperty(doc, parentRange, segment);
    }
    const located = locateChild(parser, parentRange, segment);
    if (located.kind === 'refused') {
      return refused(located.reason);
    }
    if (located.kind === 'missing') {
      return refused('path-not-found');
    }
    if (located.range === null) {
      return refused('config-not-object');
    }
    parentRange = located.range;
  }
  return refused('path-not-found');
};
