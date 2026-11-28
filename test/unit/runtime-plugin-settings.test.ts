/** @file Covers runtime plugin settings persistence and enable/disable evaluation. */
import {beforeAll, expect, test} from 'bun:test';
import JSON5 from 'json5';
import {isJsonObject} from '@shared/types/json';

import {
  GOLDEN_PATH_COMMAND_ID,
  GOLDEN_PATH_PLUGIN_ID,
  goldenPathSettingsDefaults,
  runtimePluginManifests
} from '@shared/runtime/golden-path-demo';
import type {
  detectKeybindingConflicts as detectKeybindingConflictsType,
  ensureRuntimePluginSettingsPersisted as ensureRuntimePluginSettingsPersistedType,
  getRuntimePluginCommandDefinitions as getRuntimePluginCommandDefinitionsType,
  getRuntimePluginKeybindings as getRuntimePluginKeybindingsType,
  mergeRuntimePluginKeybindings as mergeRuntimePluginKeybindingsType,
  setRuntimePluginEnabledPersisted as setRuntimePluginEnabledPersistedType
} from '../../app/runtime/plugin-runtime';
import {createMemoryConfigFileSystem} from '../testUtils/config-file-port';
import {registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';

const CONFIG_PATH = '/tmp/config.json5';
const WINDOWS_CONFIG_PATH = String.raw`C:\Users\tester\AppData\Roaming\Hyper\config.json5`;

let ensureRuntimePluginSettingsPersisted: typeof ensureRuntimePluginSettingsPersistedType;
let detectKeybindingConflicts: typeof detectKeybindingConflictsType;
let getRuntimePluginCommandDefinitions: typeof getRuntimePluginCommandDefinitionsType;
let getRuntimePluginKeybindings: typeof getRuntimePluginKeybindingsType;
let mergeRuntimePluginKeybindings: typeof mergeRuntimePluginKeybindingsType;
let setRuntimePluginEnabledPersisted: typeof setRuntimePluginEnabledPersistedType;

beforeAll(async () => {
  // plugin-runtime imports app/config/paths, which imports Electron at module
  // initialization time. Register the Electron mock first so this suite is
  // deterministic regardless of test-file ordering.
  resetElectronMock();
  registerElectronMock();
  ({
    ensureRuntimePluginSettingsPersisted,
    detectKeybindingConflicts,
    getRuntimePluginCommandDefinitions,
    getRuntimePluginKeybindings,
    mergeRuntimePluginKeybindings,
    setRuntimePluginEnabledPersisted
  } = await importFresh<typeof import('../../app/runtime/plugin-runtime')>(
    '../../app/runtime/plugin-runtime',
    'runtime_plugin_settings_unit'
  ));
});

const createReadWritePair = (initialContent: string, filePath = CONFIG_PATH) => {
  const fileSystem = createMemoryConfigFileSystem();
  fileSystem.setFile(filePath, initialContent);

  return {
    fileSystem,
    getContent: () => fileSystem.readFile(filePath) ?? '',
    getWrites: () => fileSystem.writes.map((write) => write.text)
  };
};

const ensureJsonObject = (value: unknown) => {
  if (!isJsonObject(value)) {
    throw new Error('Expected persisted JSON object.');
  }
  return value;
};

/**
 * Temporarily overrides `process.platform` for the duration of `action`.
 *
 * @param platform - The platform string to set for the duration of the call.
 * @param action   - The function to execute with the overridden platform.
 * @returns        The value returned by `action`.
 *
 * The original `process.platform` value is always restored in a `finally`
 * block, so the override is guaranteed to be unwound even if `action` throws.
 */
const withProcessPlatform = async <T>(platform: NodeJS.Platform, action: () => Promise<T> | T): Promise<T> => {
  const originalPlatform = process.platform;

  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  });

  try {
    return await action();
  } finally {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    });
  }
};

test('ensureRuntimePluginSettingsPersisted writes missing defaults to config.plugins namespace', () => {
  const {fileSystem, getContent, getWrites} = createReadWritePair(`{
    config: {
      defaultProfile: 'default',
      profiles: [{name: 'default', config: {}}],
    },
    plugins: [],
    localPlugins: [],
    keymaps: {},
  }`);

  const namespace = ensureRuntimePluginSettingsPersisted({configFilePath: CONFIG_PATH, fileSystem});

  expect(getWrites()).toHaveLength(1);
  expect(namespace[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);

  const persisted = ensureJsonObject(JSON5.parse(getContent()));
  const config = ensureJsonObject(persisted.config);
  const plugins = ensureJsonObject(config.plugins);
  expect(plugins[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);
});

test('runtime plugin settings import remains safe on Windows when config paths resolve via Electron userData', async () => {
  await withProcessPlatform('win32', async () => {
    resetElectronMock();
    registerElectronMock();

    const runtimePluginModule = await importFresh<typeof import('../../app/runtime/plugin-runtime')>(
      '../../app/runtime/plugin-runtime',
      'runtime_plugin_settings_windows_user_data'
    );
    const {fileSystem} = createReadWritePair(
      `{
      config: {},
      plugins: [],
      localPlugins: [],
      keymaps: {},
    }`,
      WINDOWS_CONFIG_PATH
    );

    const namespace = runtimePluginModule.ensureRuntimePluginSettingsPersisted({
      configFilePath: WINDOWS_CONFIG_PATH,
      fileSystem
    });

    expect(namespace[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);
  });
});

test('ensureRuntimePluginSettingsPersisted is idempotent after defaults are written', () => {
  const {fileSystem, getContent, getWrites} = createReadWritePair(`{
    config: {
      defaultProfile: 'default',
      profiles: [{name: 'default', config: {}}],
    },
    plugins: [],
    localPlugins: [],
    keymaps: {},
  }`);

  const firstNamespace = ensureRuntimePluginSettingsPersisted({
    configFilePath: CONFIG_PATH,
    fileSystem
  });
  const firstContent = getContent();

  const secondNamespace = ensureRuntimePluginSettingsPersisted({
    configFilePath: CONFIG_PATH,
    fileSystem
  });
  const secondContent = getContent();

  expect(firstNamespace).toEqual(secondNamespace);
  expect(secondContent).toEqual(firstContent);
  expect(getWrites()).toHaveLength(1);
});

test('setRuntimePluginEnabledPersisted updates enabled flag in JSON5 namespace', () => {
  const {fileSystem, getContent, getWrites} = createReadWritePair(`{
    config: {
      plugins: {
        "${GOLDEN_PATH_PLUGIN_ID}": {enabled: true, message: "demo"}
      }
    },
  }`);

  const updated = setRuntimePluginEnabledPersisted(GOLDEN_PATH_PLUGIN_ID, false, {
    configFilePath: CONFIG_PATH,
    fileSystem
  });

  expect(updated.enabled).toBe(false);
  expect(getWrites()).toHaveLength(1);

  const persisted = ensureJsonObject(JSON5.parse(getContent()));
  const config = ensureJsonObject(persisted.config);
  const plugins = ensureJsonObject(config.plugins);
  const pluginSettings = ensureJsonObject(plugins[GOLDEN_PATH_PLUGIN_ID]);
  expect(pluginSettings.enabled).toBe(false);
});

test('ensureRuntimePluginSettingsPersisted preserves unchanged comments and formatting', () => {
  const initialContent = `{
  // keep root comment and spacing
  config: {
    defaultProfile: 'default',
    profiles: [{name: 'default', config: {}}],
    // keep this config comment
    shell: '/bin/zsh',
  },
  plugins: [],
  localPlugins: [],
  keymaps: {},
}`;
  const {fileSystem, getContent, getWrites} = createReadWritePair(initialContent);

  ensureRuntimePluginSettingsPersisted({configFilePath: CONFIG_PATH, fileSystem});

  expect(getWrites()).toHaveLength(1);
  expect(getContent()).toBe(`{
  // keep root comment and spacing
  config: {
    defaultProfile: 'default',
    profiles: [{name: 'default', config: {}}],
    // keep this config comment
    shell: '/bin/zsh',
    plugins: {
      "${GOLDEN_PATH_PLUGIN_ID}": {
        enabled: true,
        message: 'Golden path plugin command invoked.',
        tabPrefix: 'GP',
      }
    }
  },
  plugins: [],
  localPlugins: [],
  keymaps: {},
}`);
});

test('setRuntimePluginEnabledPersisted preserves unrelated plugin formatting', () => {
  const initialContent = `{
  config: {
    // keep plugin ordering and comments
    plugins: {
      otherPlugin: {enabled: true},
      "${GOLDEN_PATH_PLUGIN_ID}": {
        enabled: true,
        message: "custom message",
        tabPrefix: "Custom"
      },
    },
  },
}`;
  const {fileSystem, getContent, getWrites} = createReadWritePair(initialContent);

  setRuntimePluginEnabledPersisted(GOLDEN_PATH_PLUGIN_ID, false, {
    configFilePath: CONFIG_PATH,
    fileSystem
  });

  expect(getWrites()).toHaveLength(1);
  expect(getContent()).toBe(`{
  config: {
    // keep plugin ordering and comments
    plugins: {
      otherPlugin: {enabled: true},
      "${GOLDEN_PATH_PLUGIN_ID}": {
        enabled: false,
        message: 'custom message',
        tabPrefix: 'Custom',
      },
    },
  },
}`);
});

test('runtime command and keybinding contributions follow enabled setting', () => {
  const enabledConfig = {
    plugins: {
      [GOLDEN_PATH_PLUGIN_ID]: {
        enabled: true
      }
    }
  };
  const disabledConfig = {
    plugins: {
      [GOLDEN_PATH_PLUGIN_ID]: {
        enabled: false
      }
    }
  };

  expect(getRuntimePluginCommandDefinitions(enabledConfig).map((command) => command.id)).toContain(
    GOLDEN_PATH_COMMAND_ID
  );
  expect(getRuntimePluginCommandDefinitions(disabledConfig)).toEqual([]);

  expect(Array.isArray(getRuntimePluginKeybindings(enabledConfig)[GOLDEN_PATH_COMMAND_ID])).toBe(true);
  expect(getRuntimePluginKeybindings(disabledConfig)).toEqual({});
});

test('mergeRuntimePluginKeybindings preserves resolved user keymap overrides', () => {
  const runtimeKeybindings = {
    [GOLDEN_PATH_COMMAND_ID]: ['ctrl+alt+shift+g']
  };
  const resolvedKeymaps = {
    [GOLDEN_PATH_COMMAND_ID]: ['ctrl+shift+g']
  };

  expect(mergeRuntimePluginKeybindings(resolvedKeymaps, runtimeKeybindings)[GOLDEN_PATH_COMMAND_ID]).toEqual([
    'ctrl+shift+g'
  ]);
});

test('detectKeybindingConflicts reports exact shortcut collisions deterministically', () => {
  const conflicts = detectKeybindingConflicts({
    'window:new': ['ctrl+n', 'ctrl+shift+n', 'ctrl+n'],
    'tab:new': ['ctrl+t'],
    'plugins:demo:announce': ['ctrl+n'],
    'workspace:reload': ['ctrl+shift+n']
  });

  expect(conflicts).toEqual([
    {
      keys: 'ctrl+n',
      commands: ['plugins:demo:announce', 'window:new']
    },
    {
      keys: 'ctrl+shift+n',
      commands: ['window:new', 'workspace:reload']
    }
  ]);
});

test('detectKeybindingConflicts ignores user overrides that replace runtime defaults for the same command', () => {
  const mergedKeymaps = mergeRuntimePluginKeybindings(
    {
      [GOLDEN_PATH_COMMAND_ID]: ['ctrl+shift+g'],
      'workspace:reload': ['ctrl+r']
    },
    {
      [GOLDEN_PATH_COMMAND_ID]: ['ctrl+alt+shift+g']
    }
  );

  expect(mergedKeymaps[GOLDEN_PATH_COMMAND_ID]).toEqual(['ctrl+shift+g']);
  expect(detectKeybindingConflicts(mergedKeymaps)).toEqual([]);
});

test('golden path runtime tab provider output is deterministic for identical context', () => {
  const manifest = runtimePluginManifests.find((candidate) => candidate.id === GOLDEN_PATH_PLUGIN_ID);
  expect(manifest).toBeDefined();

  const provider = manifest!.tabDecorationProviders[0];
  const context = {
    tabId: 'tab-a',
    tabIndex: 1,
    active: true,
    hasActivity: true,
    title: 'Shell'
  };
  const settings = {...goldenPathSettingsDefaults};

  const first = provider.provideDecoration(context, settings);
  const second = provider.provideDecoration(context, settings);
  const expectedPrefix = `${goldenPathSettingsDefaults.tabPrefix}${context.hasActivity ? '!' : ''}`;
  const expectedTitle = `[${expectedPrefix}] ${context.title}`;
  expect(first).toEqual(second);
  expect(first?.title).toBe(expectedTitle);
});
