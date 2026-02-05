/**
 * @file Redux middleware that writes PTY data directly to terminal instances.
 *
 * Responsibilities:
 * - Intercept `SESSION_PTY_DATA` actions and write data to the corresponding
 *   terminal instance for performance (bypassing React reconciliation).
 *
 * Usage:
 * - Include in the middleware chain via `applyMiddleware`.
 */
import type {Dispatch, Middleware} from 'redux';

import type {HyperActions, HyperState} from '../../typings/hyper';
import terms from '../terms';

// the only side effect we perform from middleware
// is to write to the react term instance directly
// to avoid a performance hit
type SessionPtyDataAction = HyperActions & {type: 'SESSION_PTY_DATA'; uid: string; data: string};

const isSessionPtyDataAction = (action: unknown): action is SessionPtyDataAction => {
  if (typeof action !== 'object' || action === null) {
    return false;
  }
  const maybeAction = action as Partial<SessionPtyDataAction>;
  return (
    maybeAction.type === 'SESSION_PTY_DATA' &&
    typeof maybeAction.uid === 'string' &&
    typeof maybeAction.data === 'string'
  );
};

const writeMiddleware: Middleware<{}, HyperState, Dispatch<HyperActions>> = () => (next) => (action) => {
  if (isSessionPtyDataAction(action)) {
    const term = terms[action.uid];
    if (term) {
      term.term.write(action.data);
    }
  }
  return next(action);
};

export default writeMiddleware;
