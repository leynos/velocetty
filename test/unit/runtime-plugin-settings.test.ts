/** @file Covers runtime plugin settings persistence and enable/disable evaluation. */
import {beforeAll, expect, spyOn, test} from 'bun:test';
import JSON5 from 'json5';

import {
  GOLDEN_PATH_COMMAND_ID,
  GOLDEN_PATH_PLUGIN_ID,
  goldenPathSettingsDefaults,
  runtimePluginManifests
} from '@shared/runtime/golden-path-demo';
import type {configOptions} from '@shared/types/config';
import type {
  detectKeybindingConflicts as detectKeybindingConflictsType,
  ensureRuntimePluginSettingsPersisted as ensureRuntimePluginSettingsPersistedType,
  getRuntimePluginCommandDefinitions as getRuntimePluginCommandDefinitionsType,
  getRuntimePluginKeybindings as getRuntimePluginKeybindingsType,
  mergeRuntimePluginKeybindings as mergeRuntimePluginKeybindingsType,
  setRuntimePluginEnabledPersisted as setRuntimePluginEnabledPersistedType
} from '../../app/runtime/plugin-runtime';
import {registerElectronMock, resetElectronMock} from '../testUtils/electron-path';

type ReadTextFile = (path: string, encoding: BufferEncoding) => string;
type WriteTextFile = (path: string, content: string, encoding: BufferEncoding) => void;

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
  } = await import('../../app/runtime/plugin-runtime.ts?runtime_plugin_settings_unit'));
});

const createReadWritePair = (
  initialContent: string
): {readFile: ReadTextFile; writeFile: WriteTextFile; getContent: () => string; getWrites: () => string[]} => {
  let currentContent = initialContent;
  const writes: string[] = [];

  return {
    readFile: (_path: string, _encoding: BufferEncoding) => currentContent,
    writeFile: (_path: string, content: string, _encoding: BufferEncoding) => {
      currentContent = content;
      writes.push(content);
    },
    getContent: () => currentContent,
    getWrites: () => writes
  };
};

const assertParseErrorBehaviour = <T>(
  invoke: (deps: {readFile: ReadTextFile; writeFile: WriteTextFile}) => T,
  expectedResult: T,
  expectedErrorMessage: string
): void => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const {readFile, writeFile, getWrites} = createReadWritePair('{config:');

    const persisted = invoke({readFile, writeFile});

    expect(persisted).toEqual(expectedResult);
    expect(getWrites()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(expectedErrorMessage);
  } finally {
    errorSpy.mockRestore();
  }
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
  const {readFile, writeFile, getContent, getWrites} = createReadWritePair(`{
    config: {
      defaultProfile: 'default',
      profiles: [{name: 'default', config: {}}],
    },
    plugins: [],
    localPlugins: [],
    keymaps: {},
  }`);

  const namespace = ensureRuntimePluginSettingsPersisted({configFilePath: '/tmp/config.json5', readFile, writeFile});

  expect(getWrites()).toHaveLength(1);
  expect(namespace[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);

  const persisted = JSON5.parse(getContent()) as {config: {plugins: Record<string, unknown>}};
  expect(persisted.config.plugins[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);
});

test('runtime plugin settings import remains safe on Windows when config paths resolve via Electron userData', async () => {
  await withProcessPlatform('win32', async () => {
    resetElectronMock();
    registerElectronMock();

    const runtimePluginModule = await import(
      '../../app/runtime/plugin-runtime.ts?runtime_plugin_settings_windows_user_data'
    );
    const {readFile, writeFile} = createReadWritePair(`{
      config: {},
      plugins: [],
      localPlugins: [],
      keymaps: {},
    }`);

    const namespace = runtimePluginModule.ensureRuntimePluginSettingsPersisted({
      configFilePath: 'C:\\Users\\tester\\AppData\\Roaming\\Hyper\\config.json5',
      readFile,
      writeFile
    });

    expect(namespace[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);
  });
});

test('ensureRuntimePluginSettingsPersisted is idempotent after defaults are written', () => {
  const {readFile, writeFile, getContent, getWrites} = createReadWritePair(`{
    config: {
      defaultProfile: 'default',
      profiles: [{name: 'default', config: {}}],
    },
    plugins: [],
    localPlugins: [],
    keymaps: {},
  }`);

  const firstNamespace = ensureRuntimePluginSettingsPersisted({
    configFilePath: '/tmp/config.json5',
    readFile,
    writeFile
  });
  const firstContent = getContent();

  const secondNamespace = ensureRuntimePluginSettingsPersisted({
    configFilePath: '/tmp/config.json5',
    readFile,
    writeFile
  });
  const secondContent = getContent();

  expect(firstNamespace).toEqual(secondNamespace);
  expect(secondContent).toEqual(firstContent);
  expect(getWrites()).toHaveLength(1);
});

test('setRuntimePluginEnabledPersisted updates enabled flag in JSON5 namespace', () => {
  const {readFile, writeFile, getContent, getWrites} = createReadWritePair(`{
    config: {
      plugins: {
        "${GOLDEN_PATH_PLUGIN_ID}": {enabled: true, message: "demo"}
      }
    },
  }`);

  const updated = setRuntimePluginEnabledPersisted(GOLDEN_PATH_PLUGIN_ID, false, {
    configFilePath: '/tmp/config.json5',
    readFile,
    writeFile
  });

  expect(updated.enabled).toBe(false);
  expect(getWrites()).toHaveLength(1);

  const persisted = JSON5.parse(getContent()) as {config: {plugins: Record<string, {enabled: boolean}>}};
  expect(persisted.config.plugins[GOLDEN_PATH_PLUGIN_ID]?.enabled).toBe(false);
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
  const {readFile, writeFile, getContent, getWrites} = createReadWritePair(initialContent);

  ensureRuntimePluginSettingsPersisted({configFilePath: '/tmp/config.json5', readFile, writeFile});

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
  const {readFile, writeFile, getContent, getWrites} = createReadWritePair(initialContent);

  setRuntimePluginEnabledPersisted(GOLDEN_PATH_PLUGIN_ID, false, {
    configFilePath: '/tmp/config.json5',
    readFile,
    writeFile
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

test('ensureRuntimePluginSettingsPersisted does not write on parse errors', () => {
  assertParseErrorBehaviour(
    ({readFile, writeFile}) =>
      ensureRuntimePluginSettingsPersisted({configFilePath: '/tmp/config.json5', readFile, writeFile}),
    {},
    'Failed to parse runtime plugin config at "/tmp/config.json5". Returning empty namespace.'
  );
});

test('setRuntimePluginEnabledPersisted returns fallback settings on parse errors', () => {
  assertParseErrorBehaviour(
    ({readFile, writeFile}) =>
      setRuntimePluginEnabledPersisted(GOLDEN_PATH_PLUGIN_ID, false, {
        configFilePath: '/tmp/config.json5',
        readFile,
        writeFile
      }),
    {...goldenPathSettingsDefaults, enabled: false},
    'Failed to parse runtime plugin config at "/tmp/config.json5". Returning fallback settings.'
  );
});

test('runtime command and keybinding contributions follow enabled setting', () => {
  const enabledConfig = {
    plugins: {
      [GOLDEN_PATH_PLUGIN_ID]: {
        enabled: true
      }
    }
  } as unknown as configOptions;
  const disabledConfig = {
    plugins: {
      [GOLDEN_PATH_PLUGIN_ID]: {
        enabled: false
      }
    }
  } as unknown as configOptions;

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
