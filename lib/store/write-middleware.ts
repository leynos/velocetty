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

import type {SessionPtyDataAction} from '@shared/constants/sessions';
import type {HyperActions, HyperState} from '../../typings/hyper';
import terms from '../terms';

const isSessionPtyDataAction = (action: unknown): action is SessionPtyDataAction => {
  if (typeof action !== 'object' || action === null) {
    return false;
  }
  const maybeAction = action as Partial<SessionPtyDataAction>;
  return (
    maybeAction.type === 'SESSION_PTY_DATA' &&
    typeof maybeAction.uid === 'string' &&
    typeof maybeAction.data === 'string' &&
    typeof maybeAction.now === 'number'
  );
};

/** Middleware forwarding SESSION_USER_DATA writes to the active session. */
const writeMiddleware: Middleware<{}, HyperState, Dispatch<HyperActions>> = () => (next) => (action) => {
  if (isSessionPtyDataAction(action)) {
    const term = terms[action.uid];
    if (term) {
      term.term.write(action.data);
    }
  }
  return next(action);
};

/** Redux middleware writing PTY output directly to the matching terminal, bypassing React reconciliation. */
/** Middleware forwarding SESSION_USER_DATA writes to the active session. */
export default writeMiddleware;
