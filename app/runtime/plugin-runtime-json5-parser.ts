/** @file JSON5 object parsing helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';

export type Json5ObjectRange = {
  openBraceIndex: number;
  closeBraceIndex: number;
};

export type Json5ObjectProperty = {
  key: string;
  keyStartIndex: number;
  valueStartIndex: number;
  valueEndIndex: number;
  hasTrailingComma: boolean;
};

const isWhitespaceCharacter = (character: string): boolean =>
  character === ' ' || character === '\n' || character === '\r' || character === '\t';

export const skipWhitespaceAndComments = (
  raw: string,
  fromIndex: number,
  limitIndex: number
): number => {
  let index = fromIndex;
  while (index < limitIndex) {
    const current = raw[index];
    const next = raw[index + 1];
    if (isWhitespaceCharacter(current)) {
      index += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      index += 2;
      while (index < limitIndex && raw[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (current === '/' && next === '*') {
      index += 2;
      while (
        index + 1 < limitIndex &&
        !(raw[index] === '*' && raw[index + 1] === '/')
      ) {
        index += 1;
      }
      index = index + 1 < limitIndex ? index + 2 : limitIndex;
      continue;
    }
    break;
  }
  return index;
};

export const getLineStartIndex = (raw: string, index: number): number => {
  const lineBreakIndex = raw.lastIndexOf('\n', Math.max(0, index - 1));
  return lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
};

export const getLineIndent = (raw: string, index: number): string => {
  const lineStartIndex = getLineStartIndex(raw, index);
  let cursor = lineStartIndex;
  while (cursor < raw.length && (raw[cursor] === ' ' || raw[cursor] === '\t')) {
    cursor += 1;
  }
  return raw.slice(lineStartIndex, cursor);
};

const parseQuotedStringEnd = (
  raw: string,
  startIndex: number,
  limitIndex: number
): number => {
  const quote = raw[startIndex];
  let index = startIndex + 1;
  while (index < limitIndex) {
    const current = raw[index];
    if (current === '\\') {
      index += 2;
      continue;
    }
    if (current === quote) {
      return index + 1;
    }
    index += 1;
  }
  return -1;
};

const parseObjectKey = (
  raw: string,
  startIndex: number,
  limitIndex: number
): {key: string; startIndex: number; endIndex: number} | null => {
  const first = raw[startIndex];
  if (first === '"' || first === "'") {
    const endIndex = parseQuotedStringEnd(raw, startIndex, limitIndex);
    if (endIndex === -1) {
      return null;
    }
    try {
      return {
        key: JSON5.parse(raw.slice(startIndex, endIndex)) as string,
        startIndex,
        endIndex
      };
    } catch {
      return null;
    }
  }
  if (!/[A-Za-z_$]/.test(first)) {
    return null;
  }
  let cursor = startIndex + 1;
  while (cursor < limitIndex && /[A-Za-z0-9_$]/.test(raw[cursor])) {
    cursor += 1;
  }
  return {key: raw.slice(startIndex, cursor), startIndex, endIndex: cursor};
};

const findMatchingClosingBrace = (raw: string, openBraceIndex: number): number => {
  if (raw[openBraceIndex] !== '{') {
    return -1;
  }

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openBraceIndex; index < raw.length; index += 1) {
    const current = raw[index];
    const next = raw[index + 1];

    if (inLineComment) {
      inLineComment = current !== '\n';
      continue;
    }
    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (current === '\\') {
        isEscaped = true;
        continue;
      }
      if (current === inString) {
        inString = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      inString = current;
      continue;
    }
    if (current === '{') {
      depth += 1;
      continue;
    }
    if (current === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const findPropertyValueEnd = (
  raw: string,
  valueStartIndex: number,
  objectCloseIndex: number
): number => {
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString: '"' | "'" | null = null;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = valueStartIndex; index < objectCloseIndex; index += 1) {
    const current = raw[index];
    const next = raw[index + 1];

    if (inLineComment) {
      inLineComment = current !== '\n';
      continue;
    }
    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (current === '\\') {
        isEscaped = true;
        continue;
      }
      if (current === inString) {
        inString = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      inString = current;
      continue;
    }
    if (current === '{') {
      braceDepth += 1;
      continue;
    }
    if (current === '}') {
      if (braceDepth === 0 && bracketDepth === 0) {
        return index;
      }
      braceDepth -= 1;
      continue;
    }
    if (current === '[') {
      bracketDepth += 1;
      continue;
    }
    if (current === ']') {
      bracketDepth -= 1;
      continue;
    }
    if (current === ',' && braceDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }

  return objectCloseIndex;
};

export const parseObjectProperties = (
  raw: string,
  objectRange: Json5ObjectRange
): Json5ObjectProperty[] | null => {
  const properties: Json5ObjectProperty[] = [];
  let cursor = skipWhitespaceAndComments(
    raw,
    objectRange.openBraceIndex + 1,
    objectRange.closeBraceIndex
  );

  while (cursor < objectRange.closeBraceIndex) {
    if (raw[cursor] === ',') {
      cursor = skipWhitespaceAndComments(raw, cursor + 1, objectRange.closeBraceIndex);
      continue;
    }
    const parsedKey = parseObjectKey(raw, cursor, objectRange.closeBraceIndex);
    if (!parsedKey) {
      return null;
    }

    const colonIndex = skipWhitespaceAndComments(raw, parsedKey.endIndex, objectRange.closeBraceIndex);
    if (raw[colonIndex] !== ':') {
      return null;
    }

    const valueStartIndex = skipWhitespaceAndComments(
      raw,
      colonIndex + 1,
      objectRange.closeBraceIndex
    );
    if (valueStartIndex >= objectRange.closeBraceIndex) {
      return null;
    }
    const valueEndIndex = findPropertyValueEnd(raw, valueStartIndex, objectRange.closeBraceIndex);
    const afterValueIndex = skipWhitespaceAndComments(raw, valueEndIndex, objectRange.closeBraceIndex);
    const hasTrailingComma = raw[afterValueIndex] === ',';

    properties.push({
      key: parsedKey.key,
      keyStartIndex: parsedKey.startIndex,
      valueStartIndex,
      valueEndIndex,
      hasTrailingComma
    });

    const nextCursor = hasTrailingComma ? afterValueIndex + 1 : afterValueIndex;
    cursor = skipWhitespaceAndComments(raw, nextCursor, objectRange.closeBraceIndex);
  }

  return properties;
};

export const findRootObjectRange = (raw: string): Json5ObjectRange | null => {
  const rootStartIndex = skipWhitespaceAndComments(raw, 0, raw.length);
  if (raw[rootStartIndex] !== '{') {
    return null;
  }
  const closeBraceIndex = findMatchingClosingBrace(raw, rootStartIndex);
  if (closeBraceIndex === -1) {
    return null;
  }
  return {openBraceIndex: rootStartIndex, closeBraceIndex};
};

export const getObjectProperty = (
  raw: string,
  objectRange: Json5ObjectRange,
  key: string
): Json5ObjectProperty | null => {
  const properties = parseObjectProperties(raw, objectRange);
  if (!properties) {
    return null;
  }
  return properties.find((property) => property.key === key) ?? null;
};

export const getObjectRangeForProperty = (
  raw: string,
  property: Json5ObjectProperty
): Json5ObjectRange | null => {
  const valueStart = skipWhitespaceAndComments(raw, property.valueStartIndex, raw.length);
  if (raw[valueStart] !== '{') {
    return null;
  }
  const closeBraceIndex = findMatchingClosingBrace(raw, valueStart);
  if (closeBraceIndex === -1) {
    return null;
  }
  return {openBraceIndex: valueStart, closeBraceIndex};
};
