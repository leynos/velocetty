import {CLOSE_TAB, CHANGE_TAB} from '@shared/constants/tabs';
import {
  UI_WINDOW_MAXIMIZE,
  UI_WINDOW_UNMAXIMIZE,
  UI_OPEN_HAMBURGER_MENU,
  UI_WINDOW_MINIMIZE,
  UI_WINDOW_CLOSE
} from '@shared/constants/ui';
import type {HyperDispatch} from '../../typings/hyper';
import {transport} from '../transport';

import {userExitTermGroup, setActiveGroup} from './term-groups';

/** Requests that the given tab be closed and its term group exited. */
export function closeTab(uid: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: CLOSE_TAB,
      uid,
      effect() {
        dispatch(userExitTermGroup(uid));
      }
    });
  };
}

/** Requests that the given tab become the active tab. */
export function changeTab(uid: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: CHANGE_TAB,
      uid,
      effect() {
        dispatch(setActiveGroup(uid));
      }
    });
  };
}

/** Requests that the main process maximize the application window. */
export function maximize() {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_WINDOW_MAXIMIZE,
      effect() {
        transport.emit('maximize');
      }
    });
  };
}

/** Requests that the main process restore the window from its maximized state. */
export function unmaximize() {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_WINDOW_UNMAXIMIZE,
      effect() {
        transport.emit('unmaximize');
      }
    });
  };
}

/** Requests that the main process open the hamburger menu at the given screen coordinates. */
export function openHamburgerMenu(coordinates: {x: number; y: number}) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_OPEN_HAMBURGER_MENU,
      effect() {
        transport.emit('open hamburger menu', coordinates);
      }
    });
  };
}

/** Requests that the main process minimize the application window. */
export function minimize() {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_WINDOW_MINIMIZE,
      effect() {
        transport.emit('minimize');
      }
    });
  };
}

/** Requests that the main process close the application window. */
export function close() {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_WINDOW_CLOSE,
      effect() {
        transport.emit('close');
      }
    });
  };
}
