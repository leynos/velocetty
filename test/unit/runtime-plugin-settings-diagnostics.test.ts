/**
 * @file Covers how the plugin runtime reports a failed persistence attempt.
 *
 * A config path names the user's home directory and a thrown message can quote
 * the file, so each diagnostic here must carry only a closed reason code or a
 * bounded error description.
 */
import {beforeAll, expect, spyOn, test} from 'bun:test';

import {GOLDEN_PATH_PLUGIN_ID, goldenPathSettingsDefaults} from '@shared/runtime/golden-path-demo';
import type {
  ensureRuntimePluginSettingsPersisted as ensureRuntimePluginSettingsPersistedType,
  setRuntimePluginEnabledPersisted as setRuntimePluginEnabledPersistedType
} from '../../app/runtime/plugin-runtime';
import {createMemoryConfigFileSystem, type MemoryConfigFileSystem} from '../testUtils/config-file-port';
import {registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';

const CONFIG_PATH = '/tmp/config.json5';

let ensureRuntimePluginSettingsPersisted: typeof ensureRuntimePluginSettingsPersistedType;
let setRuntimePluginEnabledPersisted: typeof setRuntimePluginEnabledPersistedType;

beforeAll(async () => {
  // plugin-runtime imports app/config/paths, which imports Electron at module
  // initialization time. Register the mock first so this suite is deterministic
  // regardless of test-file ordering.
  resetElectronMock();
  registerElectronMock();
  ({ensureRuntimePluginSettingsPersisted, setRuntimePluginEnabledPersisted} = await importFresh<
    typeof import('../../app/runtime/plugin-runtime')
  >('../../app/runtime/plugin-runtime', 'runtime_plugin_settings_diagnostics'));
});

const createReadWritePair = (initialContent: string) => {
  const fileSystem = createMemoryConfigFileSystem();
  fileSystem.setFile(CONFIG_PATH, initialContent);
  return {fileSystem, getWrites: () => fileSystem.writes.map((write) => write.text)};
};

const assertParseErrorBehaviour = <T>(
  invoke: (deps: {fileSystem: MemoryConfigFileSystem}) => T,
  expectedResult: T,
  expectedErrorMessage: string
): void => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const {fileSystem, getWrites} = createReadWritePair('{config:');

    const persisted = invoke({fileSystem});

    expect(persisted).toEqual(expectedResult);
    expect(getWrites()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(expectedErrorMessage);
  } finally {
    errorSpy.mockRestore();
  }
};

test('ensureRuntimePluginSettingsPersisted does not write on parse errors', () => {
  assertParseErrorBehaviour(
    ({fileSystem}) => ensureRuntimePluginSettingsPersisted({configFilePath: CONFIG_PATH, fileSystem}),
    {},
    '[runtime-plugins] Failed to parse the configuration. Returning empty namespace.'
  );
});

test('setRuntimePluginEnabledPersisted returns fallback settings on parse errors', () => {
  assertParseErrorBehaviour(
    ({fileSystem}) =>
      setRuntimePluginEnabledPersisted(GOLDEN_PATH_PLUGIN_ID, false, {
        configFilePath: CONFIG_PATH,
        fileSystem
      }),
    {...goldenPathSettingsDefaults, enabled: false},
    '[runtime-plugins] Failed to parse the configuration. Returning fallback settings.'
  );
});

test('a refused plugin write logs its bounded reason and not the config path', () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const {fileSystem} = createReadWritePair('{config: {}}');
    // A non-retryable fault ends the write on its first attempt, so the
    // plugin runtime reports the writer's closed reason code.
    fileSystem.queueFault('rename', 'EIO');

    ensureRuntimePluginSettingsPersisted({configFilePath: CONFIG_PATH, fileSystem});

    const logged = errorSpy.mock.calls.flat().map(String);
    expect(logged).toContain('config writer failed: {"code":"EIO","name":"Error"}');
    expect(logged).toContain('[runtime-plugins] The runtime plugin settings patch was refused (reason=io-error).');
    expect(logged.join('\n')).not.toContain(CONFIG_PATH);
  } finally {
    errorSpy.mockRestore();
  }
});

test('a thrown persistence failure logs bounded fields instead of the raw error', () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const fileSystem = createMemoryConfigFileSystem();
    const failure = Object.assign(new Error(`EACCES: permission denied, open '${CONFIG_PATH}'`), {code: 'EACCES'});
    const failingSystem = {
      ...fileSystem,
      readText: (): string => {
        throw failure;
      }
    };

    const namespace = ensureRuntimePluginSettingsPersisted({configFilePath: CONFIG_PATH, fileSystem: failingSystem});

    expect(namespace).toEqual({});
    expect(errorSpy).toHaveBeenCalledWith(
      '[runtime-plugins] Failed to persist the plugin settings defaults. Returning empty namespace.',
      {code: 'EACCES', name: 'Error'}
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(CONFIG_PATH);
  } finally {
    errorSpy.mockRestore();
  }
});
