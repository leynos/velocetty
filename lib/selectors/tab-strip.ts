/**
 * @file Selectors for the ordered tab strip and the active surface.
 *
 * The strip is the only place that decides what a tab is and which one is
 * active. Terminal tabs come first in root-group order; the singleton settings
 * tab is appended when open. Exactly one entry is active: while the settings
 * surface owns input, every terminal tab reports inactive.
 */

import {SETTINGS_TAB_UID} from '@shared/constants/settings-tab';

import {getRootGroups} from '../selectors';

import type {HyperState, ITab} from '../../typings/hyper';

/** Which surface currently receives input. */
export type ActiveSurface = {readonly kind: 'settings'} | {readonly kind: 'terminal'; readonly uid: string | null};

const terminalTabs = (state: HyperState): ITab[] => {
  const {sessions} = state.sessions;
  const {activeSessions, activeRootGroup} = state.termGroups;
  const activityMarkers = state.ui.activityMarkers;
  const isSettingsActive = state.settingsTab.isActive;
  return getRootGroups(state).map((group): ITab => {
    const session = sessions[activeSessions[group.uid]];
    return {
      uid: group.uid,
      title: session?.title ?? '',
      isActive: !isSettingsActive && group.uid === activeRootGroup,
      hasActivity: session ? (activityMarkers[session.uid] ?? false) : false,
      tabType: 'terminal'
    };
  });
};

const settingsTab = (state: HyperState): ITab[] =>
  state.settingsTab.isOpen
    ? [
        {
          uid: SETTINGS_TAB_UID,
          // Translated by the header, which may call hooks; selectors may not.
          title: 'Settings',
          isActive: state.settingsTab.isActive,
          hasActivity: false,
          tabType: 'settings'
        }
      ]
    : [];

/**
 * Returns the ordered tab strip.
 *
 * @param state - The renderer state.
 * @returns Terminal tabs in group order, then the settings tab when open.
 *
 * @example
 * selectTabStrip(state).at(-1)?.tabType; // 'settings' when it is open
 */
export const selectTabStrip = (state: HyperState): ITab[] => [...terminalTabs(state), ...settingsTab(state)];

/**
 * Reports which surface receives input.
 *
 * @param state - The renderer state.
 * @returns The settings surface, or the active terminal with its group uid.
 *
 * @example
 * selectActiveSurface(state).kind; // 'terminal'
 */
export const selectActiveSurface = (state: HyperState): ActiveSurface =>
  state.settingsTab.isActive ? {kind: 'settings'} : {kind: 'terminal', uid: state.termGroups.activeRootGroup ?? null};
