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

/**
 * Opens the settings tab and makes it active.
 *
 * @param options - `keepThroughInitialSession` marks a programmatic open in a
 * freshly created window: the window's initial terminal arrives as a
 * `session add` after this action, and that one add must not take the surface
 * back. A user-initiated preferences open omits it, so a later new session
 * deactivates the tab as usual.
 * @returns The open action.
 *
 * @example
 * dispatch(openSettingsTab({keepThroughInitialSession: true})); // a new window
 * dispatch(openSettingsTab()); // an existing window from Preferences…
 */
export const openSettingsTab = ({
  keepThroughInitialSession = false
}: {
  readonly keepThroughInitialSession?: boolean;
} = {}) => ({
  type: SETTINGS_TAB_OPEN,
  keepThroughInitialSession
});

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
