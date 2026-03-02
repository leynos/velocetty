/** @file JSON5 object parsing helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';
import {
  type ParsingState,
  processBlockComment,
  processDelimitersAndComments,
  processLineComment,
  processStringContext
} from './plugin-runtime-json5-parsing-state';

export type Json5ObjectRange = {openBraceIndex: number; closeBraceIndex: number};

export type Json5ObjectProperty = {
  key: string;
  keyStartIndex: number;
  valueStartIndex: number;
  valueEndIndex: number;
  hasTrailingComma: boolean;
};

type ParsedObjectKey = {key: string; startIndex: number; endIndex: number};

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

  private parseQuotedKey(startIndex: number, limitIndex: number): ParsedObjectKey | null {
    const endIndex = this.parseQuotedStringEnd(startIndex, limitIndex);
    if (endIndex === -1) return null;
    try {
      return {key: JSON5.parse(this.raw.slice(startIndex, endIndex)) as string, startIndex, endIndex};
    } catch {
      return null;
    }
  }

  private parseUnquotedKey(startIndex: number, limitIndex: number): ParsedObjectKey | null {
    const firstCodePoint = this.readCodePoint(startIndex);
    if (!firstCodePoint || !identifierStartPattern.test(firstCodePoint.character)) return null;

    let cursor = firstCodePoint.nextIndex;
    while (cursor < limitIndex) {
      const nextCodePoint = this.readCodePoint(cursor);
      if (!nextCodePoint || !identifierContinuePattern.test(nextCodePoint.character)) break;
      cursor = nextCodePoint.nextIndex;
    }

    return {key: this.raw.slice(startIndex, cursor), startIndex, endIndex: cursor};
  }

  private parseObjectKey(startIndex: number, limitIndex: number): ParsedObjectKey | null {
    const first = this.raw[startIndex];
    return first === '"' || first === "'"
      ? this.parseQuotedKey(startIndex, limitIndex)
      : this.parseUnquotedKey(startIndex, limitIndex);
  }

  private findMatchingClosingBrace(openBraceIndex: number): number {
    if (this.raw[openBraceIndex] !== '{') {
      return -1;
    }

    let state: ParsingState = {
      depth: 0,
      inString: null,
      isEscaped: false,
      inLineComment: false,
      inBlockComment: false
    };

    for (let index = openBraceIndex; index < this.raw.length; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

      if (state.inLineComment) {
        state = processLineComment(state, current);
        continue;
      }
      if (state.inBlockComment) {
        const blockCommentResult = processBlockComment(state, current, next);
        state = blockCommentResult.state;
        index += blockCommentResult.skipNext ? 1 : 0;
        continue;
      }
      if (state.inString) {
        state = processStringContext(state, current);
        continue;
      }

      const delimiterResult = processDelimitersAndComments(state, current, next);
      state = delimiterResult.state;
      if (delimiterResult.foundClose) {
        return index;
      }
      if (delimiterResult.skipNext) {
        index += 1;
      }
    }

    return -1;
  }

  private findPropertyValueEnd(valueStartIndex: number, objectCloseIndex: number): number {
    let state: ParsingState = {
      depth: 0,
      inString: null,
      isEscaped: false,
      inLineComment: false,
      inBlockComment: false
    };
    let bracketDepth = 0;

    for (let index = valueStartIndex; index < objectCloseIndex; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

      if (state.inLineComment) {
        state = processLineComment(state, current);
        continue;
      }
      if (state.inBlockComment) {
        const blockCommentResult = processBlockComment(state, current, next);
        state = blockCommentResult.state;
        index += blockCommentResult.skipNext ? 1 : 0;
        continue;
      }
      if (state.inString) {
        state = processStringContext(state, current);
        continue;
      }

      if (current === '}' && state.depth === 0 && bracketDepth === 0) {
        return index;
      }
      if (current === ',' && state.depth === 0 && bracketDepth === 0) {
        return index;
      }
      if (current === '[') {
        bracketDepth += 1;
        continue;
      }
      if (current === ']') {
        bracketDepth -= 1;
        continue;
      }

      const delimiterResult = processDelimitersAndComments(state, current, next);
      state = delimiterResult.state;
      if (delimiterResult.skipNext) index += 1;
    }

    return objectCloseIndex;
  }

  private parseSingleProperty(
    startCursor: number,
    objectCloseIndex: number
  ): {property: Json5ObjectProperty; nextCursor: number} | null {
    const parsedKey = this.parseObjectKey(startCursor, objectCloseIndex);
    if (!parsedKey) return null;

    const colonIndex = this.skipWhitespaceAndComments(parsedKey.endIndex, objectCloseIndex);
    if (this.raw[colonIndex] !== ':') return null;

    const valueStartIndex = this.skipWhitespaceAndComments(colonIndex + 1, objectCloseIndex);
    if (valueStartIndex >= objectCloseIndex) return null;

    const valueEndIndex = this.findPropertyValueEnd(valueStartIndex, objectCloseIndex);
    const afterValueIndex = this.skipWhitespaceAndComments(valueEndIndex, objectCloseIndex);
    const hasTrailingComma = this.raw[afterValueIndex] === ',';

    return {
      property: {
        key: parsedKey.key,
        keyStartIndex: parsedKey.startIndex,
        valueStartIndex,
        valueEndIndex,
        hasTrailingComma
      },
      nextCursor: hasTrailingComma ? afterValueIndex + 1 : afterValueIndex
    };
  }

  public parseObjectProperties(objectRange: Json5ObjectRange): Json5ObjectProperty[] | null {
    const properties: Json5ObjectProperty[] = [];
    let cursor = this.skipWhitespaceAndComments(objectRange.openBraceIndex + 1, objectRange.closeBraceIndex);

    while (cursor < objectRange.closeBraceIndex) {
      if (this.raw[cursor] === ',') {
        cursor = this.skipWhitespaceAndComments(cursor + 1, objectRange.closeBraceIndex);
        continue;
      }

      const parsedProperty = this.parseSingleProperty(cursor, objectRange.closeBraceIndex);
      if (!parsedProperty) return null;
      properties.push(parsedProperty.property);
      cursor = this.skipWhitespaceAndComments(parsedProperty.nextCursor, objectRange.closeBraceIndex);
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
