/**
 * @file Transition table for the tab strip and the active surface.
 *
 * Each scenario is a user-visible transition from the plan, run against the
 * real reducers and middleware. The strip must have exactly one active tab,
 * the active surface must match it, and no transition may remove a terminal
 * group or its session.
 */
import {beforeAll, describe, expect, test} from 'bun:test';
import {applyMiddleware, legacy_createStore as createStore, type Store} from 'redux';
import {thunk} from 'redux-thunk';

import {SETTINGS_TAB_UID} from '@shared/constants/settings-tab';
import {asProfileId, asSessionId} from '@shared/types/common';

import rootReducer from '../../lib/reducers/index';
import {selectActiveSurface, selectTabStrip} from '../../lib/selectors/tab-strip';
import effects from '../../lib/utils/effects';
import {registerModuleMock} from '../testUtils/mock-module';
import {createTransportMock} from '../testUtils/transport-mock';

import type {HyperActions, HyperState} from '../../typings/hyper';

const {transportMock} = createTransportMock();

// Registered at module scope: the actions reach for the transport while their
// module graph is evaluated.
registerModuleMock('../../lib/transport', () => ({transport: transportMock}));
registerModuleMock('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

type Actions = {
  readonly addSession: typeof import('../../lib/actions/sessions').addSession;
  readonly closeTab: typeof import('../../lib/actions/header').closeTab;
  readonly changeTab: typeof import('../../lib/actions/header').changeTab;
  readonly moveLeft: typeof import('../../lib/actions/ui').moveLeft;
  readonly moveRight: typeof import('../../lib/actions/ui').moveRight;
  readonly moveTo: typeof import('../../lib/actions/ui').moveTo;
  readonly openSettingsTab: typeof import('../../lib/actions/tab-strip').openSettingsTab;
};

let actions: Actions;

beforeAll(async () => {
  const sessions = await import('../../lib/actions/sessions');
  const header = await import('../../lib/actions/header');
  const ui = await import('../../lib/actions/ui');
  const tabStrip = await import('../../lib/actions/tab-strip');
  actions = {
    addSession: sessions.addSession,
    closeTab: header.closeTab,
    changeTab: header.changeTab,
    moveLeft: ui.moveLeft,
    moveRight: ui.moveRight,
    moveTo: ui.moveTo,
    openSettingsTab: tabStrip.openSettingsTab
  };
});

type TestStore = Store<HyperState, HyperActions>;

const createTestStore = (): TestStore => createStore(rootReducer, applyMiddleware(thunk, effects));

const addTerminal = (store: TestStore, uid: string): void => {
  store.dispatch(
    actions.addSession({
      uid: asSessionId(uid),
      shell: '/bin/bash',
      pid: 1,
      profile: asProfileId('default')
    })
  );
};

const terminalUids = (store: TestStore): string[] =>
  selectTabStrip(store.getState())
    .filter((tab) => tab.tabType === 'terminal')
    .map((tab) => tab.uid);

const withTwoTerminals = (): TestStore => {
  const store = createTestStore();
  addTerminal(store, 's1');
  addTerminal(store, 's2');
  return store;
};

const activeTabUids = (store: TestStore): string[] =>
  selectTabStrip(store.getState())
    .filter((tab) => tab.isActive)
    .map((tab) => tab.uid);

describe('tab strip', () => {
  test('lists terminals then the settings tab, with one active tab', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    const strip = selectTabStrip(store.getState());
    expect(strip.map((tab) => tab.uid)).toEqual([...terminalUids(store), SETTINGS_TAB_UID]);
    expect(activeTabUids(store)).toEqual([SETTINGS_TAB_UID]);
    expect(strip.at(-1)?.tabType).toBe('settings');
  });

  test('activating a terminal leaves the settings tab open and inactive', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    const first = terminalUids(store)[0] ?? '';
    store.dispatch(actions.changeTab(first));
    expect(store.getState().settingsTab.isOpen).toBe(true);
    expect(store.getState().settingsTab.isActive).toBe(false);
    expect(activeTabUids(store)).toEqual([first]);
    expect(selectActiveSurface(store.getState())).toEqual({kind: 'terminal', uid: first});
  });

  test('activating the settings tab makes it the active surface', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    store.dispatch(actions.changeTab(SETTINGS_TAB_UID));
    expect(activeTabUids(store)).toEqual([SETTINGS_TAB_UID]);
    expect(selectActiveSurface(store.getState())).toEqual({kind: 'settings'});
  });

  test('moving right from the last terminal reaches the settings tab', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    store.dispatch(actions.changeTab(terminalUids(store)[1] ?? ''));
    store.dispatch(actions.moveRight());
    expect(activeTabUids(store)).toEqual([SETTINGS_TAB_UID]);
  });

  test('moving right from the settings tab wraps to the first terminal', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    const first = terminalUids(store)[0] ?? '';
    store.dispatch(actions.moveRight());
    expect(activeTabUids(store)).toEqual([first]);
  });

  test('moving left from the first terminal wraps to the settings tab', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    store.dispatch(actions.changeTab(terminalUids(store)[0] ?? ''));
    store.dispatch(actions.moveLeft());
    expect(activeTabUids(store)).toEqual([SETTINGS_TAB_UID]);
  });

  test('jumping to the last tab selects the settings tab', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    store.dispatch(actions.changeTab(terminalUids(store)[1] ?? ''));
    store.dispatch(actions.moveTo('last'));
    expect(activeTabUids(store)).toEqual([SETTINGS_TAB_UID]);
  });

  test("a programmatic open survives the window's first session add", () => {
    const store = createTestStore();
    store.dispatch(actions.openSettingsTab({keepThroughInitialSession: true}));
    addTerminal(store, 's1');

    expect(store.getState().settingsTab.isOpen).toBe(true);
    expect(store.getState().settingsTab.isActive).toBe(true);
    expect(activeTabUids(store)).toEqual([SETTINGS_TAB_UID]);

    addTerminal(store, 's2');
    expect(store.getState().settingsTab.isActive).toBe(false);
    expect(activeTabUids(store)).toEqual([terminalUids(store)[1] ?? '']);
  });

  test('a user-initiated open is taken back by a later new session', () => {
    const store = withTwoTerminals();
    store.dispatch(actions.openSettingsTab());
    expect(store.getState().settingsTab.isActive).toBe(true);

    addTerminal(store, 's3');
    expect(store.getState().settingsTab.isOpen).toBe(true);
    expect(store.getState().settingsTab.isActive).toBe(false);
  });

  test('closing the settings tab leaves every terminal and session intact', () => {
    const store = withTwoTerminals();
    const terminalsBefore = terminalUids(store).length;
    const sessionsBefore = Object.keys(store.getState().sessions.sessions).length;
    store.dispatch(actions.openSettingsTab());
    store.dispatch(actions.closeTab(SETTINGS_TAB_UID));
    expect(store.getState().settingsTab.isOpen).toBe(false);
    expect(terminalUids(store)).toHaveLength(terminalsBefore);
    expect(Object.keys(store.getState().sessions.sessions)).toHaveLength(sessionsBefore);
    expect(selectTabStrip(store.getState()).map((tab) => tab.uid)).not.toContain(SETTINGS_TAB_UID);
  });

  test('no navigation transition removes a terminal group or session', () => {
    const store = withTwoTerminals();
    const groupsBefore = Object.keys(store.getState().termGroups.termGroups).length;
    const sessionsBefore = Object.keys(store.getState().sessions.sessions).length;
    store.dispatch(actions.openSettingsTab());
    store.dispatch(actions.moveRight());
    store.dispatch(actions.moveLeft());
    store.dispatch(actions.moveTo('last'));
    store.dispatch(actions.changeTab(terminalUids(store)[0] ?? ''));
    expect(Object.keys(store.getState().termGroups.termGroups)).toHaveLength(groupsBefore);
    expect(Object.keys(store.getState().sessions.sessions)).toHaveLength(sessionsBefore);
  });
});
