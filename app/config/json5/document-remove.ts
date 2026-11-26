/**
 * @file Remove one property from a user's JSON5 config document.
 *
 * A removal deletes the key, its value, one separating comma, a trailing
 * same-line comment, and the whole line when the property occupied its own
 * line. A comment between the separating comma and the key is preserved, as
 * are comments elsewhere in the document.
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

const inlineSpans = (
  doc: string,
  parser: Json5Parser,
  properties: readonly Json5ObjectProperty[],
  property: Json5ObjectProperty
): readonly Span[] => {
  const valueEnd = valueTextEnd(doc, property);
  const trailingEnd = scanTrailingCommentEnd({doc, index: valueEnd});
  if (property.hasTrailingComma) {
    const comma = parser.skipWhitespaceAndComments({startIndex: valueEnd, limitIndex: doc.length});
    if (doc[comma] !== ',') {
      return [{startIndex: property.keyStartIndex, endIndex: trailingEnd}];
    }
    // A comment between the value and the following comma is on its own line
    // or after the value, and it belongs to the document. Delete the comma on
    // its own so the comment stays, exactly as for a preceding separator.
    if (doc.slice(trailingEnd, comma).trim() !== '') {
      return [
        {startIndex: property.keyStartIndex, endIndex: trailingEnd},
        {startIndex: comma, endIndex: comma + 1}
      ];
    }
    return [{startIndex: property.keyStartIndex, endIndex: comma + 1}];
  }
  const separator = precedingSeparator(parser, doc, properties, property);
  if (separator === null) {
    return [{startIndex: property.keyStartIndex, endIndex: trailingEnd}];
  }
  // A comment between the comma and this property belongs to the document, not
  // to the removed property. Delete the comma on its own so the comment stays.
  if (doc.slice(separator + 1, property.keyStartIndex).trim() !== '') {
    return [
      {startIndex: separator, endIndex: separator + 1},
      {startIndex: property.keyStartIndex, endIndex: trailingEnd}
    ];
  }
  return [{startIndex: separator, endIndex: trailingEnd}];
};

/** Applies spans from the end of the document backwards so indices stay valid. */
const removeSpans = (doc: string, spans: readonly Span[]): string => {
  const descending = spans.toSorted((left, right) => right.startIndex - left.startIndex);
  let text = doc;
  for (const span of descending) {
    text = `${text.slice(0, span.startIndex)}${text.slice(span.endIndex)}`;
  }
  return text;
};

/**
 * The comma that separates `property` from the next one, when it lies outside
 * `span`.
 *
 * A property on its own line can still have its comma on a later line, after
 * a comment or a line break. Deleting only the property's line would then
 * leave a leading comma and produce invalid JSON5, so the comma is removed as
 * a span of its own and the intervening comment stays.
 */
const separatorOutsideSpan = (
  doc: string,
  parser: Json5Parser,
  property: Json5ObjectProperty,
  span: Span
): Span | null => {
  if (!property.hasTrailingComma) {
    return null;
  }
  const comma = parser.skipWhitespaceAndComments({
    startIndex: valueTextEnd(doc, property),
    limitIndex: doc.length
  });
  if (doc[comma] !== ',' || (comma >= span.startIndex && comma < span.endIndex)) {
    return null;
  }
  return {startIndex: comma, endIndex: comma + 1};
};

const removalSpans = (
  doc: string,
  parser: Json5Parser,
  properties: readonly Json5ObjectProperty[],
  property: Json5ObjectProperty
): readonly Span[] => {
  const ownLine = ownLineSpan(doc, parser, property);
  if (ownLine) {
    const comma = separatorOutsideSpan(doc, parser, property, ownLine);
    return comma ? [ownLine, comma] : [ownLine];
  }
  return inlineSpans(doc, parser, properties, property);
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
  return edited(removeSpans(doc, removalSpans(doc, parser, properties, property)));
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
