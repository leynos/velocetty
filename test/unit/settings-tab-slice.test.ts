/**
 * @file Transition table for the settings tab slice.
 *
 * The slice is the single owner of "is the settings surface active", so every
 * transition that should take the surface back lives here rather than in each
 * caller.
 */
import {describe, expect, test} from 'bun:test';

import {
  SETTINGS_CATEGORY_SELECT,
  SETTINGS_QUERY_SET,
  SETTINGS_TAB_ACTIVATE,
  SETTINGS_TAB_CLOSE,
  SETTINGS_TAB_DEACTIVATE,
  SETTINGS_TAB_OPEN
} from '@shared/constants/settings-tab';
import {SESSION_SET_ACTIVE} from '@shared/constants/sessions';
import {asSessionId} from '@shared/types/common';

import settingsTab from '../../lib/reducers/settings-tab';

import type {HyperActions} from '../../typings/hyper';

const INITIAL = {isOpen: false, isActive: false, query: '', selectedCategory: 'all'} as const;

const reduce = (action: HyperActions) => settingsTab(undefined, action);

const open = () => reduce({type: SETTINGS_TAB_OPEN});

const sessionActivated = (): HyperActions => ({
  type: SESSION_SET_ACTIVE,
  uid: asSessionId('session-1')
});

describe('settings tab slice', () => {
  test('starts closed and inactive', () => {
    expect(reduce({type: SETTINGS_TAB_DEACTIVATE})).toEqual(INITIAL);
  });

  test('opening makes it active', () => {
    expect(open()).toEqual({...INITIAL, isOpen: true, isActive: true});
  });

  test('closing clears query and category', () => {
    const queried = settingsTab(open(), {type: SETTINGS_QUERY_SET, query: 'font'});
    const categorised = settingsTab(queried, {type: SETTINGS_CATEGORY_SELECT, category: 'cursor'});
    expect(categorised.query).toBe('font');
    expect(categorised.selectedCategory).toBe('cursor');
    expect(settingsTab(categorised, {type: SETTINGS_TAB_CLOSE})).toEqual(INITIAL);
  });

  test('activating a closed tab does nothing', () => {
    const closed = settingsTab(undefined, {type: SETTINGS_TAB_CLOSE});
    expect(settingsTab(closed, {type: SETTINGS_TAB_ACTIVATE})).toBe(closed);
  });

  test('a terminal session becoming active takes the surface back', () => {
    const deactivated = settingsTab(open(), sessionActivated());
    expect(deactivated.isOpen).toBe(true);
    expect(deactivated.isActive).toBe(false);
  });

  test('deactivating leaves the tab open and keeps the search', () => {
    const queried = settingsTab(open(), {type: SETTINGS_QUERY_SET, query: 'font'});
    expect(settingsTab(queried, {type: SETTINGS_TAB_DEACTIVATE})).toEqual({...queried, isActive: false});
  });
});
