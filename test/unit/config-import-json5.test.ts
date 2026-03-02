/** @file Verifies JSON5 config import and startup bootstrap without legacy migration. */
import {afterAll, beforeEach, expect, mock, test} from 'bun:test';

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {existsSync, mkdirpSync, readFileSync, removeSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'velocetty-config-import-'));
const mockPaths = {
  cfgDir: join(workspaceRoot, 'user-config'),
  cfgPath: join(workspaceRoot, 'user-config', 'config.json5'),
  defaultCfg: join(workspaceRoot, 'defaults', 'config-default.json'),
  defaultPlatformKeyPath: () => join(workspaceRoot, 'defaults', 'linux.json'),
  plugs: {
    base: join(workspaceRoot, 'user-config', 'plugins'),
    local: join(workspaceRoot, 'user-config', 'plugins', 'local')
  },
  schemaFile: 'schema.json',
  schemaPath: join(workspaceRoot, 'defaults', 'schema.json')
};

const notifyMock = mock((_message: string) => {});
const initMock = mock((userCfg: unknown, defaultCfg: unknown) => ({userCfg, defaultCfg}));
const warnMock = mock((_message?: unknown, ..._rest: unknown[]) => {});
const originalConsoleWarn = console.warn;

let importCounter = 0;

const ensureObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected object value.');
  }
  return value as Record<string, unknown>;
};

type ParsedDiagnosticsPayload = {
  diagnostics: Array<Record<string, unknown>>;
};

const findDiagnosticsPayload = (): ParsedDiagnosticsPayload => {
  for (const call of warnMock.mock.calls) {
    for (const entry of call) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      if (!('diagnostics' in entry)) {
        continue;
      }
      const diagnostics = (entry as {diagnostics?: unknown}).diagnostics;
      if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
        continue;
      }
      return {diagnostics: diagnostics as Array<Record<string, unknown>>};
    }
  }

  throw new Error('Expected a structured diagnostics payload in warning logs.');
};

const resetWorkspace = () => {
  removeSync(workspaceRoot);
  mkdirpSync(join(workspaceRoot, 'defaults'));
};

mock.module('../../app/config/init', () => ({_init: initMock}));
mock.module('../../app/config/paths', () => mockPaths);
mock.module('../../app/notify', () => ({default: notifyMock}));

const loadConfigImport = async () => {
  importCounter += 1;
  return await import(`../../app/config/import.ts?json5_config_case=${importCounter}`);
};

beforeEach(() => {
  resetWorkspace();
  notifyMock.mockClear();
  initMock.mockClear();
  warnMock.mockClear();
  console.warn = warnMock as typeof console.warn;
});

afterAll(() => {
  console.warn = originalConsoleWarn;
  mock.restore();
  removeSync(workspaceRoot);
});

test.serial('notifies and falls back to default config on invalid JSON5 user config', async () => {
  mkdirpSync(mockPaths.cfgDir);
  const defaultConfigFixture = `{
    config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
    plugins: [],
    localPlugins: [],
    keymaps: {}
  }`;
  writeFileSync(mockPaths.defaultCfg, defaultConfigFixture, 'utf8');
  writeFileSync(mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
  writeFileSync(
    mockPaths.cfgPath,
    `{
      config: { defaultProfile: 'broken' profiles: [{ name: 'broken', config: {} }] },
      plugins: [],
    }`,
    'utf8'
  );
  writeFileSync(mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

  const configModule = await loadConfigImport();
  const importedConfig = configModule._import();

  expect(notifyMock).toHaveBeenCalledTimes(1);
  expect(notifyMock.mock.calls[0]?.[0]).toContain(mockPaths.cfgPath);
  expect(notifyMock.mock.calls[0]?.[0]).toContain('Suggested fix:');

  const diagnosticsPayload = findDiagnosticsPayload();
  const primaryDiagnostic = ensureObject(diagnosticsPayload.diagnostics[0]);
  expect(primaryDiagnostic.path).toContain(mockPaths.cfgPath);
  expect(primaryDiagnostic.message).toContain('JSON5');
  expect(primaryDiagnostic.suggestedFix).toContain('Fix');

  const expectedFallbackConfig = JSON5.parse(defaultConfigFixture) as Record<string, unknown>;
  expectedFallbackConfig.keymaps = {'window:new': ['ctrl+n']};
  expect(importedConfig.userCfg).toEqual(expectedFallbackConfig);
});

test.serial('reports schema validation diagnostics with doc and default hints', async () => {
  mkdirpSync(mockPaths.cfgDir);
  const defaultConfigFixture = `{
    config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
    plugins: [],
    localPlugins: [],
    keymaps: {}
  }`;
  writeFileSync(mockPaths.defaultCfg, defaultConfigFixture, 'utf8');
  writeFileSync(mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
  writeFileSync(
    mockPaths.cfgPath,
    `{
      config: { defaultProfile: 'broken', profiles: [{ name: 'broken', config: {} }] },
      plugins: { not: 'an-array' },
      localPlugins: [],
      keymaps: {}
    }`,
    'utf8'
  );
  writeFileSync(mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

  const configModule = await loadConfigImport();
  const importedConfig = configModule._import();

  expect(notifyMock).toHaveBeenCalledTimes(1);
  expect(notifyMock.mock.calls[0]?.[0]).toContain('/plugins');
  expect(notifyMock.mock.calls[0]?.[0]).toContain('Suggested fix:');

  const diagnosticsPayload = findDiagnosticsPayload();
  const primaryDiagnostic = ensureObject(diagnosticsPayload.diagnostics[0]);
  expect(primaryDiagnostic.path).toBe('/plugins');
  expect(primaryDiagnostic.message).toContain('array of strings');
  expect(primaryDiagnostic.suggestedFix).toContain('array of plugin');
  expect(primaryDiagnostic.defaultHint).toBe('[]');
  expect(primaryDiagnostic.docHint).toContain('plugins');

  const expectedFallbackConfig = JSON5.parse(defaultConfigFixture) as Record<string, unknown>;
  expectedFallbackConfig.keymaps = {'window:new': ['ctrl+n']};
  expect(importedConfig.userCfg).toEqual(expectedFallbackConfig);
});

test.serial('imports user config with JSON5 comments and trailing commas', async () => {
  mkdirpSync(mockPaths.cfgDir);
  writeFileSync(
    mockPaths.defaultCfg,
    `{
      config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
      plugins: [],
      localPlugins: [],
      keymaps: {}
    }`,
    'utf8'
  );
  writeFileSync(mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
  writeFileSync(
    mockPaths.cfgPath,
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
  writeFileSync(mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

  const configModule = await loadConfigImport();
  const importedConfig = configModule._import();

  expect(initMock).toHaveBeenCalledTimes(1);
  expect(importedConfig).toEqual({
    userCfg: initMock.mock.calls[0]?.[0],
    defaultCfg: initMock.mock.calls[0]?.[1]
  });

  const calledUserCfg = ensureObject(initMock.mock.calls[0]?.[0]);
  const userConfigSection = ensureObject(calledUserCfg.config);
  const userProfiles = userConfigSection.profiles as Array<Record<string, unknown>>;
  const firstUserProfileConfig = ensureObject(userProfiles[0]?.config);
  expect(firstUserProfileConfig.fontSize).toBe(17);
  expect(calledUserCfg.plugins).toEqual(['plugin-alpha']);
  expect(calledUserCfg.localPlugins).toEqual(['plugin-local']);

  const calledDefaultCfg = ensureObject(initMock.mock.calls[0]?.[1]);
  expect(calledDefaultCfg.keymaps).toEqual({'window:new': ['ctrl+n']});
  expect(existsSync(join(mockPaths.cfgDir, mockPaths.schemaFile))).toBe(true);
  expect(existsSync(mockPaths.plugs.base)).toBe(true);
  expect(existsSync(mockPaths.plugs.local)).toBe(true);
  expect(notifyMock).not.toHaveBeenCalled();
});

test.serial('bootstraps missing config with JSON5 output without legacy migration paths', async () => {
  const defaultConfigFixture = `{
    config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
    plugins: ['plugin-a'],
    localPlugins: ['plugin-local'],
    keymaps: {'window:new': 'ctrl+n'}
  }`;
  writeFileSync(mockPaths.defaultCfg, defaultConfigFixture, 'utf8');
  writeFileSync(mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
  writeFileSync(mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
  writeFileSync(join(workspaceRoot, '.hyper.js'), 'module.exports = {plugins: ["legacy-plugin"]};', 'utf8');

  const configModule = await loadConfigImport();
  configModule._import();

  expect(existsSync(mockPaths.cfgPath)).toBe(true);
  expect(existsSync(join(mockPaths.cfgDir, mockPaths.schemaFile))).toBe(true);
  expect(existsSync(mockPaths.plugs.base)).toBe(true);
  expect(existsSync(mockPaths.plugs.local)).toBe(true);
  expect(notifyMock).not.toHaveBeenCalled();

  const writtenConfig = JSON5.parse(readFileSync(mockPaths.cfgPath, 'utf8'));
  const expectedConfig = JSON5.parse(defaultConfigFixture);
  expect(writtenConfig.plugins).toEqual(['plugin-a']);
  expect(writtenConfig).toEqual(expectedConfig);
});
