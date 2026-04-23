/** @file Verifies JSON5 config import and startup bootstrap without legacy migration. */
import {expect, test} from 'bun:test';

import {join} from 'node:path';

import {existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import type {ConfigImportPaths} from '../../app/config/import';
import {
  createConfigImportHarness,
  ensureObject,
  findDiagnosticsPayloadFromWarnMock,
  sharedDefaultConfigFixture
} from '../testUtils/config-import-harness';

type DiagnosticFallbackTestOptions = {
  userConfigContent: string;
  assertNotification: (message: string, mockPaths: ConfigImportPaths) => void;
  assertPrimaryDiagnostic: (diagnostics: Array<Record<string, unknown>>, mockPaths: ConfigImportPaths) => void;
};

const runDiagnosticFallbackTest = async (options: DiagnosticFallbackTestOptions): Promise<void> => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(harness.mockPaths.cfgPath, options.userConfigContent, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const importedConfig = harness._import();

    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
    options.assertNotification(harness.notifyMock.mock.calls[0]?.[0] as string, harness.mockPaths);
    expect(harness.notifyMock.mock.calls[0]?.[0]).toContain('Suggested fix:');

    const diagnosticsPayload = findDiagnosticsPayloadFromWarnMock(harness.warnMock);
    const diagnostics = diagnosticsPayload.diagnostics.map((d) => ensureObject(d));
    options.assertPrimaryDiagnostic(diagnostics, harness.mockPaths);

    const expectedFallbackConfig = JSON5.parse(sharedDefaultConfigFixture) as Record<string, unknown>;
    expectedFallbackConfig.keymaps = {};
    expect(importedConfig.userCfg).toEqual(expectedFallbackConfig);
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
        const path = typeof d.path === 'string' ? d.path : '';
        const message = typeof d.message === 'string' ? d.message : '';
        return path.includes(mockPaths.cfgPath) && message.includes('JSON5');
      });
      if (!primaryDiagnostic) {
        throw new Error('Expected parse diagnostic for config file path.');
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
    expect(importedConfig).toEqual({
      userCfg: harness.initMock.mock.calls[0]?.[0],
      defaultCfg: harness.initMock.mock.calls[0]?.[1]
    });

    const calledUserCfg = ensureObject(harness.initMock.mock.calls[0]?.[0]);
    const userConfigSection = ensureObject(calledUserCfg.config);
    const userProfiles = userConfigSection.profiles as Array<Record<string, unknown>>;
    const firstUserProfileConfig = ensureObject(userProfiles[0]?.config);
    expect(firstUserProfileConfig.fontSize).toBe(17);
    expect(calledUserCfg.plugins).toEqual(['plugin-alpha']);
    expect(calledUserCfg.localPlugins).toEqual(['plugin-local']);
    expect(calledUserCfg.keymaps).toEqual({'window:close': 'ctrl+w'});

    const calledDefaultCfg = ensureObject(harness.initMock.mock.calls[0]?.[1]);
    expect(calledDefaultCfg.keymaps).toEqual({'window:new': ['ctrl+n']});
    expect(existsSync(join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(true);
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
    writeFileSync(join(harness.workspaceRoot, '.hyper.js'), 'module.exports = {plugins: ["legacy-plugin"]};', 'utf8');

    harness._import();

    expect(existsSync(harness.mockPaths.cfgPath)).toBe(true);
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(true);
    expect(existsSync(join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    expect(harness.notifyMock).not.toHaveBeenCalled();

    const writtenConfig = JSON5.parse(readFileSync(harness.mockPaths.cfgPath, 'utf8'));
    const expectedConfig = JSON5.parse(defaultConfigFixture);
    expect(writtenConfig.plugins).toEqual(['plugin-a']);
    expect(writtenConfig).toEqual(expectedConfig);
    expect(JSON5.parse(readFileSync(harness.mockPaths.keybindingsPath, 'utf8'))).toEqual({});
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

    expect(typeof result).toBe('object');
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    expect(existsSync(join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
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
