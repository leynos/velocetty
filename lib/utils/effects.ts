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
type EffectAction = HyperActions & {effect?: () => void};

const hasEffect = (action: unknown): action is EffectAction => {
  if (typeof action !== 'object' || action === null) {
    return false;
  }
  return 'effect' in action;
};

const effectsMiddleware: Middleware<{}, HyperState, Dispatch<HyperActions>> = () => (next) => (action) => {
  const ret = next(action);
  if (hasEffect(action) && typeof action.effect === 'function') {
    action.effect();
    delete action.effect;
  }
  return ret;
};
export default effectsMiddleware;
