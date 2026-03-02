/** @file JSON5 object parsing helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';

export type Json5ObjectRange = {openBraceIndex: number; closeBraceIndex: number};

export type Json5ObjectProperty = {
  key: string;
  keyStartIndex: number;
  valueStartIndex: number;
  valueEndIndex: number;
  hasTrailingComma: boolean;
};

const isWhitespaceCharacter = (character: string): boolean =>
  character === ' ' || character === '\n' || character === '\r' || character === '\t';

const identifierStartPattern = /[$_\p{ID_Start}]/u;
const identifierContinuePattern = /(?:[$_\p{ID_Continue}]|\u200C|\u200D)/u;

const skipLineComment = (raw: string, startIndex: number, limitIndex: number): number => {
  let index = startIndex + 2;
  while (index < limitIndex && raw[index] !== '\n') index += 1;
  return index;
};

const skipBlockComment = (raw: string, startIndex: number, limitIndex: number): number => {
  let index = startIndex + 2;
  while (index + 1 < limitIndex && !(raw[index] === '*' && raw[index + 1] === '/')) index += 1;
  return index + 1 < limitIndex ? index + 2 : limitIndex;
};

export class Json5Parser {
  public constructor(private readonly raw: string) {}

  public skipWhitespaceAndComments(fromIndex: number, limitIndex: number): number {
    let index = fromIndex;
    while (index < limitIndex) {
      const current = this.raw[index];
      const next = this.raw[index + 1];
      if (isWhitespaceCharacter(current)) {
        index += 1;
        continue;
      }
      if (current === '/' && next === '/') {
        index = skipLineComment(this.raw, index, limitIndex);
        continue;
      }
      if (current === '/' && next === '*') {
        index = skipBlockComment(this.raw, index, limitIndex);
        continue;
      }
      break;
    }
    return index;
  }

  public static skipWhitespaceAndComments(raw: string, fromIndex: number, limitIndex: number): number {
    return new Json5Parser(raw).skipWhitespaceAndComments(fromIndex, limitIndex);
  }

  public getLineStartIndex(index: number): number {
    const lineBreakIndex = this.raw.lastIndexOf('\n', Math.max(0, index - 1));
    return lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
  }

  public static getLineStartIndex(raw: string, index: number): number {
    return new Json5Parser(raw).getLineStartIndex(index);
  }

  public getLineIndent(index: number): string {
    const lineStartIndex = this.getLineStartIndex(index);
    let cursor = lineStartIndex;
    while (cursor < this.raw.length && (this.raw[cursor] === ' ' || this.raw[cursor] === '\t')) {
      cursor += 1;
    }
    return this.raw.slice(lineStartIndex, cursor);
  }

  public static getLineIndent(raw: string, index: number): string {
    return new Json5Parser(raw).getLineIndent(index);
  }

  private parseQuotedStringEnd(startIndex: number, limitIndex: number): number {
    const quote = this.raw[startIndex];
    let index = startIndex + 1;
    while (index < limitIndex) {
      const current = this.raw[index];
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
  }

  private readCodePoint(index: number): {character: string; nextIndex: number} | null {
    const codePoint = this.raw.codePointAt(index);
    if (codePoint === undefined) {
      return null;
    }
    const character = String.fromCodePoint(codePoint);
    return {
      character,
      nextIndex: index + character.length
    };
  }

  private parseObjectKey(
    startIndex: number,
    limitIndex: number
  ): {key: string; startIndex: number; endIndex: number} | null {
    const first = this.raw[startIndex];
    if (first === '"' || first === "'") {
      const endIndex = this.parseQuotedStringEnd(startIndex, limitIndex);
      if (endIndex === -1) {
        return null;
      }
      try {
        return {
          key: JSON5.parse(this.raw.slice(startIndex, endIndex)) as string,
          startIndex,
          endIndex
        };
      } catch {
        return null;
      }
    }

    const firstCodePoint = this.readCodePoint(startIndex);
    if (!firstCodePoint || !identifierStartPattern.test(firstCodePoint.character)) {
      return null;
    }

    let cursor = firstCodePoint.nextIndex;
    while (cursor < limitIndex) {
      const nextCodePoint = this.readCodePoint(cursor);
      if (!nextCodePoint || !identifierContinuePattern.test(nextCodePoint.character)) {
        break;
      }
      cursor = nextCodePoint.nextIndex;
    }

    return {key: this.raw.slice(startIndex, cursor), startIndex, endIndex: cursor};
  }

  private findMatchingClosingBrace(openBraceIndex: number): number {
    if (this.raw[openBraceIndex] !== '{') {
      return -1;
    }

    let depth = 0;
    let inString: '"' | "'" | null = null;
    let isEscaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = openBraceIndex; index < this.raw.length; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

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
  }

  private findPropertyValueEnd(valueStartIndex: number, objectCloseIndex: number): number {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString: '"' | "'" | null = null;
    let isEscaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = valueStartIndex; index < objectCloseIndex; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

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
  }

  public parseObjectProperties(objectRange: Json5ObjectRange): Json5ObjectProperty[] | null {
    const properties: Json5ObjectProperty[] = [];
    let cursor = this.skipWhitespaceAndComments(objectRange.openBraceIndex + 1, objectRange.closeBraceIndex);

    while (cursor < objectRange.closeBraceIndex) {
      if (this.raw[cursor] === ',') {
        cursor = this.skipWhitespaceAndComments(cursor + 1, objectRange.closeBraceIndex);
        continue;
      }

      const parsedKey = this.parseObjectKey(cursor, objectRange.closeBraceIndex);
      if (!parsedKey) {
        return null;
      }

      const colonIndex = this.skipWhitespaceAndComments(parsedKey.endIndex, objectRange.closeBraceIndex);
      if (this.raw[colonIndex] !== ':') {
        return null;
      }

      const valueStartIndex = this.skipWhitespaceAndComments(colonIndex + 1, objectRange.closeBraceIndex);
      if (valueStartIndex >= objectRange.closeBraceIndex) {
        return null;
      }

      const valueEndIndex = this.findPropertyValueEnd(valueStartIndex, objectRange.closeBraceIndex);
      const afterValueIndex = this.skipWhitespaceAndComments(valueEndIndex, objectRange.closeBraceIndex);
      const hasTrailingComma = this.raw[afterValueIndex] === ',';

      properties.push({
        key: parsedKey.key,
        keyStartIndex: parsedKey.startIndex,
        valueStartIndex,
        valueEndIndex,
        hasTrailingComma
      });

      const nextCursor = hasTrailingComma ? afterValueIndex + 1 : afterValueIndex;
      cursor = this.skipWhitespaceAndComments(nextCursor, objectRange.closeBraceIndex);
    }

    return properties;
  }

  public static parseObjectProperties(raw: string, objectRange: Json5ObjectRange): Json5ObjectProperty[] | null {
    return new Json5Parser(raw).parseObjectProperties(objectRange);
  }

  public findRootObjectRange(): Json5ObjectRange | null {
    const rootStartIndex = this.skipWhitespaceAndComments(0, this.raw.length);
    if (this.raw[rootStartIndex] !== '{') {
      return null;
    }
    const closeBraceIndex = this.findMatchingClosingBrace(rootStartIndex);
    if (closeBraceIndex === -1) {
      return null;
    }
    return {openBraceIndex: rootStartIndex, closeBraceIndex};
  }

  public static findRootObjectRange(raw: string): Json5ObjectRange | null {
    return new Json5Parser(raw).findRootObjectRange();
  }

  public getObjectProperty(objectRange: Json5ObjectRange, key: string): Json5ObjectProperty | null {
    const properties = this.parseObjectProperties(objectRange);
    if (!properties) {
      return null;
    }
    return properties.find((property) => property.key === key) ?? null;
  }

  public static getObjectProperty(raw: string, objectRange: Json5ObjectRange, key: string): Json5ObjectProperty | null {
    return new Json5Parser(raw).getObjectProperty(objectRange, key);
  }

  public getObjectRangeForProperty(property: Json5ObjectProperty): Json5ObjectRange | null {
    const valueStart = this.skipWhitespaceAndComments(property.valueStartIndex, this.raw.length);
    if (this.raw[valueStart] !== '{') {
      return null;
    }
    const closeBraceIndex = this.findMatchingClosingBrace(valueStart);
    if (closeBraceIndex === -1) {
      return null;
    }
    return {openBraceIndex: valueStart, closeBraceIndex};
  }

  public static getObjectRangeForProperty(raw: string, property: Json5ObjectProperty): Json5ObjectRange | null {
    return new Json5Parser(raw).getObjectRangeForProperty(property);
  }
}

export const skipWhitespaceAndComments = Json5Parser.skipWhitespaceAndComments;
export const getLineStartIndex = Json5Parser.getLineStartIndex;
export const getLineIndent = Json5Parser.getLineIndent;
export const parseObjectProperties = Json5Parser.parseObjectProperties;
export const findRootObjectRange = Json5Parser.findRootObjectRange;
export const getObjectProperty = Json5Parser.getObjectProperty;
export const getObjectRangeForProperty = Json5Parser.getObjectRangeForProperty;
