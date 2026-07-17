/**
 * @file Connects the header view to renderer state, header actions, and
 * translation-backed accessibility labels.
 *
 * Responsibilities:
 * - Select tab, activity, chrome, and profile state for the header UI.
 * - Bind header interactions to actions such as `closeTab`, `changeTab`,
 *   `maximize`, `unmaximize`, `minimize`, `close`,
 *   `openHamburgerMenu`, and `requestTermGroup`.
 * - Inject translated aria labels via `useTranslation` before exporting the
 *   connected `HeaderContainer`.
 *
 * Usage:
 * - Imported by the renderer container tree where the connected header chrome
 *   is required.
 */
import React from 'react';
import {createSelector} from 'reselect';

import type {HyperState, HyperDispatch, ITab} from '../../typings/hyper';
import {closeTab, changeTab, maximize, openHamburgerMenu, unmaximize, minimize, close} from '../actions/header';
import {requestTermGroup} from '../actions/term-groups';
import Header from '../components/header';
import {useTranslation} from '../hooks/use-translation';
import {getRootGroups} from '../selectors';
import {connect} from '../utils/plugins';

const isMac = /Mac/.test(navigator.userAgent);

const getSessions = ({sessions}: HyperState) => sessions.sessions;
const getActiveRootGroup = ({termGroups}: HyperState) => termGroups.activeRootGroup;
const getActiveSessions = ({termGroups}: HyperState) => termGroups.activeSessions;
const getActivityMarkers = ({ui}: HyperState) => ui.activityMarkers;
const getTabs = createSelector(
  [getSessions, getRootGroups, getActiveSessions, getActiveRootGroup, getActivityMarkers],
  (sessions, rootGroups, activeSessions, activeRootGroup, activityMarkers) =>
    rootGroups.map((t): ITab => {
      const activeSessionUid = activeSessions[t.uid];
      const session = sessions[activeSessionUid];
      return {
        uid: t.uid,
        title: session.title,
        isActive: t.uid === activeRootGroup,
        hasActivity: activityMarkers[session.uid]
      };
    })
);

const mapStateToProps = (state: HyperState) => {
  return {
    // active is an index
    /** Whether the renderer is running on macOS, so chrome can match platform conventions. */
    isMac,
    /** Memoized tab list, including activity and active-state flags, for the tab strip. */
    tabs: getTabs(state),
    /** Raw activity markers keyed by session, used to badge tabs with pending output. */
    activeMarkers: state.ui.activityMarkers,
    /** Window border colour, sourced from the active theme/config. */
    borderColor: state.ui.borderColor,
    /** Header background colour, sourced from the active theme/config. */
    backgroundColor: state.ui.backgroundColor,
    /** Whether the window is currently maximized, to pick the correct restore control. */
    maximized: state.ui.maximized,
    /** Whether the window is in fullscreen, which hides the native window controls. */
    fullScreen: state.ui.fullScreen,
    /** Whether the hamburger menu control should be shown in the header. */
    showHamburgerMenu: state.ui.showHamburgerMenu,
    /** Whether native-style window controls (minimize/maximize/close) should be shown. */
    showWindowControls: state.ui.showWindowControls,
    /** Id of the shell profile used when a new tab is opened without an explicit choice. */
    defaultProfile: state.ui.defaultProfile,
    /** Shell profiles offered in the new-tab menu. */
    profiles: state.ui.profiles
  };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    /** Closes the tab with the given uid. */
    onCloseTab: (i: string) => {
      dispatch(closeTab(i));
    },

    /** Makes the tab with the given uid active. */
    onChangeTab: (i: string) => {
      dispatch(changeTab(i));
    },

    /** Maximizes the application window. */
    maximize: () => {
      dispatch(maximize());
    },

    /** Restores the application window from a maximized state. */
    unmaximize: () => {
      dispatch(unmaximize());
    },

    /** Opens the hamburger menu at the given screen coordinates. */
    openHamburgerMenu: (coordinates: {x: number; y: number}) => {
      dispatch(openHamburgerMenu(coordinates));
    },

    /** Minimizes the application window. */
    minimize: () => {
      dispatch(minimize());
    },

    /** Closes the application window. */
    close: () => {
      dispatch(close());
    },

    /** Opens a new tab using the given shell profile. */
    openNewTab: (profile: string) => {
      dispatch(requestTermGroup({profile}));
    }
  };
};

/** Header component with translated aria labels applied to its window controls. */
export const HeaderWithTranslation = (props: HeaderConnectedProps) => {
  const t = useTranslation();

  return React.createElement(Header, {
    ...props,
    openMenuAria: t('openMenu'),
    minimizeWindowAria: t('minimizeWindow'),
    maximizeWindowAria: t('maximizeWindow'),
    restoreWindowAria: t('restoreWindow'),
    closeWindowAria: t('closeWindow')
  });
};

/** Header chrome connected to renderer state and header actions. */
export const HeaderContainer = connect(mapStateToProps, mapDispatchToProps, null)(HeaderWithTranslation, 'Header');

/** Props supplied to the header by `connect`, combining state selections and dispatch bindings. */
export type HeaderConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
