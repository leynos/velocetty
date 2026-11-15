/**
 * @file Proves each command performs only the side effects its caller supplied.
 *
 * The table imports no Electron module, no configuration query, and no plugin
 * runtime: every effect arrives as a dependency. These tests build the table
 * over doubles and assert exactly which double a command called, so a command
 * that reaches around its dependencies — or stops performing its effect — fails
 * here rather than in a packaged application.
 *
 * Cross-links:
 * - Source: `app/commands.ts`, `app/commands/window-new.ts`
 * - Composition root: `app/start.ts`
 */
import {expect, mock, test} from 'bun:test';

import type {BrowserWindow} from 'electron';
import type {CommandDependencies} from '../../app/commands';
import {createCommandDispatcher, createCommandTable} from '../../app/commands';
import {GOLDEN_PATH_COMMAND_ID} from '../../app/runtime/golden-path-demo';
import {asCommandId, asProfileId} from '../../app/utils/shared-ids';

/** Long enough for a handler's zero-delay opener to run. */
const OPENER_SETTLE_MS = 5;

/** Waits past a deferred opener, so a test can assert it ran exactly once. */
const settleOpeners = () => new Promise((resolve) => setTimeout(resolve, OPENER_SETTLE_MS));

/**
 * Presents a partial window double as the type the command signatures accept.
 *
 * A test process cannot construct an Electron `BrowserWindow`, and the double
 * carries only the members the handlers reach. Keeping the assertion in one
 * documented place lets each test build a plain object instead of widening
 * through `unknown` at the point of use.
 *
 * @param windowDouble - The members the handlers under test reach.
 * @returns The same object, typed as the window a command receives.
 */
const asCommandWindow = <TDouble>(windowDouble: TDouble): BrowserWindow => {
  // SAFETY: every caller below supplies exactly the members the handlers under
  // test reach, so no handler can call a member the double does not carry.
  return windowDouble as BrowserWindow;
};

/**
 * Builds the slice of a window the command handlers reach.
 *
 * @returns The double plus the mocks its members record into.
 */
const createFocusedWindow = () => {
  const emit = mock((_event: string, ..._payload: unknown[]) => {});
  const isDevToolsOpened = mock(() => false);
  const openDevTools = mock((_options: unknown) => {});
  const closeDevTools = mock(() => {});
  const setAlwaysOnTop = mock((_isAlwaysOnTop: boolean) => {});
  const reload = mock(() => {});
  const window = asCommandWindow({
    isAlwaysOnTop: () => false,
    reload,
    rpc: {emit},
    setAlwaysOnTop,
    webContents: {closeDevTools, isDevToolsOpened, openDevTools}
  });

  return {closeDevTools, emit, isDevToolsOpened, openDevTools, reload, setAlwaysOnTop, window};
};

/**
 * Builds the table over recording doubles.
 *
 * @param overrides - Dependencies a test wants to answer differently.
 * @returns The table, the doubles, and the marker lines the sink received.
 */
const createHarness = (overrides: Partial<CommandDependencies> = {}) => {
  const markerLines: string[] = [];
  // A command's effect may carry no arguments, so the doubles also record the
  // order they ran in: an assertion on this list is an assertion on state, and
  // it catches a command that performs an extra effect or performs them twice.
  const effects: string[] = [];
  const record = (effect: string) => effects.push(effect);
  const addSystemContextMenu = mock(() => {
    record('addSystemContextMenu');
  });
  const getGoldenPathMessage = mock(() => 'golden path');
  const installCLI = mock(() => {
    record('installCLI');
  });
  const isHamburgerMenuEnabled = mock(() => true);
  const openConfig = mock(() => {
    record('openConfig');
  });
  const openWindow = mock((profileName?: string) => {
    record(`openWindow ${profileName ?? 'default'}`);
  });
  const popupApplicationMenu = mock(() => {
    record('popupApplicationMenu');
  });
  const removeSystemContextMenu = mock(() => {
    record('removeSystemContextMenu');
  });
  const updatePlugins = mock(() => {
    record('updatePlugins');
  });
  const dependencies: CommandDependencies = {
    addSystemContextMenu,
    getGoldenPathMessage,
    installCLI,
    isHamburgerMenuEnabled,
    markerSink: (line) => {
      markerLines.push(line);
    },
    openConfig,
    openWindow,
    popupApplicationMenu,
    profileNames: ['default', 'work'],
    removeSystemContextMenu,
    updatePlugins,
    ...overrides
  };

  return {
    addSystemContextMenu,
    effects,
    getGoldenPathMessage,
    installCLI,
    isHamburgerMenuEnabled,
    markerLines,
    openConfig,
    openWindow,
    popupApplicationMenu,
    removeSystemContextMenu,
    table: createCommandTable(dependencies),
    updatePlugins
  };
};

test('window:new reports its marker and defers the opener it was given', async () => {
  const harness = createHarness();

  harness.table['window:new']?.();

  // The marker names the command, and the opener waits for the event that
  // triggered it to be delivered.
  expect(harness.markerLines).toEqual(['[e2e] command-executed window:new']);
  expect(harness.openWindow).not.toHaveBeenCalled();

  await settleOpeners();
  expect(harness.openWindow).toHaveBeenCalledTimes(1);
  expect(harness.openWindow).toHaveBeenCalledWith();
});

test('tab:new asks the focused window, and opens one when none has focus', async () => {
  const harness = createHarness();
  const {emit, window} = createFocusedWindow();

  harness.table['tab:new']?.(window);
  expect(emit.mock.calls).toEqual([['termgroup add req', {}]]);
  expect(harness.openWindow).not.toHaveBeenCalled();

  harness.table['tab:new']?.();
  await settleOpeners();
  expect(harness.openWindow).toHaveBeenCalledTimes(1);
});

test('the split and close commands reach the focused window and no other effect', () => {
  const harness = createHarness();
  const {emit, window} = createFocusedWindow();

  harness.table['pane:splitRight']?.(window);
  harness.table['pane:splitDown']?.(window);
  harness.table['pane:close']?.(window);

  expect(emit.mock.calls).toEqual([
    ['split request vertical', {}],
    ['split request horizontal', {}],
    ['termgroup close req']
  ]);
  expect(harness.openWindow).not.toHaveBeenCalled();
});

test('window:preferences opens the configuration', () => {
  const harness = createHarness();

  harness.table['window:preferences']?.();

  expect(harness.effects).toEqual(['openConfig']);
  // Opening the configuration is not a command the lane reports.
  expect(harness.markerLines).toEqual([]);
});

test('plugins:update and cli:install call the adapters they were given', () => {
  const harness = createHarness();

  harness.table['plugins:update']?.();
  harness.table['cli:install']?.();

  expect(harness.effects).toEqual(['updatePlugins', 'installCLI']);
});

test('the system context-menu commands add and remove through the adapter', () => {
  const harness = createHarness();

  harness.table['systemContextMenu:add']?.();
  harness.table['systemContextMenu:remove']?.();

  expect(harness.effects).toEqual(['addSystemContextMenu', 'removeSystemContextMenu']);
});

test('window:hamburgerMenu pops the application menu only when it is enabled', () => {
  const enabled = createHarness();
  enabled.table['window:hamburgerMenu']?.();
  expect(enabled.effects).toEqual(['popupApplicationMenu']);

  const disabled = createHarness({isHamburgerMenuEnabled: () => false});
  disabled.table['window:hamburgerMenu']?.();
  expect(disabled.effects).toEqual([]);
});

test('the golden-path command announces the message it is given', () => {
  const harness = createHarness();
  const {emit, window} = createFocusedWindow();

  harness.table[GOLDEN_PATH_COMMAND_ID]?.(window);

  expect(harness.getGoldenPathMessage).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls).toEqual([['add notification', {text: 'golden path', url: '', dismissable: true}]]);

  // Without a window there is nothing to notify, so the query is not made.
  harness.table[GOLDEN_PATH_COMMAND_ID]?.();
  expect(harness.getGoldenPathMessage).toHaveBeenCalledTimes(1);
});

test('window:devtools opens the tools when they are closed', () => {
  const harness = createHarness();
  const {openDevTools, window} = createFocusedWindow();

  harness.table['window:devtools']?.(window);

  expect(openDevTools.mock.calls).toEqual([[{mode: 'detach'}]]);
});

test('window:toggleKeepOnTop flips the window it was given', () => {
  const harness = createHarness();
  const {setAlwaysOnTop, window} = createFocusedWindow();

  harness.table['window:toggleKeepOnTop']?.(window);

  expect(setAlwaysOnTop.mock.calls).toEqual([[true]]);
});

test('tab:jump commands carry the index the identifier names', () => {
  const harness = createHarness();
  const {emit, window} = createFocusedWindow();

  harness.table['tab:jump:3']?.(window);
  harness.table['tab:jump:last']?.(window);

  expect(emit.mock.calls).toEqual([
    ['move jump req', 2],
    ['move jump req', 'last']
  ]);
});

test('each profile gets its own window, tab, and split commands', async () => {
  const harness = createHarness();
  const {emit, window} = createFocusedWindow();

  harness.table['window:new:work']?.();
  await settleOpeners();
  expect(harness.openWindow.mock.calls).toEqual([['work']]);

  harness.table['tab:new:work']?.(window);
  harness.table['pane:splitRight:work']?.(window);
  harness.table['pane:splitDown:work']?.(window);

  expect(emit.mock.calls).toEqual([
    ['termgroup add req', {profile: asProfileId('work')}],
    ['split request vertical', {profile: asProfileId('work')}],
    ['split request horizontal', {profile: asProfileId('work')}]
  ]);
});

test('the dispatcher runs a known command and ignores an unknown one', () => {
  const harness = createHarness();
  const dispatch = createCommandDispatcher(harness.table);

  dispatch(asCommandId('window:preferences'));
  dispatch(asCommandId('not:a:command'));

  // The unknown identifier reaches nothing: the same single effect runs.
  expect(harness.effects).toEqual(['openConfig']);
});
