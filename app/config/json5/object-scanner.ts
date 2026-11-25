/**
 * @file Object- and value-boundary scanning for JSON5 documents.
 *
 * Responsibilities:
 * - find the closing brace that matches an opening brace.
 * - find the end of a property value while tracking strings and comments.
 * - track bracket depth so arrays inside values do not terminate early.
 *
 * Invariants:
 * - scanning never mutates the source document.
 * - unbalanced brackets or unterminated comments yield
 *   `parserFailureSentinel`.
 *
 * Cross-links:
 * - `characters.ts` for character predicates and the initial lexical state.
 * - `parsing-state.ts` for lexical state transitions.
 * - `parser.ts` for the public API that consumes these scans.
 */
import {createInitialParsingState, parserFailureSentinel} from './characters';
import {
  processBlockComment,
  processDelimitersAndComments,
  processLineComment,
  processStringContext,
  type ParsingState
} from './parsing-state';
import type {IndexCursor, ParseRange} from './types';

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

/** The state and cursor after applying a block-comment scan. */
type BlockCommentApplication = {state: ParsingState; nextIndex: number};

/** The state, cursor, and early-return decision after a delimiter scan. */
type DelimiterApplication = {
  state: ParsingState;
  nextIndex: number;
  shouldReturn: boolean;
  returnValue: number;
};

/** The bracket depth after a character, and whether it underflowed. */
type BracketDepthUpdate = {newDepth: number; isInvalid: boolean};

const applyBlockCommentResult = (
  result: {state: ParsingState; skipNext: boolean},
  cursor: IndexCursor
): BlockCommentApplication => ({
  state: result.state,
  nextIndex: cursor.index + (result.skipNext ? 1 : 0)
});

const applyDelimiterResult = (
  result: {state: ParsingState; skipNext: boolean; foundClose: boolean},
  cursor: IndexCursor
): DelimiterApplication => ({
  state: result.state,
  nextIndex: cursor.index + (result.skipNext ? 1 : 0),
  shouldReturn: result.foundClose,
  returnValue: cursor.index
});

/** Finds the brace that closes `cursor.index`, or `-1` when unmatched. */
export const findMatchingClosingBrace = (raw: string, cursor: IndexCursor): number => {
  if (raw[cursor.index] !== '{') {
    return -1;
  }

  let state = createInitialParsingState();

  for (let index = cursor.index; index < raw.length; index += 1) {
    const current = raw[index];
    const next = raw[index + 1];

    if (state.inLineComment) {
      state = processLineComment(state, current);
      continue;
    }
    if (state.inBlockComment) {
      const appliedBlockCommentResult = applyBlockCommentResult(processBlockComment(state, current, next), {
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

    const appliedDelimiterResult = applyDelimiterResult(processDelimitersAndComments(state, current, next), {
      index
    });
    state = appliedDelimiterResult.state;
    index = appliedDelimiterResult.nextIndex;
    if (appliedDelimiterResult.shouldReturn) return appliedDelimiterResult.returnValue;
  }

  return -1;
};

const isAtTopLevel = (state: ParsingState, bracketDepth: number): boolean => state.depth === 0 && bracketDepth === 0;

const isValueTerminator = (current: string, state: ParsingState, bracketDepth: number): boolean => {
  const atTopLevel = isAtTopLevel(state, bracketDepth);
  const isClosingBrace = current === '}';
  const isComma = current === ',';
  return atTopLevel && (isClosingBrace || isComma);
};

const updateBracketDepth = (current: string, bracketDepth: number): number => {
  if (current === '[') {
    return bracketDepth + 1;
  }
  if (current === ']') {
    return bracketDepth - 1;
  }
  return bracketDepth;
};

const updateBracketDepthWithValidation = (current: string, currentDepth: number): BracketDepthUpdate => {
  const newDepth = updateBracketDepth(current, currentDepth);
  return {
    newDepth,
    isInvalid: current === ']' && newDepth < 0
  };
};

const isUnmatchedBraceInArrayCtx = (c: ValueEndPredicateContext): boolean => {
  const isClosingBrace = c.char.current === '}';
  const inArray = c.end.bracketDepth > 0;
  const atObjectTopLevel = c.end.state.depth === 0;
  return isClosingBrace && inArray && atObjectTopLevel && !c.delimiter.foundClose;
};

const processValueEndCharacter = (
  ctx: CharacterContext,
  state: ParsingState,
  bracketDepth: number
): ValueEndCharacterResult => {
  if (isValueTerminator(ctx.current, state, bracketDepth)) {
    return {
      state,
      nextIndex: ctx.index,
      bracketDepth,
      shouldTerminate: true,
      isInvalid: false
    };
  }

  const bracketUpdate = updateBracketDepthWithValidation(ctx.current, bracketDepth);
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
  if (isUnmatchedBraceInArrayCtx(checkCtx)) {
    return {
      state,
      nextIndex: ctx.index,
      bracketDepth,
      shouldTerminate: false,
      isInvalid: true
    };
  }

  const applied = applyBlockCommentResult(delimiterResult, {index: ctx.index});
  return {
    state: applied.state,
    nextIndex: applied.nextIndex,
    bracketDepth,
    shouldTerminate: false,
    isInvalid: false
  };
};

const hasBalancedDepth = (context: ValueEndContext): boolean => context.state.depth === 0 && context.bracketDepth === 0;

const isRootLexicalState = (state: ParsingState): boolean =>
  state.inString === null && !state.isEscaped && !state.inLineComment && !state.inBlockComment;

const isCleanParseEnd = (context: ValueEndContext): boolean =>
  hasBalancedDepth(context) && isRootLexicalState(context.state);

const advanceActiveLexicalState = ({
  context,
  current,
  next,
  index
}: LexicalCharContext): {advanced: true; context: ValueEndContext; nextIndex: number} | {advanced: false} => {
  if (context.state.inLineComment) {
    return {
      advanced: true,
      context: {...context, state: processLineComment(context.state, current)},
      nextIndex: index
    };
  }
  if (context.state.inBlockComment) {
    const appliedBlockCommentResult = applyBlockCommentResult(processBlockComment(context.state, current, next ?? ''), {
      index
    });
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
};

/** Finds where a property value ends, or `parserFailureSentinel` on failure. */
export const findPropertyValueEnd = (raw: string, range: ParseRange): number => {
  let context: ValueEndContext = {
    state: createInitialParsingState(),
    bracketDepth: 0
  };

  for (let index = range.startIndex; index < range.limitIndex; index += 1) {
    const current = raw[index];
    const next = raw[index + 1];

    const step = advanceActiveLexicalState({context, current, next, index});
    if (step.advanced) {
      context = step.context;
      index = step.nextIndex;
      continue;
    }

    const result = processValueEndCharacter({current, next, index}, context.state, context.bracketDepth);
    if (result.shouldTerminate) return index;
    if (result.isInvalid) return parserFailureSentinel;
    context = {state: result.state, bracketDepth: result.bracketDepth};
    index = result.nextIndex;
  }

  return isCleanParseEnd(context) ? range.limitIndex : parserFailureSentinel;
};
