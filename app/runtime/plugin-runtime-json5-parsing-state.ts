/** @file Parsing state helpers for JSON5 object traversal. */

export type ParsingState = {
  inString: '"' | "'" | null;
  isEscaped: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
  depth: number;
};

type StateTransition = {state: ParsingState; skipNext: boolean; foundClose: boolean};

export const processLineComment = (state: ParsingState, current: string): ParsingState => ({
  ...state,
  inLineComment: current !== '\n'
});

export const processBlockComment = (
  state: ParsingState,
  current: string,
  next: string
): {state: ParsingState; skipNext: boolean} =>
  current === '*' && next === '/'
    ? {state: {...state, inBlockComment: false}, skipNext: true}
    : {state, skipNext: false};

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
  const depth = state.depth - 1;
  return {state: {...state, depth}, skipNext: false, foundClose: depth === 0};
};

export const processDelimitersAndComments = (state: ParsingState, current: string, next: string): StateTransition =>
  handleLineCommentStart(state, current, next) ??
  handleBlockCommentStart(state, current, next) ??
  handleStringDelimiter(state, current) ??
  handleOpeningBrace(state, current) ??
  handleClosingBrace(state, current) ?? {state, skipNext: false, foundClose: false};
