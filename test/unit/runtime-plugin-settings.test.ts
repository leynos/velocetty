/** @file Covers runtime plugin settings persistence and enable/disable evaluation. */
import {expect, test} from 'bun:test';
import JSON5 from 'json5';

import {
  GOLDEN_PATH_COMMAND_ID,
  GOLDEN_PATH_PLUGIN_ID,
  goldenPathSettingsDefaults,
  runtimePluginManifests
} from '@shared/runtime/golden-path-demo';
import type {configOptions} from '@shared/types/config';
import {
  ensureRuntimePluginSettingsPersisted,
  getRuntimePluginCommandDefinitions,
  getRuntimePluginKeybindings,
  mergeRuntimePluginKeybindings,
  setRuntimePluginEnabledPersisted
} from '../../app/runtime/plugin-runtime';

type ReadTextFile = (path: string, encoding: BufferEncoding) => string;
type WriteTextFile = (path: string, content: string, encoding: BufferEncoding) => void;

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

  const namespace = ensureRuntimePluginSettingsPersisted('/tmp/hyper.json', readFile, writeFile);

  expect(getWrites()).toHaveLength(1);
  expect(namespace[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);

  const persisted = JSON5.parse(getContent()) as {config: {plugins: Record<string, unknown>}};
  expect(persisted.config.plugins[GOLDEN_PATH_PLUGIN_ID]).toEqual(goldenPathSettingsDefaults);
});

test('setRuntimePluginEnabledPersisted updates enabled flag in JSON5 namespace', () => {
  const {readFile, writeFile, getContent, getWrites} = createReadWritePair(`{
    config: {
      plugins: {
        "${GOLDEN_PATH_PLUGIN_ID}": {enabled: true, message: "demo"}
      }
    },
  }`);

  const updated = setRuntimePluginEnabledPersisted(
    GOLDEN_PATH_PLUGIN_ID,
    false,
    '/tmp/hyper.json',
    readFile,
    writeFile
  );

  expect(updated.enabled).toBe(false);
  expect(getWrites()).toHaveLength(1);

  const persisted = JSON5.parse(getContent()) as {config: {plugins: Record<string, {enabled: boolean}>}};
  expect(persisted.config.plugins[GOLDEN_PATH_PLUGIN_ID]?.enabled).toBe(false);
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
