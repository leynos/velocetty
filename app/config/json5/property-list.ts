/**
 * @file Property-list parsing for JSON5 object ranges.
 *
 * Responsibilities:
 * - parse one key/value property and its trailing-comma state.
 * - walk an object's contents in token order.
 *
 * Invariants:
 * - properties are reported in source order with their original indices.
 * - invalid token order yields `null` rather than a partial list.
 *
 * Cross-links:
 * - `keys.ts` for key token parsing.
 * - `object-scanner.ts` for value boundaries.
 * - `lexer.ts` for whitespace and comment skipping.
 * - `source-text.ts` for the branded text the steps share.
 */
import JSON5 from 'json5';

import {NON_VALUE_START_CHARS, parserFailureSentinel} from './characters';
import {parseObjectKey} from './keys';
import {skipWhitespaceAndComments} from './lexer';
import {findPropertyValueEnd} from './object-scanner';
import {sourceText, type SourceText} from './source-text';
import type {Json5ObjectProperty, Json5ObjectRange, ParseRange} from './types';

type PropertyListState = {
  readonly hasParsedProperty: boolean;
  readonly lastTokenWasComma: boolean;
};

type Step<T> = {success: true; value: T} | {success: false};

const isInvalidValueStart = (ch: string): boolean => NON_VALUE_START_CHARS.has(ch);

const readColonIndexAfterKey = (source: SourceText, window: ParseRange): Step<number> => {
  const colonIndex = skipWhitespaceAndComments(source, window);
  if (colonIndex === parserFailureSentinel || source[colonIndex] !== ':') {
    return {success: false};
  }
  return {success: true, value: colonIndex};
};

const readValueStartIndexAfterColon = (source: SourceText, window: ParseRange): Step<number> => {
  const valueStartIndex = skipWhitespaceAndComments(source, window);
  if (valueStartIndex === parserFailureSentinel || valueStartIndex >= window.limitIndex) {
    return {success: false};
  }
  if (isInvalidValueStart(source[valueStartIndex])) return {success: false};
  return {success: true, value: valueStartIndex};
};

const computeValueEndIndex = (source: SourceText, valueRange: ParseRange): Step<number> => {
  const valueEndIndex = findPropertyValueEnd(source, valueRange);
  if (valueEndIndex === parserFailureSentinel) {
    return {success: false};
  }
  try {
    JSON5.parse(source.slice(valueRange.startIndex, valueEndIndex));
  } catch {
    return {success: false};
  }
  return {success: true, value: valueEndIndex};
};

const readAfterValue = (
  source: SourceText,
  window: ParseRange
): Step<{afterValueIndex: number; hasTrailingComma: boolean; nextCursor: number}> => {
  const afterValueIndex = skipWhitespaceAndComments(source, window);
  if (afterValueIndex === parserFailureSentinel) {
    return {success: false};
  }
  const hasTrailingComma = source[afterValueIndex] === ',';
  return {
    success: true,
    value: {
      afterValueIndex,
      hasTrailingComma,
      nextCursor: hasTrailingComma ? afterValueIndex + 1 : afterValueIndex
    }
  };
};

const parseSingleProperty = (
  source: SourceText,
  range: ParseRange
): {property: Json5ObjectProperty; nextCursor: number} | null => {
  const parsedKey = parseObjectKey(source, range);
  if (!parsedKey) return null;

  const colonIndexStep = readColonIndexAfterKey(source, {
    startIndex: parsedKey.endIndex,
    limitIndex: range.limitIndex
  });
  if (!colonIndexStep.success) return null;

  const valueStartIndexStep = readValueStartIndexAfterColon(source, {
    startIndex: colonIndexStep.value + 1,
    limitIndex: range.limitIndex
  });
  if (!valueStartIndexStep.success) return null;

  const valueEndIndexStep = computeValueEndIndex(source, {
    startIndex: valueStartIndexStep.value,
    limitIndex: range.limitIndex
  });
  if (!valueEndIndexStep.success) return null;

  const afterValueStep = readAfterValue(source, {
    startIndex: valueEndIndexStep.value,
    limitIndex: range.limitIndex
  });
  if (!afterValueStep.success) return null;

  return {
    property: {
      key: parsedKey.key,
      keyStartIndex: parsedKey.startIndex,
      valueStartIndex: valueStartIndexStep.value,
      valueEndIndex: valueEndIndexStep.value,
      hasTrailingComma: afterValueStep.value.hasTrailingComma
    },
    nextCursor: afterValueStep.value.nextCursor
  };
};

const processObjectComma = (
  source: SourceText,
  range: ParseRange,
  listState: PropertyListState
): {success: false} | {success: true; nextCursor: number; newState: PropertyListState} => {
  if (!listState.hasParsedProperty || listState.lastTokenWasComma) {
    return {success: false};
  }
  const nextCursor = skipWhitespaceAndComments(source, {
    startIndex: range.startIndex + 1,
    limitIndex: range.limitIndex
  });
  if (nextCursor === parserFailureSentinel) {
    return {success: false};
  }
  return {success: true, nextCursor, newState: {...listState, lastTokenWasComma: true}};
};

const processObjectProperty = (
  source: SourceText,
  range: ParseRange,
  listState: PropertyListState
):
  | {success: false}
  | {success: true; nextCursor: number; property: Json5ObjectProperty; newState: PropertyListState} => {
  if (listState.hasParsedProperty && !listState.lastTokenWasComma) {
    return {success: false};
  }
  const parsedProperty = parseSingleProperty(source, range);
  if (!parsedProperty) {
    return {success: false};
  }
  const nextCursor = skipWhitespaceAndComments(source, {
    startIndex: parsedProperty.nextCursor,
    limitIndex: range.limitIndex
  });
  if (nextCursor === parserFailureSentinel) {
    return {success: false};
  }
  return {
    success: true,
    nextCursor,
    property: parsedProperty.property,
    newState: {hasParsedProperty: true, lastTokenWasComma: parsedProperty.property.hasTrailingComma}
  };
};

/**
 * Parses properties within an object range while preserving source indices.
 *
 * Returns `null` when token order is invalid or parsing fails.
 */
export const parseObjectProperties = (raw: string, objectRange: Json5ObjectRange): Json5ObjectProperty[] | null => {
  const source = sourceText(raw);
  const properties: Json5ObjectProperty[] = [];
  let cursor = skipWhitespaceAndComments(source, {
    startIndex: objectRange.openBraceIndex + 1,
    limitIndex: objectRange.closeBraceIndex
  });
  if (cursor === parserFailureSentinel) {
    return null;
  }
  let listState: PropertyListState = {hasParsedProperty: false, lastTokenWasComma: false};

  while (cursor < objectRange.closeBraceIndex) {
    if (source[cursor] === ',') {
      const result = processObjectComma(
        source,
        {startIndex: cursor, limitIndex: objectRange.closeBraceIndex},
        listState
      );
      if (!result.success) return null;
      cursor = result.nextCursor;
      listState = result.newState;
      continue;
    }

    const result = processObjectProperty(
      source,
      {startIndex: cursor, limitIndex: objectRange.closeBraceIndex},
      listState
    );
    if (!result.success) return null;
    properties.push(result.property);
    listState = result.newState;
    cursor = result.nextCursor;
  }

  return properties;
};
