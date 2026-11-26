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
  childObjectRange,
  findConfigRange,
  isRefusal,
  lineEndIndex,
  scanTrailingCommentEnd,
  terminatorLength,
  valueTextEnd,
  type DocumentRefusalReason,
  type PropertyPath
} from './document-scan';
import {Json5Parser} from './parser';
import type {Json5ObjectProperty, Json5ObjectRange, PropertyKey} from './types';

type Span = {readonly startIndex: number; readonly endIndex: number};

const hasOnlyIndentation = (doc: string, startIndex: number, endIndex: number): boolean =>
  /^[ \t]*$/.test(doc.slice(startIndex, endIndex));

const ownLineSpan = (doc: string, parser: Json5Parser, property: Json5ObjectProperty): Span | null => {
  const lineStart = parser.getLineStartIndex({index: property.keyStartIndex});
  if (!hasOnlyIndentation(doc, lineStart, property.keyStartIndex)) {
    return null;
  }
  const afterValue = scanTrailingCommentEnd({doc, index: valueTextEnd(doc, property)});
  const restEnd = lineEndIndex({doc, index: afterValue});
  if (!hasOnlyIndentation(doc, afterValue, restEnd)) {
    return null;
  }
  return {startIndex: lineStart, endIndex: restEnd + terminatorLength({doc, index: restEnd})};
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
    const end = doc[comma] === ',' ? comma + 1 : scanTrailingCommentEnd({doc, index: valueEnd});
    return {startIndex: property.keyStartIndex, endIndex: end};
  }
  const separator = precedingSeparator(parser, doc, properties, property);
  return {
    startIndex: separator ?? property.keyStartIndex,
    endIndex: scanTrailingCommentEnd({doc, index: valueEnd})
  };
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

/** Resolves the object that holds the last segment of `segments`. */
const resolveRemovalParent = (
  parser: Json5Parser,
  segments: PropertyPath
): Json5ObjectRange | DocumentRefusalReason => {
  let range = findConfigRange(parser);
  for (const segment of segments.slice(0, -1)) {
    if (isRefusal(range)) {
      return range;
    }
    range = childObjectRange(parser, range, segment);
  }
  return range;
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
  const segments = path.slice(1);
  const lastSegment = segments.at(-1);
  if (!lastSegment) {
    return refused('path-not-found');
  }
  const parser = new Json5Parser(doc);
  const parentRange = resolveRemovalParent(parser, segments);
  if (isRefusal(parentRange)) {
    return refused(parentRange);
  }
  return removeProperty(doc, parentRange, lastSegment);
};
