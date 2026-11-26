/**
 * @file Reducer for the singleton settings tab.
 *
 * The slice holds whether the tab is open, whether it owns the active surface,
 * and the search state. Any terminal activation closes the active surface, so
 * the tab strip's "exactly one active tab" rule holds without every caller
 * remembering to deactivate. A programmatic open in a new window asks to keep
 * the surface through that window's first `SESSION_ADD`, because the initial
 * terminal arrives after the open request; the request is consumed by that add
 * so a later new session still takes the surface back.
 */

import {
  SETTINGS_CATEGORY_SELECT,
  SETTINGS_QUERY_SET,
  SETTINGS_TAB_ACTIVATE,
  SETTINGS_TAB_CLOSE,
  SETTINGS_TAB_DEACTIVATE,
  SETTINGS_TAB_OPEN,
  type SettingsCategorySelection,
  type SettingsTabActions,
  type SettingsTabState
} from '@shared/constants/settings-tab';
import {SESSION_ADD, SESSION_SET_ACTIVE} from '@shared/constants/sessions';

import type {HyperActions} from '../../typings/hyper';

const initialState: SettingsTabState = {
  isOpen: false,
  isActive: false,
  keepThroughInitialSession: false,
  query: '',
  selectedCategory: 'all'
};

const openTab = (state: SettingsTabState, keepThroughInitialSession: boolean): SettingsTabState => ({
  ...state,
  isOpen: true,
  isActive: true,
  keepThroughInitialSession
});

const closeTab = (): SettingsTabState => initialState;

const activateTab = (state: SettingsTabState): SettingsTabState =>
  state.isOpen ? {...state, isActive: true, keepThroughInitialSession: false} : state;

const deactivateTab = (state: SettingsTabState): SettingsTabState =>
  state.isActive || state.keepThroughInitialSession
    ? {...state, isActive: false, keepThroughInitialSession: false}
    : state;

const setQuery = (state: SettingsTabState, query: string): SettingsTabState => ({...state, query});

const selectCategory = (state: SettingsTabState, category: SettingsCategorySelection): SettingsTabState => ({
  ...state,
  selectedCategory: category
});

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
      return openTab(state, action.keepThroughInitialSession === true);
    }
    case SETTINGS_TAB_CLOSE: {
      return closeTab();
    }
    case SETTINGS_TAB_ACTIVATE: {
      return activateTab(state);
    }
    case SETTINGS_TAB_DEACTIVATE: {
      return deactivateTab(state);
    }
    case SETTINGS_QUERY_SET: {
      return setQuery(state, action.query);
    }
    case SETTINGS_CATEGORY_SELECT: {
      return selectCategory(state, action.category);
    }
  }
};

/** Leaves the tab open but returns the surface to the terminal. */
const takeSurfaceBack = (state: SettingsTabState): SettingsTabState =>
  state.isActive ? {...state, isActive: false} : state;

/**
 * Applies a terminal becoming active while a programmatic open is pending.
 *
 * The pending request belongs to that terminal, so the reaction is the
 * caller's: an add consumes the request and leaves the surface alone, while a
 * focus change does nothing at all.
 */
const whileOpenRequestPending = (
  state: SettingsTabState,
  onPending: (pending: SettingsTabState) => SettingsTabState
): SettingsTabState => (state.keepThroughInitialSession ? onPending(state) : takeSurfaceBack(state));

export default function settingsTab(state: SettingsTabState = initialState, action: HyperActions): SettingsTabState {
  if (isSettingsTabAction(action)) {
    return reduceSettingsTab(state, action);
  }
  // A terminal becoming active takes the surface back; the tab stays open.
  // The first add after a programmatic open is the window's initial terminal:
  // the open requested that it not steal the surface, and this add consumes
  // that request so every later one deactivates as usual.
  if (action.type === SESSION_ADD) {
    return whileOpenRequestPending(state, (pending) => ({...pending, keepThroughInitialSession: false}));
  }
  // A focus change while the open request is still pending is the same initial
  // terminal arriving; the request outranks it. Once the add above consumes the
  // request, a later focus change deactivates.
  if (action.type === SESSION_SET_ACTIVE) {
    return whileOpenRequestPending(state, (pending) => pending);
  }
  return state;
}
