/**
 * @file Redux middleware that executes optional `effect` callbacks on actions.
 *
 * Responsibilities:
 * - Run action `effect` callbacks after the plugins middleware.
 * - Allow plugins to interrupt, defer, or augment side effects.
 *
 * Usage:
 * - Register in the Redux middleware chain after `plugins.middleware`.
 */
import type {Dispatch, Middleware} from 'redux';

import type {HyperActions, HyperState} from '../../typings/hyper';

const executedEffects = new WeakSet<object>();

const hasEffect = (action: unknown): action is HyperActions => {
  if (typeof action !== 'object' || action === null) {
    return false;
  }
  return 'effect' in action;
};

const effectsMiddleware: Middleware<{}, HyperState, Dispatch<HyperActions>> = () => (next) => (action) => {
  const ret = next(action);
  if (hasEffect(action) && typeof action.effect === 'function') {
    const actionObject = action as object;
    if (!executedEffects.has(actionObject)) {
      action.effect();
      executedEffects.add(actionObject);
    }
  }
  return ret;
};
export default effectsMiddleware;
