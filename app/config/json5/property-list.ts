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
 */
import JSON5 from 'json5';

import {NON_VALUE_START_CHARS, parserFailureSentinel} from './characters';
import {parseObjectKey} from './keys';
import {skipWhitespaceAndComments} from './lexer';
import {findPropertyValueEnd} from './object-scanner';
import type {IndexCursor, Json5ObjectProperty, Json5ObjectRange, ParseRange} from './types';

type PropertyListState = {
  readonly hasParsedProperty: boolean;
  readonly lastTokenWasComma: boolean;
};

type Step<T> = {success: true; value: T} | {success: false};

const readColonIndexAfterKey = (raw: string, range: ParseRange, keyEndIndex: number): Step<number> => {
  const colonIndex = skipWhitespaceAndComments(raw, {startIndex: keyEndIndex, limitIndex: range.limitIndex});
  if (colonIndex === parserFailureSentinel || raw[colonIndex] !== ':') {
    return {success: false};
  }
  return {success: true, value: colonIndex};
};

const readValueStartIndexAfterColon = (raw: string, range: ParseRange, colonIndex: number): Step<number> => {
  const valueStartIndex = skipWhitespaceAndComments(raw, {startIndex: colonIndex + 1, limitIndex: range.limitIndex});
  if (valueStartIndex === parserFailureSentinel || valueStartIndex >= range.limitIndex) {
    return {success: false};
  }
  const ch = raw[valueStartIndex];
  if (isInvalidValueStart(ch)) return {success: false};
  return {success: true, value: valueStartIndex};
};

const isInvalidValueStart = (ch: string): boolean => NON_VALUE_START_CHARS.has(ch);

const computeValueEndIndex = (raw: string, valueRange: ParseRange): Step<number> => {
  const valueEndIndex = findPropertyValueEnd(raw, valueRange);
  if (valueEndIndex === parserFailureSentinel) {
    return {success: false};
  }
  try {
    JSON5.parse(raw.slice(valueRange.startIndex, valueEndIndex));
  } catch {
    return {success: false};
  }
  return {success: true, value: valueEndIndex};
};

const readAfterValue = (
  raw: string,
  range: ParseRange,
  valueEndIndex: number
): Step<{afterValueIndex: number; hasTrailingComma: boolean; nextCursor: number}> => {
  const afterValueIndex = skipWhitespaceAndComments(raw, {startIndex: valueEndIndex, limitIndex: range.limitIndex});
  if (afterValueIndex === parserFailureSentinel) {
    return {success: false};
  }
  const hasTrailingComma = raw[afterValueIndex] === ',';
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
  raw: string,
  range: ParseRange
): {property: Json5ObjectProperty; nextCursor: number} | null => {
  const parsedKey = parseObjectKey(raw, range);
  if (!parsedKey) return null;

  const colonIndexStep = readColonIndexAfterKey(raw, range, parsedKey.endIndex);
  if (!colonIndexStep.success) return null;

  const valueStartIndexStep = readValueStartIndexAfterColon(raw, range, colonIndexStep.value);
  if (!valueStartIndexStep.success) return null;

  const valueEndIndexStep = computeValueEndIndex(raw, {
    startIndex: valueStartIndexStep.value,
    limitIndex: range.limitIndex
  });
  if (!valueEndIndexStep.success) return null;

  const afterValueStep = readAfterValue(raw, range, valueEndIndexStep.value);
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
  raw: string,
  cursor: IndexCursor,
  limitIndex: number,
  listState: PropertyListState
): {success: false} | {success: true; nextCursor: number; newState: PropertyListState} => {
  if (!listState.hasParsedProperty || listState.lastTokenWasComma) {
    return {success: false};
  }
  const nextCursor = skipWhitespaceAndComments(raw, {startIndex: cursor.index + 1, limitIndex});
  if (nextCursor === parserFailureSentinel) {
    return {success: false};
  }
  return {success: true, nextCursor, newState: {...listState, lastTokenWasComma: true}};
};

const processObjectProperty = (
  raw: string,
  cursor: IndexCursor,
  limitIndex: number,
  listState: PropertyListState
):
  | {success: false}
  | {success: true; nextCursor: number; property: Json5ObjectProperty; newState: PropertyListState} => {
  if (listState.hasParsedProperty && !listState.lastTokenWasComma) {
    return {success: false};
  }
  const parsedProperty = parseSingleProperty(raw, {startIndex: cursor.index, limitIndex});
  if (!parsedProperty) {
    return {success: false};
  }
  const nextCursor = skipWhitespaceAndComments(raw, {
    startIndex: parsedProperty.nextCursor,
    limitIndex
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
  const properties: Json5ObjectProperty[] = [];
  let cursor = skipWhitespaceAndComments(raw, {
    startIndex: objectRange.openBraceIndex + 1,
    limitIndex: objectRange.closeBraceIndex
  });
  if (cursor === parserFailureSentinel) {
    return null;
  }
  let listState: PropertyListState = {hasParsedProperty: false, lastTokenWasComma: false};

  while (cursor < objectRange.closeBraceIndex) {
    if (raw[cursor] === ',') {
      const result = processObjectComma(raw, {index: cursor}, objectRange.closeBraceIndex, listState);
      if (!result.success) return null;
      cursor = result.nextCursor;
      listState = result.newState;
      continue;
    }

    const result = processObjectProperty(raw, {index: cursor}, objectRange.closeBraceIndex, listState);
    if (!result.success) return null;
    properties.push(result.property);
    listState = result.newState;
    cursor = result.nextCursor;
  }

  return properties;
};
