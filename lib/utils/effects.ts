import type {Dispatch, Middleware} from 'redux';

import type {HyperActions, HyperState} from '../../typings/hyper';
/**
 * Simple redux middleware that executes
 * the `effect` field if provided in an action
 * since this is preceded by the `plugins`
 * middleware. It allows authors to interrupt,
 * defer or add to existing side effects at will
 * as the result of an action being triggered.
 */
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
