/**
 * @file Shared action contracts for the singleton settings tab.
 *
 * Query and category selection live in Redux rather than in component state
 * so the future `settings.search` command (roadmap 5.1.2) can drive them.
 */

import type {SettingCategoryId} from '../settings/panel-model';

/** The reserved uid of the settings tab in the tab strip. */
export const SETTINGS_TAB_UID = 'velocetty:settings';

/** Opens the settings tab and makes it the active surface. */
export const SETTINGS_TAB_OPEN = 'SETTINGS_TAB_OPEN';
/** Closes the settings tab. */
export const SETTINGS_TAB_CLOSE = 'SETTINGS_TAB_CLOSE';
/** Makes the settings tab the active surface. */
export const SETTINGS_TAB_ACTIVATE = 'SETTINGS_TAB_ACTIVATE';
/** Leaves the settings tab open but returns input to the terminal surface. */
export const SETTINGS_TAB_DEACTIVATE = 'SETTINGS_TAB_DEACTIVATE';
/** Replaces the search query. */
export const SETTINGS_QUERY_SET = 'SETTINGS_QUERY_SET';
/** Selects a category, or "all". */
export const SETTINGS_CATEGORY_SELECT = 'SETTINGS_CATEGORY_SELECT';

/** The selected category, or `all`. */
export type SettingsCategorySelection = 'all' | SettingCategoryId;

/** The settings tab's slice of renderer state. */
export type SettingsTabState = {
  readonly isOpen: boolean;
  readonly isActive: boolean;
  /**
   * True while a programmatic open is waiting for the window's first
   * `SESSION_ADD`. That one add leaves the tab active; every later add
   * deactivates as usual.
   */
  readonly keepThroughInitialSession: boolean;
  readonly query: string;
  readonly selectedCategory: SettingsCategorySelection;
};

/** Actions the settings tab slice understands. */
export type SettingsTabActions =
  | {readonly type: typeof SETTINGS_TAB_OPEN; readonly keepThroughInitialSession?: boolean}
  | {readonly type: typeof SETTINGS_TAB_CLOSE}
  | {readonly type: typeof SETTINGS_TAB_ACTIVATE}
  | {readonly type: typeof SETTINGS_TAB_DEACTIVATE}
  | {readonly type: typeof SETTINGS_QUERY_SET; readonly query: string}
  | {readonly type: typeof SETTINGS_CATEGORY_SELECT; readonly category: SettingsCategorySelection};
