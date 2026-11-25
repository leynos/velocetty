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

import {SETTINGS_TAB_UID} from '@shared/constants/settings-tab';

import type {HyperState, HyperDispatch, ITab} from '../../typings/hyper';
import {closeTab, changeTab, maximize, openHamburgerMenu, unmaximize, minimize, close} from '../actions/header';
import {requestTermGroup} from '../actions/term-groups';
import Header from '../components/header';
import {useTranslation} from '../hooks/use-translation';
import {selectTabStrip} from '../selectors/tab-strip';
import {connect} from '../utils/plugins';

const isMac = /Mac/.test(navigator.userAgent);

const getTabs = (state: HyperState): ITab[] => selectTabStrip(state);

const mapStateToProps = (state: HyperState) => {
  return {
    // active is an index
    isMac,
    tabs: getTabs(state),
    activeMarkers: state.ui.activityMarkers,
    borderColor: state.ui.borderColor,
    backgroundColor: state.ui.backgroundColor,
    maximized: state.ui.maximized,
    fullScreen: state.ui.fullScreen,
    showHamburgerMenu: state.ui.showHamburgerMenu,
    showWindowControls: state.ui.showWindowControls,
    defaultProfile: state.ui.defaultProfile,
    profiles: state.ui.profiles
  };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    onCloseTab: (i: string) => {
      dispatch(closeTab(i));
    },

    onChangeTab: (i: string) => {
      dispatch(changeTab(i));
    },

    maximize: () => {
      dispatch(maximize());
    },

    unmaximize: () => {
      dispatch(unmaximize());
    },

    openHamburgerMenu: (coordinates: {x: number; y: number}) => {
      dispatch(openHamburgerMenu(coordinates));
    },

    minimize: () => {
      dispatch(minimize());
    },

    close: () => {
      dispatch(close());
    },

    openNewTab: (profile: string) => {
      dispatch(requestTermGroup({profile}));
    }
  };
};

export const HeaderWithTranslation = (props: HeaderConnectedProps) => {
  const t = useTranslation();
  // Selectors cannot call hooks, so the settings tab's title is translated
  // here rather than in `selectTabStrip`.
  const tabs = props.tabs.map((tab) => (tab.uid === SETTINGS_TAB_UID ? {...tab, title: t('settingsTab')} : tab));

  return React.createElement(Header, {
    ...props,
    tabs,
    openMenuAria: t('openMenu'),
    minimizeWindowAria: t('minimizeWindow'),
    maximizeWindowAria: t('maximizeWindow'),
    restoreWindowAria: t('restoreWindow'),
    closeWindowAria: t('closeWindow')
  });
};

export const HeaderContainer = connect(mapStateToProps, mapDispatchToProps, null)(HeaderWithTranslation, 'Header');

export type HeaderConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
