/**
 * @file Character predicates and shared constants for JSON5 scanning.
 *
 * Responsibilities:
 * - recognise JSON5 whitespace, line terminators, and identifier characters.
 * - provide the failure sentinel shared by scanner steps.
 *
 * Invariants:
 * - predicates inspect a single character and never mutate scanner state.
 *
 * Cross-links:
 * - `lexer.ts` for comment and string scanning that consumes these predicates.
 * - `parsing-state.ts` for the initial lexical state factory.
 */
import type {ParsingState} from './parsing-state';

/** Sentinel returned when a scan cannot make progress. */
export const parserFailureSentinel = -1;

const unicodeSpaceSeparatorPattern = /^\p{Zs}$/u;

/** Characters that cannot begin a property value. */
export const NON_VALUE_START_CHARS = new Set([',', '}', ']']);

/** Creates the lexical state used at the start of a scan. */
export const createInitialParsingState = (): ParsingState => ({
  depth: 0,
  inString: null,
  isEscaped: false,
  inLineComment: false,
  inBlockComment: false
});

/** Returns true when `character` is whitespace for JSON5 scanning. */
export const isWhitespaceCharacter = (character: string): boolean =>
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

/** Returns true when `character` is leading indentation (spaces or tabs). */
export const isIndentationWhitespace = (character: string): boolean => character === ' ' || character === '\t';

/** Returns true when `character` terminates a JSON5 line. */
export const isLineTerminator = (character: string): boolean =>
  character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';

const identifierStartPattern = /[$_\p{ID_Start}]/u;
const identifierContinuePattern = /(?:[$_\p{ID_Continue}]|\u200C|\u200D)/u;

/** Returns true when `character` can appear in an unquoted identifier key. */
export const isIdentifierCharacter = (character: string, isStart: boolean): boolean =>
  (isStart ? identifierStartPattern : identifierContinuePattern).test(character);
