import {INIT} from '@shared/constants';
import type {HyperDispatch} from '../../typings/hyper';
import {transport} from '../transport';

/** Requests initial startup dispatch and signals the main process that the renderer is ready. */
export default function init() {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: INIT,
      effect: () => {
        transport.emit('init', null);
      }
    });
  };
}
