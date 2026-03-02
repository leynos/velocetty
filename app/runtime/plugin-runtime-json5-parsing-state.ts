/** @file Parsing state helpers for JSON5 object traversal. */

export type ParsingState = {
  inString: '"' | "'" | null;
  isEscaped: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
  depth: number;
};

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

export const processDelimitersAndComments = (
  state: ParsingState,
  current: string,
  next: string
): {state: ParsingState; skipNext: boolean; foundClose: boolean} => {
  if (current === '/' && next === '/') {
    return {state: {...state, inLineComment: true}, skipNext: true, foundClose: false};
  }
  if (current === '/' && next === '*') {
    return {state: {...state, inBlockComment: true}, skipNext: true, foundClose: false};
  }
  if (current === '"' || current === "'") {
    return {state: {...state, inString: current}, skipNext: false, foundClose: false};
  }
  if (current === '{') {
    return {state: {...state, depth: state.depth + 1}, skipNext: false, foundClose: false};
  }
  if (current === '}') {
    const depth = state.depth - 1;
    return {state: {...state, depth}, skipNext: false, foundClose: depth === 0};
  }
  return {state, skipNext: false, foundClose: false};
};
