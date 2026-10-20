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
import {isObject} from '@shared/types/guards';
import terms from '../terms';

const isSessionPtyDataAction = (action: unknown): action is SessionPtyDataAction => {
  if (!isObject(action)) {
    return false;
  }
  if (!('type' in action) || !('uid' in action) || !('data' in action) || !('now' in action)) {
    return false;
  }
  return (
    action.type === 'SESSION_PTY_DATA' &&
    typeof action.uid === 'string' &&
    typeof action.data === 'string' &&
    typeof action.now === 'number'
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
