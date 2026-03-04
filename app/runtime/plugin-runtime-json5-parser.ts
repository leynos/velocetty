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

export type ParseRange = {
  readonly startIndex: number;
  readonly limitIndex: number;
};

export type IndexCursor = {
  readonly index: number;
};

type ParsedObjectKey = {key: string; startIndex: number; endIndex: number};
type ValueEndContext = {
  readonly state: ParsingState;
  readonly bracketDepth: number;
};
type ValueEndCharacterResult = {
  readonly state: ParsingState;
  readonly nextIndex: number;
  readonly bracketDepth: number;
  readonly shouldTerminate: boolean;
  readonly isInvalid: boolean;
};

const isWhitespaceCharacter = (character: string): boolean =>
  character === ' ' ||
  character === '\n' ||
  character === '\r' ||
  character === '\t' ||
  character === '\u2028' ||
  character === '\u2029';

const isIndentationWhitespace = (character: string): boolean => character === ' ' || character === '\t';
const isLineTerminator = (character: string): boolean =>
  character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';

const identifierStartPattern = /[$_\p{ID_Start}]/u;
const identifierContinuePattern = /(?:[$_\p{ID_Continue}]|\u200C|\u200D)/u;

export class Json5Parser {
  public constructor(private readonly raw: string) {}

  public skipWhitespaceAndComments(range: ParseRange): number {
    let index = range.startIndex;
    while (index < range.limitIndex) {
      const current = this.raw[index];
      const next = this.raw[index + 1];
      if (isWhitespaceCharacter(current)) {
        index += 1;
        continue;
      }
      if (current === '/' && next === '/') {
        index = this.skipLineComment({startIndex: index, limitIndex: range.limitIndex});
        continue;
      }
      if (current === '/' && next === '*') {
        index = this.skipBlockComment({startIndex: index, limitIndex: range.limitIndex});
        continue;
      }
      break;
    }
    return index;
  }

  public getLineStartIndex(cursor: IndexCursor): number {
    const lineBreakIndex = this.raw.lastIndexOf('\n', Math.max(0, cursor.index - 1));
    return lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
  }

  public getLineIndent(cursor: IndexCursor): string {
    const lineStartIndex = this.getLineStartIndex(cursor);
    let index = lineStartIndex;
    while (index < this.raw.length && isIndentationWhitespace(this.raw[index])) {
      index += 1;
    }
    return this.raw.slice(lineStartIndex, index);
  }

  private skipLineComment(range: ParseRange): number {
    let index = range.startIndex + 2;
    while (index < range.limitIndex && !isLineTerminator(this.raw[index])) {
      index += 1;
    }
    return index;
  }

  private hasRoomForCommentEnd(cursor: IndexCursor, limitIndex: number): boolean {
    return cursor.index + 1 < limitIndex;
  }

  private isBlockCommentEnd(cursor: IndexCursor): boolean {
    return this.raw[cursor.index] === '*' && this.raw[cursor.index + 1] === '/';
  }

  private skipBlockComment(range: ParseRange): number {
    // Skip the opening '/*'
    let index = range.startIndex + 2;
    while (this.hasRoomForCommentEnd({index}, range.limitIndex) && !this.isBlockCommentEnd({index})) {
      index += 1;
    }
    return this.hasRoomForCommentEnd({index}, range.limitIndex) ? index + 2 : range.limitIndex;
  }

  private parseQuotedStringEnd(range: ParseRange): number {
    const quote = this.raw[range.startIndex];
    let index = range.startIndex + 1;
    while (index < range.limitIndex) {
      const current = this.raw[index];
      if (current === '\\') {
        if (index + 1 >= range.limitIndex) {
          return -1;
        }
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

  private readCodePoint(cursor: IndexCursor): {character: string; nextIndex: number} | null {
    const codePoint = this.raw.codePointAt(cursor.index);
    if (codePoint === undefined) {
      return null;
    }
    const character = String.fromCodePoint(codePoint);
    return {
      character,
      nextIndex: cursor.index + character.length
    };
  }

  private parseQuotedKey(range: ParseRange): ParsedObjectKey | null {
    const endIndex = this.parseQuotedStringEnd(range);
    if (endIndex === -1) return null;
    try {
      return {
        key: JSON5.parse(this.raw.slice(range.startIndex, endIndex)) as string,
        startIndex: range.startIndex,
        endIndex
      };
    } catch {
      return null;
    }
  }

  private parseUnquotedKey(range: ParseRange): ParsedObjectKey | null {
    const firstCodePoint = this.readCodePoint({index: range.startIndex});
    if (!firstCodePoint || !identifierStartPattern.test(firstCodePoint.character)) return null;

    let cursor = firstCodePoint.nextIndex;
    while (cursor < range.limitIndex) {
      const nextCodePoint = this.readCodePoint({index: cursor});
      if (!nextCodePoint || !identifierContinuePattern.test(nextCodePoint.character)) break;
      cursor = nextCodePoint.nextIndex;
    }

    return {key: this.raw.slice(range.startIndex, cursor), startIndex: range.startIndex, endIndex: cursor};
  }

  private parseObjectKey(range: ParseRange): ParsedObjectKey | null {
    const first = this.raw[range.startIndex];
    return first === '"' || first === "'" ? this.parseQuotedKey(range) : this.parseUnquotedKey(range);
  }

  private applyBlockCommentResult(
    result: {state: ParsingState; skipNext: boolean},
    cursor: IndexCursor
  ): {state: ParsingState; nextIndex: number} {
    return {
      state: result.state,
      nextIndex: cursor.index + (result.skipNext ? 1 : 0)
    };
  }

  private applyDelimiterResult(
    result: {state: ParsingState; skipNext: boolean; foundClose: boolean},
    cursor: IndexCursor
  ): {state: ParsingState; nextIndex: number; shouldReturn: boolean; returnValue: number} {
    return {
      state: result.state,
      nextIndex: cursor.index + (result.skipNext ? 1 : 0),
      shouldReturn: result.foundClose,
      returnValue: cursor.index
    };
  }

  private findMatchingClosingBrace(cursor: IndexCursor): number {
    if (this.raw[cursor.index] !== '{') {
      return -1;
    }

    let state: ParsingState = {
      depth: 0,
      inString: null,
      isEscaped: false,
      inLineComment: false,
      inBlockComment: false
    };

    for (let index = cursor.index; index < this.raw.length; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

      if (state.inLineComment) {
        state = processLineComment(state, current);
        continue;
      }
      if (state.inBlockComment) {
        const appliedBlockCommentResult = this.applyBlockCommentResult(processBlockComment(state, current, next), {
          index
        });
        state = appliedBlockCommentResult.state;
        index = appliedBlockCommentResult.nextIndex;
        continue;
      }
      if (state.inString) {
        state = processStringContext(state, current);
        continue;
      }

      const appliedDelimiterResult = this.applyDelimiterResult(processDelimitersAndComments(state, current, next), {
        index
      });
      state = appliedDelimiterResult.state;
      index = appliedDelimiterResult.nextIndex;
      if (appliedDelimiterResult.shouldReturn) return appliedDelimiterResult.returnValue;
    }

    return -1;
  }

  private isAtTopLevel(state: ParsingState, bracketDepth: number): boolean {
    return state.depth === 0 && bracketDepth === 0;
  }

  private isValueTerminator(current: string, state: ParsingState, bracketDepth: number): boolean {
    const atTopLevel = this.isAtTopLevel(state, bracketDepth);
    const isClosingBrace = current === '}';
    const isComma = current === ',';
    return atTopLevel && (isClosingBrace || isComma);
  }

  private updateBracketDepth(current: string, bracketDepth: number): number {
    if (current === '[') {
      return bracketDepth + 1;
    }
    if (current === ']') {
      return bracketDepth - 1;
    }
    return bracketDepth;
  }

  private applyBlockCommentResultForValueEnd(
    result: {state: ParsingState; skipNext: boolean},
    cursor: IndexCursor
  ): {state: ParsingState; nextIndex: number} {
    return {
      state: result.state,
      nextIndex: cursor.index + (result.skipNext ? 1 : 0)
    };
  }

  private updateBracketDepthWithValidation(
    current: string,
    currentDepth: number
  ): {newDepth: number; isInvalid: boolean} {
    const newDepth = this.updateBracketDepth(current, currentDepth);
    return {
      newDepth,
      isInvalid: current === ']' && newDepth < 0
    };
  }

  private applyDelimiterResultForValueEnd(
    result: {state: ParsingState; skipNext: boolean},
    cursor: IndexCursor
  ): {state: ParsingState; nextIndex: number} {
    return {
      state: result.state,
      nextIndex: cursor.index + (result.skipNext ? 1 : 0)
    };
  }

  private processValueEndCharacter(
    current: string,
    next: string | undefined,
    context: ValueEndContext,
    cursor: IndexCursor
  ): ValueEndCharacterResult {
    if (this.isValueTerminator(current, context.state, context.bracketDepth)) {
      return {
        state: context.state,
        nextIndex: cursor.index,
        bracketDepth: context.bracketDepth,
        shouldTerminate: true,
        isInvalid: false
      };
    }

    const bracketUpdate = this.updateBracketDepthWithValidation(current, context.bracketDepth);
    if (bracketUpdate.isInvalid) {
      return {
        state: context.state,
        nextIndex: cursor.index,
        bracketDepth: context.bracketDepth,
        shouldTerminate: false,
        isInvalid: true
      };
    }

    if (bracketUpdate.newDepth !== context.bracketDepth) {
      return {
        state: context.state,
        nextIndex: cursor.index,
        bracketDepth: bracketUpdate.newDepth,
        shouldTerminate: false,
        isInvalid: false
      };
    }

    const applied = this.applyDelimiterResultForValueEnd(
      processDelimitersAndComments(context.state, current, next ?? ''),
      cursor
    );
    return {
      state: applied.state,
      nextIndex: applied.nextIndex,
      bracketDepth: context.bracketDepth,
      shouldTerminate: false,
      isInvalid: false
    };
  }

  private findPropertyValueEnd(range: ParseRange): number {
    let context: ValueEndContext = {
      state: {
        depth: 0,
        inString: null,
        isEscaped: false,
        inLineComment: false,
        inBlockComment: false
      },
      bracketDepth: 0
    };

    for (let index = range.startIndex; index < range.limitIndex; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

      if (context.state.inLineComment) {
        context = {...context, state: processLineComment(context.state, current)};
        continue;
      }
      if (context.state.inBlockComment) {
        const appliedBlockCommentResult = this.applyBlockCommentResultForValueEnd(
          processBlockComment(context.state, current, next),
          {index}
        );
        context = {...context, state: appliedBlockCommentResult.state};
        index = appliedBlockCommentResult.nextIndex;
        continue;
      }
      if (context.state.inString) {
        context = {...context, state: processStringContext(context.state, current)};
        continue;
      }

      const result = this.processValueEndCharacter(current, next, context, {index});
      if (result.shouldTerminate) return index;
      if (result.isInvalid) return -1;
      context = {state: result.state, bracketDepth: result.bracketDepth};
      index = result.nextIndex;
    }

    return context.state.depth === 0 ? range.limitIndex : -1;
  }

  private parseSingleProperty(range: ParseRange): {property: Json5ObjectProperty; nextCursor: number} | null {
    const parsedKey = this.parseObjectKey(range);
    if (!parsedKey) return null;

    const colonIndex = this.skipWhitespaceAndComments({startIndex: parsedKey.endIndex, limitIndex: range.limitIndex});
    if (this.raw[colonIndex] !== ':') return null;

    const valueStartIndex = this.skipWhitespaceAndComments({startIndex: colonIndex + 1, limitIndex: range.limitIndex});
    if (valueStartIndex >= range.limitIndex) return null;

    const valueEndIndex = this.findPropertyValueEnd({startIndex: valueStartIndex, limitIndex: range.limitIndex});
    if (valueEndIndex === -1) return null;
    const afterValueIndex = this.skipWhitespaceAndComments({startIndex: valueEndIndex, limitIndex: range.limitIndex});
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
    let cursor = this.skipWhitespaceAndComments({
      startIndex: objectRange.openBraceIndex + 1,
      limitIndex: objectRange.closeBraceIndex
    });
    let hasParsedProperty = false;
    let lastTokenWasComma = false;

    while (cursor < objectRange.closeBraceIndex) {
      if (this.raw[cursor] === ',') {
        if (!hasParsedProperty || lastTokenWasComma) {
          return null;
        }
        cursor = this.skipWhitespaceAndComments({startIndex: cursor + 1, limitIndex: objectRange.closeBraceIndex});
        lastTokenWasComma = true;
        continue;
      }
      if (hasParsedProperty && !lastTokenWasComma) {
        return null;
      }

      const parsedProperty = this.parseSingleProperty({startIndex: cursor, limitIndex: objectRange.closeBraceIndex});
      if (!parsedProperty) return null;
      properties.push(parsedProperty.property);
      hasParsedProperty = true;
      lastTokenWasComma = parsedProperty.property.hasTrailingComma;
      cursor = this.skipWhitespaceAndComments({
        startIndex: parsedProperty.nextCursor,
        limitIndex: objectRange.closeBraceIndex
      });
    }

    return properties;
  }

  public findRootObjectRange(): Json5ObjectRange | null {
    const rootStartIndex = this.skipWhitespaceAndComments({startIndex: 0, limitIndex: this.raw.length});
    if (this.raw[rootStartIndex] !== '{') {
      return null;
    }
    const closeBraceIndex = this.findMatchingClosingBrace({index: rootStartIndex});
    if (closeBraceIndex === -1) {
      return null;
    }
    const trailingIndex = this.skipWhitespaceAndComments({
      startIndex: closeBraceIndex + 1,
      limitIndex: this.raw.length
    });
    if (trailingIndex !== this.raw.length) {
      return null;
    }
    return {openBraceIndex: rootStartIndex, closeBraceIndex};
  }

  public getObjectProperty(objectRange: Json5ObjectRange, key: string): Json5ObjectProperty | null {
    const properties = this.parseObjectProperties(objectRange);
    if (!properties) {
      return null;
    }
    return properties.find((property) => property.key === key) ?? null;
  }

  public getObjectRangeForProperty(property: Json5ObjectProperty): Json5ObjectRange | null {
    const valueStart = this.skipWhitespaceAndComments({
      startIndex: property.valueStartIndex,
      limitIndex: this.raw.length
    });
    if (this.raw[valueStart] !== '{') {
      return null;
    }
    const closeBraceIndex = this.findMatchingClosingBrace({index: valueStart});
    if (closeBraceIndex === -1) {
      return null;
    }
    return {openBraceIndex: valueStart, closeBraceIndex};
  }
}
