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
import {SESSION_ADD, SESSION_SET_ACTIVE} from '@shared/constants/sessions';
import {asProfileId, asSessionId} from '@shared/types/common';

import settingsTab from '../../lib/reducers/settings-tab';

import type {HyperActions} from '../../typings/hyper';

const INITIAL = {
  isOpen: false,
  isActive: false,
  keepThroughInitialSession: false,
  query: '',
  selectedCategory: 'all'
} as const;

const reduce = (action: HyperActions) => settingsTab(undefined, action);

const open = (keepThroughInitialSession = false) => reduce({type: SETTINGS_TAB_OPEN, keepThroughInitialSession});

const sessionActivated = (): HyperActions => ({
  type: SESSION_SET_ACTIVE,
  uid: asSessionId('session-1')
});

const sessionAdded = (uid = 'session-1'): HyperActions => ({
  type: SESSION_ADD,
  uid: asSessionId(uid),
  shell: '/bin/bash',
  pid: 1,
  cols: null,
  rows: null,
  activeUid: null,
  now: 0,
  profile: asProfileId('default')
});

describe('settings tab slice', () => {
  test('starts closed and inactive', () => {
    expect(reduce({type: SETTINGS_TAB_DEACTIVATE})).toEqual(INITIAL);
  });

  test('opening makes it active', () => {
    expect(open()).toEqual({...INITIAL, isOpen: true, isActive: true});
  });

  test("a programmatic open survives the window's first session add", () => {
    const opened = open(true);
    expect(opened).toEqual({...INITIAL, isOpen: true, isActive: true, keepThroughInitialSession: true});

    // The initial terminal arrives after the request; it consumes the request
    // and leaves the settings surface in place.
    const firstAdd = settingsTab(opened, sessionAdded());
    expect(firstAdd.isActive).toBe(true);
    expect(firstAdd.keepThroughInitialSession).toBe(false);

    // A session the user creates afterwards takes the surface back as usual.
    const secondAdd = settingsTab(firstAdd, sessionAdded('session-2'));
    expect(secondAdd.isActive).toBe(false);
    expect(secondAdd.isOpen).toBe(true);
  });

  test('a user-initiated open is taken back by the next session add', () => {
    const added = settingsTab(open(false), sessionAdded());
    expect(added.isActive).toBe(false);
    expect(added.isOpen).toBe(true);
  });

  test('a focus change does not take the surface while the initial request is pending', () => {
    const focused = settingsTab(open(true), sessionActivated());
    expect(focused.isActive).toBe(true);

    // The initial add still consumes the request, so a later focus change
    // deactivates even when it arrives before that add in some other order.
    const added = settingsTab(focused, sessionAdded());
    expect(added.isActive).toBe(true);
    expect(settingsTab(added, sessionActivated()).isActive).toBe(false);
  });

  test('reactivating the tab clears a stale initial-session request', () => {
    const reactivated = settingsTab(open(true), {type: SETTINGS_TAB_ACTIVATE});
    expect(reactivated.keepThroughInitialSession).toBe(false);
    expect(settingsTab(reactivated, sessionAdded()).isActive).toBe(false);
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

  test('deactivating also discards an initial-session request', () => {
    const deactivated = settingsTab(open(true), {type: SETTINGS_TAB_DEACTIVATE});
    expect(deactivated.keepThroughInitialSession).toBe(false);
    expect(settingsTab(deactivated, sessionAdded()).isActive).toBe(false);
  });
});
