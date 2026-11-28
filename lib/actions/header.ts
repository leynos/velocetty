/**
 * @file Header action creators for tab selection, window controls, and the menu.
 *
 * Tab activation routes through `activateTab` in `lib/actions/tab-strip.ts`, so
 * the settings tab is selected exactly like a terminal tab without this module
 * knowing which kind of tab a uid names.
 */
import {SETTINGS_TAB_UID} from '@shared/constants/settings-tab';
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

import {activateTab, closeSettingsTab} from './tab-strip';
import {userExitTermGroup} from './term-groups';

export function closeTab(uid: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: CLOSE_TAB,
      uid,
      effect() {
        if (uid === SETTINGS_TAB_UID) {
          dispatch(closeSettingsTab());
          return;
        }
        dispatch(userExitTermGroup(uid));
      }
    });
  };
}

export function changeTab(uid: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: CHANGE_TAB,
      uid,
      effect() {
        // `activateTab` owns the "which kind of tab is this" decision, so the
        // header cannot drift from the strip's other entry points.
        dispatch(activateTab(uid));
      }
    });
  };
}

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
