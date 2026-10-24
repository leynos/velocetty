/** @file Verifies JSON5 config import and startup bootstrap without legacy migration. */
import {expect, mock, test} from 'bun:test';

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {existsSync, mkdirpSync, readFileSync, removeSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';
import {isString} from '@shared/types/guards';

import {createConfigImportModule, type ConfigImportPaths} from '../../app/config/import';
import {_init} from '../../app/config/init';
import type {configValidationDiagnostic} from '@shared/types/config';

type ConfigInit = Parameters<typeof createConfigImportModule>[0]['_init'];
type ConfigNotify = Parameters<typeof createConfigImportModule>[0]['notify'];

type ConfigImportHarness = {
  _import: ReturnType<typeof createConfigImportModule>['_import'];
  getDefaultConfig: ReturnType<typeof createConfigImportModule>['getDefaultConfig'];
  cleanup: () => void;
  initMock: ReturnType<typeof mock<ConfigInit>>;
  mockPaths: ConfigImportPaths;
  notifyMock: ReturnType<typeof mock<ConfigNotify>>;
  warnMock: ReturnType<typeof mock<(_message?: string, ..._rest: Error[]) => void>>;
  workspaceRoot: string;
};

const ensureObject = (value: unknown): JsonObject => {
  if (!isJsonObject(value)) {
    throw new Error('Expected object value.');
  }
  return value;
};

type ParsedDiagnosticsPayload = Readonly<{
  diagnostics: ReadonlyArray<configValidationDiagnostic>;
}>;

const isValidObject = isJsonObject;

const extractDiagnostics = (entry: JsonObject) => ('diagnostics' in entry ? entry.diagnostics : null);

const isConfigValidationDiagnostic = (value: JsonValue): value is JsonObject & configValidationDiagnostic =>
  isJsonObject(value) &&
  isString(value.path) &&
  isString(value.message) &&
  isString(value.suggestedFix) &&
  (value.docHint === undefined || isString(value.docHint)) &&
  (value.defaultHint === undefined || isString(value.defaultHint));

const isValidDiagnosticsArray = (diagnostics: JsonValue): diagnostics is configValidationDiagnostic[] =>
  Array.isArray(diagnostics) &&
  diagnostics.length > 0 &&
  diagnostics.every((entry) => isConfigValidationDiagnostic(entry));

const findDiagnosticsPayloadFromWarnMock = (
  warnMock: ReturnType<typeof mock<(_message?: string, ..._rest: Error[]) => void>>
): ParsedDiagnosticsPayload => {
  for (const call of warnMock.mock.calls) {
    for (const entry of call) {
      if (!isValidObject(entry)) {
        continue;
      }
      const diagnostics = extractDiagnostics(entry);
      if (!isValidDiagnosticsArray(diagnostics)) {
        continue;
      }
      return {diagnostics};
    }
  }

  throw new Error('Expected a structured diagnostics payload in warning logs.');
};

const createMockPaths = (workspaceRoot: string): ConfigImportPaths => ({
  cfgDir: path.join(workspaceRoot, 'user-config'),
  cfgPath: path.join(workspaceRoot, 'user-config', 'config.json5'),
  defaultCfg: path.join(workspaceRoot, 'defaults', 'config-default.json'),
  defaultPlatformKeyPath: () => path.join(workspaceRoot, 'defaults', 'linux.json'),
  plugs: {
    base: path.join(workspaceRoot, 'user-config', 'plugins'),
    local: path.join(workspaceRoot, 'user-config', 'plugins', 'local')
  },
  schemaFile: 'schema.json',
  schemaPath: path.join(workspaceRoot, 'defaults', 'schema.json')
});

const createConfigImportHarness = async (): Promise<ConfigImportHarness> => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'velocetty-config-import-'));
  const mockPaths = createMockPaths(workspaceRoot);
  const notifyMock = mock<ConfigNotify>(() => {});
  const initMock = mock<ConfigInit>((userCfg, defaultCfg, notify) => _init(userCfg, defaultCfg, notify));
  const warnMock = mock((_message?: string, ..._rest: Error[]) => {});
  let cleanupCalled = false;

  const cleanup = () => {
    if (cleanupCalled) {
      return;
    }
    cleanupCalled = true;
    // Do not call mock.restore() — this harness uses no mock.module()
    // registrations. A global restore would tear down module mocks from
    // other suites running concurrently and cause nondeterministic failures.
    removeSync(workspaceRoot);
  };

  try {
    mkdirpSync(path.join(workspaceRoot, 'defaults'));
    const configModule = createConfigImportModule({
      _init: initMock,
      notify: notifyMock,
      paths: mockPaths,
      warn: warnMock
    });

    return {
      _import: configModule._import,
      getDefaultConfig: configModule.getDefaultConfig,
      cleanup,
      initMock,
      mockPaths,
      notifyMock,
      warnMock,
      workspaceRoot
    };
  } catch (error) {
    cleanup();
    throw error;
  }
};

const sharedDefaultConfigFixture = `{
  config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
  plugins: [],
  localPlugins: [],
  keymaps: {}
}`;

type DiagnosticFallbackTestOptions = {
  userConfigContent: string;
  assertNotification: (message: string, mockPaths: ConfigImportPaths) => void;
  /**
   * Called with the diagnostics the import reported.
   *
   * Read-only, because the warning payload is frozen by the time it reaches a
   * caller: an assertion helper has no business writing to it, and declaring
   * it mutable would reject the payload actually passed in.
   */
  assertPrimaryDiagnostic: (diagnostics: readonly configValidationDiagnostic[], mockPaths: ConfigImportPaths) => void;
};

const runDiagnosticFallbackTest = async (options: DiagnosticFallbackTestOptions): Promise<void> => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(harness.mockPaths.cfgPath, options.userConfigContent, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    harness._import();

    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
    // The call-count assertion above is what establishes the call exists, so
    // the message is read directly rather than checked for absence twice.
    const [notificationMessage] = harness.notifyMock.mock.calls[0];
    options.assertNotification(notificationMessage, harness.mockPaths);
    expect(harness.notifyMock.mock.calls[0]?.[0]).toContain('Suggested fix:');

    const diagnosticsPayload = findDiagnosticsPayloadFromWarnMock(harness.warnMock);
    const diagnostics = diagnosticsPayload.diagnostics;
    options.assertPrimaryDiagnostic(diagnostics, harness.mockPaths);

    const expectedFallbackConfig = ensureObject(JSON5.parse(sharedDefaultConfigFixture));
    expectedFallbackConfig.keymaps = {'window:new': ['ctrl+n']};
    expect(harness.initMock.mock.calls[0]?.[0]).toEqual(expectedFallbackConfig);
  } finally {
    harness.cleanup();
  }
};

test('notifies and falls back to default config on invalid JSON5 user config', async () => {
  await runDiagnosticFallbackTest({
    userConfigContent: `{
      config: { defaultProfile: 'broken' profiles: [{ name: 'broken', config: {} }] },
      plugins: [],
    }`,
    assertNotification: (message, mockPaths) => {
      expect(message).toContain(mockPaths.cfgPath);
    },
    assertPrimaryDiagnostic: (diagnostics, mockPaths) => {
      const primaryDiagnostic = diagnostics.find((d) => {
        const path = isString(d.path) ? d.path : '';
        const message = isString(d.message) ? d.message : '';
        return path.includes(mockPaths.cfgPath) && message.includes('JSON5');
      });
      if (!primaryDiagnostic) {
        throw new TypeError('Expected parse diagnostic for config file path.');
      }
      expect(primaryDiagnostic.path).toContain(mockPaths.cfgPath);
      expect(primaryDiagnostic.message).toContain('JSON5');
      expect(primaryDiagnostic.suggestedFix).toContain('Fix');
    }
  });
});

test('reports schema validation diagnostics with doc and default hints', async () => {
  await runDiagnosticFallbackTest({
    userConfigContent: `{
      config: { defaultProfile: 'broken', profiles: [{ name: 'broken', config: {} }] },
      plugins: { not: 'an-array' },
      localPlugins: [],
      keymaps: {}
    }`,
    assertNotification: (message) => {
      expect(message).toContain('/plugins');
    },
    assertPrimaryDiagnostic: (diagnostics) => {
      const primaryDiagnostic = diagnostics.find((d) => d.path === '/plugins');
      if (!primaryDiagnostic) {
        throw new Error('Expected schema diagnostic for /plugins.');
      }
      expect(primaryDiagnostic.path).toBe('/plugins');
      expect(primaryDiagnostic.message).toContain('array of strings');
      expect(primaryDiagnostic.suggestedFix).toContain('array of plugin');
      expect(primaryDiagnostic.defaultHint).toBe('[]');
      expect(primaryDiagnostic.docHint).toContain('plugins');
    }
  });
});

test('rejects invalid values nested in config options', async () => {
  await runDiagnosticFallbackTest({
    userConfigContent: `{
      config: { defaultProfile: 'broken', profiles: [{ name: 'broken', config: { fontSize: 'large' } }] },
      plugins: [],
      localPlugins: [],
      keymaps: {}
    }`,
    assertNotification: (message) => {
      expect(message).toContain('/config/profiles/0/config/fontSize');
    },
    assertPrimaryDiagnostic: (diagnostics) => {
      const primaryDiagnostic = diagnostics.find((d) => d.path === '/config/profiles/0/config/fontSize');
      if (!primaryDiagnostic) {
        throw new Error('Expected schema diagnostic for nested profile fontSize.');
      }
      expect(primaryDiagnostic.message).toContain('number');
      expect(primaryDiagnostic.suggestedFix).toContain('documented types');
    }
  });
});

test('imports user config with JSON5 comments and trailing commas', async () => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(
      harness.mockPaths.defaultCfg,
      `{
      config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
      plugins: [],
      localPlugins: [],
      keymaps: {}
    }`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(
      harness.mockPaths.cfgPath,
      `{
      // user overrides in JSON5
      config: {
        defaultProfile: 'work',
        profiles: [{name: 'work', config: {fontSize: 17}}],
      },
      plugins: ['plugin-alpha',],
      localPlugins: ['plugin-local',],
      keymaps: {'window:close': 'ctrl+w',},
    }`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const importedConfig = harness._import();

    expect(harness.initMock).toHaveBeenCalledTimes(1);
    expect(importedConfig.config.defaultProfile).toBe('work');

    const calledUserCfg = ensureObject(harness.initMock.mock.calls[0]?.[0]);
    const userConfigSection = ensureObject(calledUserCfg.config);
    const userProfiles = userConfigSection.profiles;
    if (!Array.isArray(userProfiles)) {
      throw new TypeError('Expected user profiles to be an array.');
    }
    const firstUserProfile = ensureObject(userProfiles[0]);
    const firstUserProfileConfig = ensureObject(firstUserProfile.config);
    expect(firstUserProfileConfig.fontSize).toBe(17);
    expect(calledUserCfg.plugins).toEqual(['plugin-alpha']);
    expect(calledUserCfg.localPlugins).toEqual(['plugin-local']);

    const calledDefaultCfg = ensureObject(harness.initMock.mock.calls[0]?.[1]);
    expect(calledDefaultCfg.keymaps).toEqual({'window:new': ['ctrl+n']});
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    expect(harness.notifyMock).not.toHaveBeenCalled();
  } finally {
    harness.cleanup();
  }
});

test('bootstraps missing config with JSON5 output without legacy migration paths', async () => {
  const harness = await createConfigImportHarness();
  try {
    const defaultConfigFixture = `{
    config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
    plugins: ['plugin-a'],
    localPlugins: ['plugin-local'],
    keymaps: {'window:new': 'ctrl+n'}
  }`;
    writeFileSync(harness.mockPaths.defaultCfg, defaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
    writeFileSync(
      path.join(harness.workspaceRoot, '.hyper.js'),
      'module.exports = {plugins: ["legacy-plugin"]};',
      'utf8'
    );

    harness._import();

    expect(existsSync(harness.mockPaths.cfgPath)).toBe(true);
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    expect(harness.notifyMock).not.toHaveBeenCalled();

    const writtenConfig = JSON5.parse(readFileSync(harness.mockPaths.cfgPath, 'utf8'));
    const expectedConfig = JSON5.parse(defaultConfigFixture);
    expect(writtenConfig.plugins).toEqual(['plugin-a']);
    expect(writtenConfig).toEqual(expectedConfig);
  } finally {
    harness.cleanup();
  }
});

test('getDefaultConfig lazily loads and caches the default config', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeFileSync(
      harness.mockPaths.defaultCfg,
      `{
      config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
      plugins: [],
      localPlugins: [],
      keymaps: {}
    }`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{}', 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const result = harness.getDefaultConfig();

    expect(result).toEqual(expect.any(Object));
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(harness.initMock).not.toHaveBeenCalled();
    expect(harness.notifyMock).not.toHaveBeenCalled();

    // Second call must return the same cached object reference.
    const result2 = harness.getDefaultConfig();
    expect(result2).toBe(result);
    expect(harness.initMock).not.toHaveBeenCalled();
  } finally {
    harness.cleanup();
  }
});

test('getDefaultConfig falls back to safe defaults when bundled default config is invalid', async () => {
  const harness = await createConfigImportHarness();
  try {
    // Malformed: plugins is a string rather than an array.
    writeFileSync(harness.mockPaths.defaultCfg, '{plugins: "not-an-array"}', 'utf8');
    // Empty platform keymap so keymaps stays {} after merge.
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{}', 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const result = harness.getDefaultConfig();

    expect(result).toEqual({plugins: [], localPlugins: [], keymaps: {}});
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock.mock.calls[0]?.[0]).toContain('Suggested fix:');
    expect(harness.initMock).not.toHaveBeenCalled();
  } finally {
    harness.cleanup();
  }
});
