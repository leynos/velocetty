/** @file Parsing state helpers for JSON5 object traversal. */

/**
 * Tracks parser context while scanning JSON5 object content.
 *
 * `inString` captures the active quote delimiter when inside a string.
 * `isEscaped` tracks whether the previous character was an escape.
 * `inLineComment` and `inBlockComment` mark comment parsing modes.
 * `depth` tracks nested object brace depth.
 */
export type ParsingState = {
  inString: '"' | "'" | null;
  isEscaped: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
  depth: number;
};

type StateTransition = {state: ParsingState; skipNext: boolean; foundClose: boolean};

/**
 * Advances line-comment parsing state for the current character.
 *
 * @param state Current parser state.
 * @param current Current character under inspection.
 * @returns Updated parser state with `inLineComment` disabled on JSON5 line terminators.
 */
export const processLineComment = (state: ParsingState, current: string): ParsingState => ({
  ...state,
  inLineComment: current !== '\n' && current !== '\r' && current !== '\u2028' && current !== '\u2029'
});

/**
 * Advances block-comment parsing state for the current and next characters.
 *
 * @param state Current parser state.
 * @param current Current character under inspection.
 * @param next Next character in the source text.
 * @returns Updated state and whether the caller should skip the next character.
 */
export const processBlockComment = (
  state: ParsingState,
  current: string,
  next: string
): {state: ParsingState; skipNext: boolean} =>
  current === '*' && next === '/'
    ? {state: {...state, inBlockComment: false}, skipNext: true}
    : {state, skipNext: false};

/**
 * Advances string parsing state for the current character.
 *
 * @param state Current parser state.
 * @param current Current character under inspection.
 * @returns Updated parser state with escape and string delimiter handling applied.
 */
export const processStringContext = (state: ParsingState, current: string): ParsingState => {
  if (state.isEscaped) return {...state, isEscaped: false};
  if (current === '\\') return {...state, isEscaped: true};
  if (current === state.inString) return {...state, inString: null};
  return state;
};

const handleLineCommentStart = (state: ParsingState, current: string, next: string): StateTransition | null =>
  current === '/' && next === '/' ? {state: {...state, inLineComment: true}, skipNext: true, foundClose: false} : null;

const handleBlockCommentStart = (state: ParsingState, current: string, next: string): StateTransition | null =>
  current === '/' && next === '*' ? {state: {...state, inBlockComment: true}, skipNext: true, foundClose: false} : null;

const handleStringDelimiter = (state: ParsingState, current: string): StateTransition | null =>
  current === '"' || current === "'"
    ? {state: {...state, inString: current}, skipNext: false, foundClose: false}
    : null;

const handleOpeningBrace = (state: ParsingState, current: string): StateTransition | null =>
  current === '{' ? {state: {...state, depth: state.depth + 1}, skipNext: false, foundClose: false} : null;

const handleClosingBrace = (state: ParsingState, current: string): StateTransition | null => {
  if (current !== '}') return null;
  const depth = Math.max(0, state.depth - 1);
  return {state: {...state, depth}, skipNext: false, foundClose: state.depth > 0 && depth === 0};
};

/**
 * Applies delimiter and comment-start transitions for non-string parser state.
 *
 * @param state Current parser state.
 * @param current Current character under inspection.
 * @param next Next character in the source text.
 * @returns Transition details containing updated state, skip hint, and close-match flag.
 */
export const processDelimitersAndComments = (state: ParsingState, current: string, next: string): StateTransition =>
  handleLineCommentStart(state, current, next) ??
  handleBlockCommentStart(state, current, next) ??
  handleStringDelimiter(state, current) ??
  handleOpeningBrace(state, current) ??
  handleClosingBrace(state, current) ?? {state, skipNext: false, foundClose: false};
