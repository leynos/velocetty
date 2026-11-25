/**
 * @file Reducer for the singleton settings tab.
 *
 * The slice holds whether the tab is open, whether it owns the active surface,
 * and the search state. Any terminal activation closes the active surface, so
 * the tab strip's "exactly one active tab" rule holds without every caller
 * remembering to deactivate.
 */

import {
  SETTINGS_CATEGORY_SELECT,
  SETTINGS_QUERY_SET,
  SETTINGS_TAB_ACTIVATE,
  SETTINGS_TAB_CLOSE,
  SETTINGS_TAB_DEACTIVATE,
  SETTINGS_TAB_OPEN,
  type SettingsTabActions,
  type SettingsTabState
} from '@shared/constants/settings-tab';
import {SESSION_ADD, SESSION_SET_ACTIVE} from '@shared/constants/sessions';

import type {HyperActions} from '../../typings/hyper';

const initialState: SettingsTabState = {
  isOpen: false,
  isActive: false,
  query: '',
  selectedCategory: 'all'
};

const isSettingsTabAction = (action: HyperActions): action is SettingsTabActions =>
  action.type === SETTINGS_TAB_OPEN ||
  action.type === SETTINGS_TAB_CLOSE ||
  action.type === SETTINGS_TAB_ACTIVATE ||
  action.type === SETTINGS_TAB_DEACTIVATE ||
  action.type === SETTINGS_QUERY_SET ||
  action.type === SETTINGS_CATEGORY_SELECT;

const reduceSettingsTab = (state: SettingsTabState, action: SettingsTabActions): SettingsTabState => {
  switch (action.type) {
    case SETTINGS_TAB_OPEN: {
      return {...state, isOpen: true, isActive: true};
    }
    case SETTINGS_TAB_CLOSE: {
      return initialState;
    }
    case SETTINGS_TAB_ACTIVATE: {
      return state.isOpen ? {...state, isActive: true} : state;
    }
    case SETTINGS_TAB_DEACTIVATE: {
      return state.isActive ? {...state, isActive: false} : state;
    }
    case SETTINGS_QUERY_SET: {
      return {...state, query: action.query};
    }
    case SETTINGS_CATEGORY_SELECT: {
      return {...state, selectedCategory: action.category};
    }
  }
};

export default function settingsTab(state: SettingsTabState = initialState, action: HyperActions): SettingsTabState {
  if (isSettingsTabAction(action)) {
    return reduceSettingsTab(state, action);
  }
  // A terminal becoming active takes the surface back; the tab stays open.
  if (action.type === SESSION_ADD || action.type === SESSION_SET_ACTIVE) {
    return state.isActive ? {...state, isActive: false} : state;
  }
  return state;
}
