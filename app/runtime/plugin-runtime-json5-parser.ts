/** @file JSON5 object parsing helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';
import {
  type ParsingState,
  processBlockComment,
  processDelimitersAndComments,
  processLineComment,
  processStringContext
} from './plugin-runtime-json5-parsing-state';

/**
 * Delimits an object literal in raw JSON5 source.
 *
 * `openBraceIndex` points at the opening `{` character and `closeBraceIndex`
 * points at the matching closing `}` character.
 */
export type Json5ObjectRange = {openBraceIndex: number; closeBraceIndex: number};

/**
 * Captures a parsed key/value entry inside a JSON5 object.
 *
 * `keyStartIndex` points at the first character of the key token.
 * `valueStartIndex` is the first non-whitespace/comment character of the value.
 * `valueEndIndex` is the terminating delimiter index (`,` or `}` boundary).
 * `hasTrailingComma` is true when a comma follows the value before the next key.
 */
export type Json5ObjectProperty = {
  key: string;
  keyStartIndex: number;
  valueStartIndex: number;
  valueEndIndex: number;
  hasTrailingComma: boolean;
};

/** Read-only start/limit cursor window used for parser scans. */
export type ParseRange = {
  readonly startIndex: number;
  readonly limitIndex: number;
};

/** Read-only single cursor index wrapper used for parser helper calls. */
export type IndexCursor = {
  readonly index: number;
};

type ParsedObjectKey = {key: string; startIndex: number; endIndex: number};
type ValueEndContext = {
  readonly state: ParsingState;
  readonly bracketDepth: number;
};
type CharacterContext = {
  readonly current: string;
  readonly next: string | undefined;
  readonly index: number;
};
type ValueEndCharacterResult = {
  readonly state: ParsingState;
  readonly nextIndex: number;
  readonly bracketDepth: number;
  readonly shouldTerminate: boolean;
  readonly isInvalid: boolean;
};
type SkipResult = {kind: 'advanced'; nextIndex: number} | {kind: 'invalid'} | {kind: 'none'};

const parserFailureSentinel = -1;

const isWhitespaceCharacter = (character: string): boolean =>
  character === ' ' ||
  character === '\n' ||
  character === '\r' ||
  character === '\t' ||
  character === '\u000B' ||
  character === '\u000C' ||
  character === '\u00A0' ||
  character === '\uFEFF' ||
  character === '\u2028' ||
  character === '\u2029';

const isIndentationWhitespace = (character: string): boolean => character === ' ' || character === '\t';
const isLineTerminator = (character: string): boolean =>
  character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';

const identifierStartPattern = /[$_\p{ID_Start}]/u;
const identifierContinuePattern = /(?:[$_\p{ID_Continue}]|\u200C|\u200D)/u;

/**
 * Parses and locates JSON5 object structures for round-trip-safe mutations.
 *
 * The parser operates on the original document string and returns index ranges
 * so callers can preserve formatting and comments while editing targeted values.
 */
export class Json5Parser {
  public constructor(private readonly raw: string) {}

  /**
   * Advances through whitespace and comments within a bounded scan range.
   *
   * Returns the first non-whitespace/comment index or `-1` when an unterminated
   * block comment is encountered.
   */
  private tryAdvanceWhitespaceOrComment(index: number, limitIndex: number): SkipResult {
    const current = this.raw[index];
    const next = this.raw[index + 1];
    if (isWhitespaceCharacter(current)) {
      return {kind: 'advanced', nextIndex: index + 1};
    }
    if (current === '/' && next === '/') {
      const nextIndex = this.skipLineComment({startIndex: index, limitIndex});
      return {kind: 'advanced', nextIndex};
    }
    if (current === '/' && next === '*') {
      const nextIndex = this.skipBlockComment({startIndex: index, limitIndex});
      if (nextIndex === parserFailureSentinel) {
        return {kind: 'invalid'};
      }
      return {kind: 'advanced', nextIndex};
    }
    return {kind: 'none'};
  }

  public skipWhitespaceAndComments(range: ParseRange): number {
    let index = range.startIndex;
    while (index < range.limitIndex) {
      const skipResult = this.tryAdvanceWhitespaceOrComment(index, range.limitIndex);
      if (skipResult.kind === 'advanced') {
        index = skipResult.nextIndex;
        continue;
      }
      if (skipResult.kind === 'invalid') {
        return parserFailureSentinel;
      }
      break;
    }
    return index;
  }

  /** Returns the index of the start of the line that contains `cursor.index`. */
  public getLineStartIndex(cursor: IndexCursor): number {
    const lineBreakIndex = this.raw.lastIndexOf('\n', Math.max(0, cursor.index - 1));
    return lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
  }

  /** Returns the leading indentation (spaces/tabs) for the line at `cursor.index`. */
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
    return this.hasRoomForCommentEnd({index}, range.limitIndex) ? index + 2 : parserFailureSentinel;
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
    ctx: CharacterContext,
    state: ParsingState,
    bracketDepth: number
  ): ValueEndCharacterResult {
    if (this.isValueTerminator(ctx.current, state, bracketDepth)) {
      return {
        state,
        nextIndex: ctx.index,
        bracketDepth,
        shouldTerminate: true,
        isInvalid: false
      };
    }

    const bracketUpdate = this.updateBracketDepthWithValidation(ctx.current, bracketDepth);
    if (bracketUpdate.isInvalid) {
      return {
        state,
        nextIndex: ctx.index,
        bracketDepth,
        shouldTerminate: false,
        isInvalid: true
      };
    }

    if (bracketUpdate.newDepth !== bracketDepth) {
      return {
        state,
        nextIndex: ctx.index,
        bracketDepth: bracketUpdate.newDepth,
        shouldTerminate: false,
        isInvalid: false
      };
    }

    const applied = this.applyDelimiterResultForValueEnd(
      processDelimitersAndComments(state, ctx.current, ctx.next ?? ''),
      {index: ctx.index}
    );
    return {
      state: applied.state,
      nextIndex: applied.nextIndex,
      bracketDepth,
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

      const result = this.processValueEndCharacter({current, next, index}, context.state, context.bracketDepth);
      if (result.shouldTerminate) return index;
      if (result.isInvalid) return parserFailureSentinel;
      context = {state: result.state, bracketDepth: result.bracketDepth};
      index = result.nextIndex;
    }

    const hasBalancedDepth = context.state.depth === 0 && context.bracketDepth === 0;
    const isRootLexicalState =
      context.state.inString === null &&
      !context.state.isEscaped &&
      !context.state.inLineComment &&
      !context.state.inBlockComment;
    return hasBalancedDepth && isRootLexicalState ? range.limitIndex : parserFailureSentinel;
  }

  private parseSingleProperty(range: ParseRange): {property: Json5ObjectProperty; nextCursor: number} | null {
    const parsedKey = this.parseObjectKey(range);
    if (!parsedKey) return null;

    const colonIndex = this.skipWhitespaceAndComments({startIndex: parsedKey.endIndex, limitIndex: range.limitIndex});
    if (colonIndex === parserFailureSentinel) return null;
    if (this.raw[colonIndex] !== ':') return null;

    const valueStartIndex = this.skipWhitespaceAndComments({startIndex: colonIndex + 1, limitIndex: range.limitIndex});
    if (valueStartIndex === parserFailureSentinel) return null;
    if (valueStartIndex >= range.limitIndex) return null;

    const valueEndIndex = this.findPropertyValueEnd({startIndex: valueStartIndex, limitIndex: range.limitIndex});
    if (valueEndIndex === parserFailureSentinel) return null;
    const afterValueIndex = this.skipWhitespaceAndComments({startIndex: valueEndIndex, limitIndex: range.limitIndex});
    if (afterValueIndex === parserFailureSentinel) return null;
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

  /**
   * Parses properties within an object range while preserving source indices.
   *
   * Returns `null` when token order is invalid or parsing fails.
   */
  public parseObjectProperties(objectRange: Json5ObjectRange): Json5ObjectProperty[] | null {
    const properties: Json5ObjectProperty[] = [];
    let cursor = this.skipWhitespaceAndComments({
      startIndex: objectRange.openBraceIndex + 1,
      limitIndex: objectRange.closeBraceIndex
    });
    if (cursor === parserFailureSentinel) {
      return null;
    }
    let hasParsedProperty = false;
    let lastTokenWasComma = false;

    while (cursor < objectRange.closeBraceIndex) {
      if (this.raw[cursor] === ',') {
        if (!hasParsedProperty || lastTokenWasComma) {
          return null;
        }
        cursor = this.skipWhitespaceAndComments({startIndex: cursor + 1, limitIndex: objectRange.closeBraceIndex});
        if (cursor === parserFailureSentinel) {
          return null;
        }
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
      if (cursor === parserFailureSentinel) {
        return null;
      }
    }

    return properties;
  }

  /**
   * Locates the top-level object in the parser source.
   *
   * Returns `null` when no valid root object exists or trailing content remains.
   */
  public findRootObjectRange(): Json5ObjectRange | null {
    const rootStartIndex = this.skipWhitespaceAndComments({startIndex: 0, limitIndex: this.raw.length});
    if (rootStartIndex === parserFailureSentinel) {
      return null;
    }
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
    if (trailingIndex === parserFailureSentinel) {
      return null;
    }
    if (trailingIndex !== this.raw.length) {
      return null;
    }
    return {openBraceIndex: rootStartIndex, closeBraceIndex};
  }

  /** Returns a parsed property by key from an object range, or `null` if missing. */
  public getObjectProperty(objectRange: Json5ObjectRange, key: string): Json5ObjectProperty | null {
    const properties = this.parseObjectProperties(objectRange);
    if (!properties) {
      return null;
    }
    return properties.find((property) => property.key === key) ?? null;
  }

  /** Resolves an object value range for a previously parsed property value. */
  public getObjectRangeForProperty(property: Json5ObjectProperty): Json5ObjectRange | null {
    const valueStart = this.skipWhitespaceAndComments({
      startIndex: property.valueStartIndex,
      limitIndex: this.raw.length
    });
    if (valueStart === parserFailureSentinel) {
      return null;
    }
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
