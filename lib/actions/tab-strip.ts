/**
 * @file Actions that operate on either kind of tab.
 *
 * `activateTab` is the one way to change the active tab: it routes the
 * settings uid to the settings slice and every other uid to the terminal
 * group action, so no caller has to know which kind a uid names.
 */

import {
  SETTINGS_TAB_ACTIVATE,
  SETTINGS_TAB_CLOSE,
  SETTINGS_TAB_OPEN,
  SETTINGS_TAB_UID
} from '@shared/constants/settings-tab';

import {setActiveGroup} from './term-groups';

import type {HyperDispatch} from '../../typings/hyper';

/** Opens the settings tab and makes it active. */
export const openSettingsTab = () => ({type: SETTINGS_TAB_OPEN});

/** Closes the settings tab. */
export const closeSettingsTab = () => ({type: SETTINGS_TAB_CLOSE});

/** Makes the settings tab the active surface. */
export const activateSettingsTab = () => ({type: SETTINGS_TAB_ACTIVATE});

/**
 * Activating a tab by uid, whichever kind it is.
 *
 * @param uid - A terminal group uid or the settings tab uid.
 * @returns A thunk that performs the activation.
 *
 * @example
 * dispatch(activateTab(SETTINGS_TAB_UID));
 */
export const activateTab = (uid: string) => (dispatch: HyperDispatch) => {
  if (uid === SETTINGS_TAB_UID) {
    dispatch({type: SETTINGS_TAB_ACTIVATE});
    return;
  }
  dispatch(setActiveGroup(uid));
};
