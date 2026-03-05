/**
 * @file JSON5 object parsing helpers for runtime plugin settings persistence.
 *
 * Responsibilities:
 * - parse root-object and property ranges from raw JSON5 documents.
 * - preserve index metadata so roundtrip edits keep comments and formatting.
 *
 * Invariants:
 * - returned indices always stay within the original source bounds.
 * - parsing helpers never mutate the source document.
 *
 * Cross-links:
 * - `plugin-runtime-json5-parsing-state.ts` for lexical state transitions.
 * - `plugin-runtime-json5-roundtrip.ts` for persistence edits that consume
 *   these ranges.
 *
 * Example:
 * - `const parser = new Json5Parser(raw); parser.findRootObjectRange();`
 */
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

/** Read-only key wrapper used for object-property lookups. */
export type PropertyKey = {
  readonly value: string;
} & {readonly __brand: 'PropertyKey'};

/**
 * `propertyKey` constructs a `PropertyKey` from a raw key string.
 *
 * @param value String key value to wrap.
 * @returns A `PropertyKey` wrapper object containing the provided `value`.
 */
export const propertyKey = (value: string): PropertyKey => ({value}) as PropertyKey;
const toKeyString = (key: PropertyKey | string): string => (typeof key === 'string' ? key : key.value);

type ParsedObjectKey = {key: string; startIndex: number; endIndex: number};
type PropertyListState = {
  readonly hasParsedProperty: boolean;
  readonly lastTokenWasComma: boolean;
};
type ValueEndContext = {
  readonly state: ParsingState;
  readonly bracketDepth: number;
};
type LexicalCharContext = {
  readonly context: ValueEndContext;
  readonly current: string;
  readonly next: string | undefined;
  readonly index: number;
};
type ValueEndPredicateContext = {
  readonly char: CharacterContext;
  readonly end: ValueEndContext;
  readonly delimiter: {readonly foundClose: boolean};
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
type AdvanceContext = {
  readonly cursor: IndexCursor;
  readonly limitIndex: number;
};
type SkipResult = {kind: 'advanced'; nextIndex: number} | {kind: 'invalid'} | {kind: 'none'};
type Step<T> = {success: true; value: T} | {success: false};

const parserFailureSentinel = -1;
const unicodeSpaceSeparatorPattern = /^\p{Zs}$/u;
const NON_VALUE_START_CHARS = new Set([',', '}', ']']);
const createInitialParsingState = (): ParsingState => ({
  depth: 0,
  inString: null,
  isEscaped: false,
  inLineComment: false,
  inBlockComment: false
});

const isWhitespaceCharacter = (character: string): boolean =>
  character === ' ' ||
  character === '\n' ||
  character === '\r' ||
  character === '\t' ||
  character === '\u000B' ||
  character === '\u000C' ||
  character === '\uFEFF' ||
  character === '\u2028' ||
  character === '\u2029' ||
  unicodeSpaceSeparatorPattern.test(character);

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
  private tryAdvanceWhitespaceOrComment(ctx: AdvanceContext): SkipResult {
    const current = this.raw[ctx.cursor.index];
    const next = this.raw[ctx.cursor.index + 1];
    if (isWhitespaceCharacter(current)) {
      return {kind: 'advanced', nextIndex: ctx.cursor.index + 1};
    }
    if (current === '/' && next === '/') {
      const nextIndex = this.skipLineComment({startIndex: ctx.cursor.index, limitIndex: ctx.limitIndex});
      return {kind: 'advanced', nextIndex};
    }
    if (current === '/' && next === '*') {
      const nextIndex = this.skipBlockComment({startIndex: ctx.cursor.index, limitIndex: ctx.limitIndex});
      if (nextIndex === parserFailureSentinel) {
        return {kind: 'invalid'};
      }
      return {kind: 'advanced', nextIndex};
    }
    return {kind: 'none'};
  }

  /**
   * Advances the cursor past whitespace and comment tokens.
   *
   * @param range Scan bounds where `startIndex` is the initial cursor and
   * `limitIndex` is the exclusive end boundary.
   * @returns The next non-whitespace/comment index, or
   * `parserFailureSentinel` when an invalid token (such as an unterminated
   * block comment) is encountered.
   */
  public skipWhitespaceAndComments(range: ParseRange): number {
    let index = range.startIndex;
    while (index < range.limitIndex) {
      const skipResult = this.tryAdvanceWhitespaceOrComment({
        cursor: {index},
        limitIndex: range.limitIndex
      });
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
    if (cursor.index === 0) {
      return 0;
    }
    for (let index = Math.max(0, cursor.index - 1); index >= 0; index -= 1) {
      if (isLineTerminator(this.raw[index])) {
        return index + 1;
      }
    }
    return 0;
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

  private parseUnicodeEscapeCharacter(cursor: IndexCursor): {character: string; nextIndex: number} | null {
    if (this.raw[cursor.index] !== '\\' || this.raw[cursor.index + 1] !== 'u') {
      return null;
    }

    // Intentional leniency: JSON5 (ES5.1) only requires `\uHHHH`, but this
    // parser also accepts ES6+ `\u{XXXXX}` escapes for unquoted identifier
    // keys. Roundtrip parser tests cover this behaviour.
    if (this.raw[cursor.index + 2] === '{') {
      const hexStartIndex = cursor.index + 3;
      const closeBraceIndex = this.raw.indexOf('}', hexStartIndex);
      if (closeBraceIndex === -1) {
        return null;
      }
      const codePointHex = this.raw.slice(hexStartIndex, closeBraceIndex);
      if (!/^[0-9A-Fa-f]{1,6}$/.test(codePointHex)) {
        return null;
      }
      const codePoint = Number.parseInt(codePointHex, 16);
      if (codePoint > 0x10ffff) {
        return null;
      }
      return {
        character: String.fromCodePoint(codePoint),
        nextIndex: closeBraceIndex + 1
      };
    }

    const hexStartIndex = cursor.index + 2;
    const hexEndIndex = hexStartIndex + 4;
    const codeUnit = this.raw.slice(hexStartIndex, hexEndIndex);
    if (!/^[0-9A-Fa-f]{4}$/.test(codeUnit)) {
      return null;
    }

    return {
      character: String.fromCodePoint(Number.parseInt(codeUnit, 16)),
      nextIndex: hexEndIndex
    };
  }

  private parseIdentifierCharacter(
    cursor: IndexCursor,
    isStart: boolean
  ): {character: string; nextIndex: number} | null {
    const parsed = this.parseUnicodeEscapeCharacter(cursor) ?? this.readCodePoint(cursor);
    if (!parsed) {
      return null;
    }
    const pattern = isStart ? identifierStartPattern : identifierContinuePattern;
    return pattern.test(parsed.character) ? parsed : null;
  }

  private parseUnquotedKey(range: ParseRange): ParsedObjectKey | null {
    const firstCharacter = this.parseIdentifierCharacter({index: range.startIndex}, true);
    if (!firstCharacter) return null;

    let cursor = firstCharacter.nextIndex;
    let key = firstCharacter.character;
    while (cursor < range.limitIndex) {
      const nextCharacter = this.parseIdentifierCharacter({index: cursor}, false);
      if (!nextCharacter) break;
      key += nextCharacter.character;
      cursor = nextCharacter.nextIndex;
    }

    return {key, startIndex: range.startIndex, endIndex: cursor};
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

    let state = createInitialParsingState();

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

  private isUnmatchedBraceInArrayCtx(c: ValueEndPredicateContext): boolean {
    const isClosingBrace = c.char.current === '}';
    const inArray = c.end.bracketDepth > 0;
    const atObjectTopLevel = c.end.state.depth === 0;
    return isClosingBrace && inArray && atObjectTopLevel && !c.delimiter.foundClose;
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

    const delimiterResult = processDelimitersAndComments(state, ctx.current, ctx.next ?? '');
    const checkCtx: ValueEndPredicateContext = {
      char: ctx,
      end: {state, bracketDepth},
      delimiter: {foundClose: delimiterResult.foundClose}
    };
    if (this.isUnmatchedBraceInArrayCtx(checkCtx)) {
      return {
        state,
        nextIndex: ctx.index,
        bracketDepth,
        shouldTerminate: false,
        isInvalid: true
      };
    }

    const applied = this.applyBlockCommentResult(delimiterResult, {index: ctx.index});
    return {
      state: applied.state,
      nextIndex: applied.nextIndex,
      bracketDepth,
      shouldTerminate: false,
      isInvalid: false
    };
  }

  private hasBalancedDepth(context: ValueEndContext): boolean {
    return context.state.depth === 0 && context.bracketDepth === 0;
  }

  private isRootLexicalState(state: ParsingState): boolean {
    return state.inString === null && !state.isEscaped && !state.inLineComment && !state.inBlockComment;
  }

  private isCleanParseEnd(context: ValueEndContext): boolean {
    return this.hasBalancedDepth(context) && this.isRootLexicalState(context.state);
  }

  private advanceActiveLexicalState({
    context,
    current,
    next,
    index
  }: LexicalCharContext): {advanced: true; context: ValueEndContext; nextIndex: number} | {advanced: false} {
    if (context.state.inLineComment) {
      return {
        advanced: true,
        context: {...context, state: processLineComment(context.state, current)},
        nextIndex: index
      };
    }
    if (context.state.inBlockComment) {
      const appliedBlockCommentResult = this.applyBlockCommentResult(
        processBlockComment(context.state, current, next ?? ''),
        {
          index
        }
      );
      return {
        advanced: true,
        context: {...context, state: appliedBlockCommentResult.state},
        nextIndex: appliedBlockCommentResult.nextIndex
      };
    }
    if (context.state.inString) {
      return {
        advanced: true,
        context: {...context, state: processStringContext(context.state, current)},
        nextIndex: index
      };
    }
    return {advanced: false};
  }

  private findPropertyValueEnd(range: ParseRange): number {
    let context: ValueEndContext = {
      state: createInitialParsingState(),
      bracketDepth: 0
    };

    for (let index = range.startIndex; index < range.limitIndex; index += 1) {
      const current = this.raw[index];
      const next = this.raw[index + 1];

      const step = this.advanceActiveLexicalState({context, current, next, index});
      if (step.advanced) {
        context = step.context;
        index = step.nextIndex;
        continue;
      }

      const result = this.processValueEndCharacter({current, next, index}, context.state, context.bracketDepth);
      if (result.shouldTerminate) return index;
      if (result.isInvalid) return parserFailureSentinel;
      context = {state: result.state, bracketDepth: result.bracketDepth};
      index = result.nextIndex;
    }

    return this.isCleanParseEnd(context) ? range.limitIndex : parserFailureSentinel;
  }

  private readColonIndexAfterKey(range: ParseRange, keyEndIndex: number): Step<number> {
    const colonIndex = this.skipWhitespaceAndComments({startIndex: keyEndIndex, limitIndex: range.limitIndex});
    if (colonIndex === parserFailureSentinel || this.raw[colonIndex] !== ':') {
      return {success: false};
    }
    return {success: true, value: colonIndex};
  }

  private readValueStartIndexAfterColon(range: ParseRange, colonIndex: number): Step<number> {
    const valueStartIndex = this.skipWhitespaceAndComments({startIndex: colonIndex + 1, limitIndex: range.limitIndex});
    if (valueStartIndex === parserFailureSentinel || valueStartIndex >= range.limitIndex) {
      return {success: false};
    }
    const ch = this.raw[valueStartIndex];
    if (this.isInvalidValueStart(ch)) return {success: false};
    return {success: true, value: valueStartIndex};
  }

  private isInvalidValueStart(ch: string): boolean {
    return NON_VALUE_START_CHARS.has(ch);
  }

  private computeValueEndIndex(valueRange: ParseRange): Step<number> {
    const valueEndIndex = this.findPropertyValueEnd(valueRange);
    if (valueEndIndex === parserFailureSentinel) {
      return {success: false};
    }
    try {
      JSON5.parse(this.raw.slice(valueRange.startIndex, valueEndIndex));
    } catch {
      return {success: false};
    }
    return {success: true, value: valueEndIndex};
  }

  private readAfterValue(
    range: ParseRange,
    valueEndIndex: number
  ): Step<{afterValueIndex: number; hasTrailingComma: boolean; nextCursor: number}> {
    const afterValueIndex = this.skipWhitespaceAndComments({startIndex: valueEndIndex, limitIndex: range.limitIndex});
    if (afterValueIndex === parserFailureSentinel) {
      return {success: false};
    }
    const hasTrailingComma = this.raw[afterValueIndex] === ',';
    return {
      success: true,
      value: {
        afterValueIndex,
        hasTrailingComma,
        nextCursor: hasTrailingComma ? afterValueIndex + 1 : afterValueIndex
      }
    };
  }

  private parseSingleProperty(range: ParseRange): {property: Json5ObjectProperty; nextCursor: number} | null {
    const parsedKey = this.parseObjectKey(range);
    if (!parsedKey) return null;

    const colonIndexStep = this.readColonIndexAfterKey(range, parsedKey.endIndex);
    if (!colonIndexStep.success) return null;

    const valueStartIndexStep = this.readValueStartIndexAfterColon(range, colonIndexStep.value);
    if (!valueStartIndexStep.success) return null;

    const valueEndIndexStep = this.computeValueEndIndex({
      startIndex: valueStartIndexStep.value,
      limitIndex: range.limitIndex
    });
    if (!valueEndIndexStep.success) return null;

    const afterValueStep = this.readAfterValue(range, valueEndIndexStep.value);
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
  }

  private processObjectComma(
    cursor: IndexCursor,
    limitIndex: number,
    listState: PropertyListState
  ): {success: false} | {success: true; nextCursor: number; newState: PropertyListState} {
    if (!listState.hasParsedProperty || listState.lastTokenWasComma) {
      return {success: false};
    }
    const nextCursor = this.skipWhitespaceAndComments({startIndex: cursor.index + 1, limitIndex});
    if (nextCursor === parserFailureSentinel) {
      return {success: false};
    }
    return {success: true, nextCursor, newState: {...listState, lastTokenWasComma: true}};
  }

  private processObjectProperty(
    cursor: IndexCursor,
    limitIndex: number,
    listState: PropertyListState
  ):
    | {success: false}
    | {success: true; nextCursor: number; property: Json5ObjectProperty; newState: PropertyListState} {
    if (listState.hasParsedProperty && !listState.lastTokenWasComma) {
      return {success: false};
    }
    const parsedProperty = this.parseSingleProperty({startIndex: cursor.index, limitIndex});
    if (!parsedProperty) {
      return {success: false};
    }
    const nextCursor = this.skipWhitespaceAndComments({
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
    let listState: PropertyListState = {hasParsedProperty: false, lastTokenWasComma: false};

    while (cursor < objectRange.closeBraceIndex) {
      if (this.raw[cursor] === ',') {
        const result = this.processObjectComma({index: cursor}, objectRange.closeBraceIndex, listState);
        if (!result.success) return null;
        cursor = result.nextCursor;
        listState = result.newState;
        continue;
      }

      const result = this.processObjectProperty({index: cursor}, objectRange.closeBraceIndex, listState);
      if (!result.success) return null;
      properties.push(result.property);
      listState = result.newState;
      cursor = result.nextCursor;
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
  public getObjectProperty(objectRange: Json5ObjectRange, key: PropertyKey | string): Json5ObjectProperty | null {
    const keyStr = toKeyString(key);
    const properties = this.parseObjectProperties(objectRange);
    if (!properties) {
      return null;
    }
    return properties.find((property) => property.key === keyStr) ?? null;
  }

  /** Resolves an object value range for a previously parsed property value. */
  public getObjectRangeForProperty(property: Json5ObjectProperty): Json5ObjectRange | null {
    const valueStart = this.skipWhitespaceAndComments({
      startIndex: property.valueStartIndex,
      limitIndex: property.valueEndIndex
    });
    if (valueStart === parserFailureSentinel) {
      return null;
    }
    if (this.raw[valueStart] !== '{') {
      return null;
    }
    const closeBraceIndex = this.findMatchingClosingBrace({index: valueStart});
    if (closeBraceIndex === -1 || closeBraceIndex > property.valueEndIndex) {
      return null;
    }
    return {openBraceIndex: valueStart, closeBraceIndex};
  }
}
