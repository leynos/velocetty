import {INIT} from '@shared/constants';
import type {HyperDispatch} from '../../typings/hyper';
import {transport} from '../transport/electron-ipc-transport';

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
