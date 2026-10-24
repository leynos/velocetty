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
import {isNumber, isObject, isString} from '@shared/types/guards';
import terms from '../terms';

/**
 * Narrows an action to one carrying PTY output for a session.
 *
 * Each `in` check is load-bearing: `isObject` narrows to `object`, which has no
 * index signature, and only the check for a field lets the read that follows be
 * an ordinary property access. The field values are decoded by the shared
 * boundary guards, so this predicate is the single place the action's shape
 * contract is established.
 */
const isSessionPtyDataAction = (action: unknown): action is SessionPtyDataAction =>
  isObject(action) &&
  'type' in action &&
  action.type === 'SESSION_PTY_DATA' &&
  'uid' in action &&
  isString(action.uid) &&
  'data' in action &&
  isString(action.data) &&
  'now' in action &&
  isNumber(action.now);

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
