/**
 * @file Verifies that terminal commands cannot reach a hidden session while
 * the settings surface owns input.
 *
 * The table is driven by the platform keymaps, so a command added to a keymap
 * without being classified fails here rather than leaking keystrokes. The same
 * table with a terminal surface active proves the gate is not vacuous.
 */
import {beforeAll, describe, expect, test} from 'bun:test';
import {applyMiddleware, legacy_createStore as createStore, type Store} from 'redux';
import {thunk} from 'redux-thunk';

import darwinKeymap from '../../app/keymaps/darwin.json';
import linuxKeymap from '../../app/keymaps/linux.json';
import win32Keymap from '../../app/keymaps/win32.json';
import {asCommandId, type CommandId} from '@shared/types/commands';

import rootReducer from '../../lib/reducers/index';
import {isAllowedOnSettingsSurface, isSettingsSurfaceGated} from '../../lib/settings/surface-command-gate';
import effects from '../../lib/utils/effects';
import {registerModuleMock} from '../testUtils/mock-module';
import {createTransportMock} from '../testUtils/transport-mock';

import type {HyperActions, HyperState} from '../../typings/hyper';

const {transportMock} = createTransportMock();

// Registered at module scope: the actions reach for the transport while their
// module graph is evaluated.
registerModuleMock('../../lib/transport', () => ({transport: transportMock}));
registerModuleMock('../../lib/transport/electron-ipc-transport', () => ({transport: transportMock}));

type ExecCommand = typeof import('../../lib/actions/ui').execCommand;
type OpenSettingsTab = typeof import('../../lib/actions/tab-strip').openSettingsTab;
type TestStore = Store<HyperState, HyperActions>;

let execCommand: ExecCommand;
let openSettingsTab: OpenSettingsTab;

beforeAll(async () => {
  ({execCommand} = await import('../../lib/actions/ui'));
  ({openSettingsTab} = await import('../../lib/actions/tab-strip'));
});

const keymapCommands = (): readonly string[] => {
  const commands = new Set<string>();
  for (const keymap of [darwinKeymap, linuxKeymap, win32Keymap]) {
    for (const command of Object.keys(keymap)) {
      commands.add(command);
    }
  }
  return [...commands].toSorted();
};

const createStoreWithSurface = (isSettingsActive: boolean): TestStore => {
  const store = createStore(rootReducer, applyMiddleware(thunk, effects));
  if (isSettingsActive) {
    store.dispatch(openSettingsTab());
  }
  return store;
};

type RunResult = {readonly calls: number; readonly settingsOpen: boolean};

const runCommand = (command: CommandId, isSettingsActive: boolean): RunResult => {
  const store = createStoreWithSurface(isSettingsActive);
  let calls = 0;
  store.dispatch(
    execCommand(
      command,
      () => {
        calls += 1;
      },
      {}
    )
  );
  return {calls, settingsOpen: store.getState().settingsTab.isOpen};
};

describe('settings surface input gating', () => {
  test('every keymap command is classified', () => {
    const unclassified = keymapCommands().filter(
      (command) => !isAllowedOnSettingsSurface(command) && !isSettingsSurfaceGated(command) && command !== 'pane:close'
    );
    expect(unclassified).toEqual([]);
  });

  test('no terminal command reaches a handler while settings is active', () => {
    const leaking = keymapCommands()
      .filter((command) => command !== 'pane:close' && !isAllowedOnSettingsSurface(command))
      .filter((command) => runCommand(asCommandId(command), true).calls !== 0);
    expect(leaking).toEqual([]);
    expect(transportMock.emit).not.toHaveBeenCalled();
  });

  test('pane:close closes the settings tab instead of a pane', () => {
    const result = runCommand(asCommandId('pane:close'), true);
    expect(result.settingsOpen).toBe(false);
    expect(result.calls).toBe(0);
  });

  test('allowed window and tab commands still run', () => {
    const allowed = ['tab:next', 'tab:new', 'window:preferences', 'zoom:in'];
    expect(allowed.map((command) => runCommand(asCommandId(command), true).calls)).toEqual([1, 1, 1, 1]);
  });

  test('the same commands do reach the terminal surface', () => {
    const gated = keymapCommands().filter((command) => isSettingsSurfaceGated(command));
    const reached = gated.filter((command) => runCommand(asCommandId(command), false).calls === 1);
    expect(reached).toEqual(gated);
  });
});
