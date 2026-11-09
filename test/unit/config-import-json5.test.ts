/** @file Verifies JSON5 config import and startup bootstrap without legacy migration. */
import {expect, test} from 'bun:test';

import path from 'node:path';

import * as fsExtra from 'fs-extra';
import {existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import type {ConfigImportPaths} from '../../app/config/import';
import type {ConfigImportFileSystem} from '../../app/config/import-sources';
import {createConfigImportHarness, ensureObject, sharedDefaultConfigFixture} from '../testUtils/config-import-harness';

type DiagnosticFallbackTestOptions = {
  userConfigContent: string;
  /**
   * Asserts the user-facing notification.
   *
   * It is the only surface that carries the diagnostic text now: the log keeps
   * a count and closed categories, never a path or a message.
   */
  assertNotification: (message: string, mockPaths: ConfigImportPaths) => void;
};

const runDiagnosticFallbackTest = async (options: DiagnosticFallbackTestOptions): Promise<void> => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(harness.mockPaths.cfgPath, options.userConfigContent, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    harness._import('startup');

    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
    // The call-count assertion above is what establishes the call exists, so
    // the message is read directly rather than checked for absence twice.
    const [notificationMessage] = harness.notifyMock.mock.calls[0];
    options.assertNotification(notificationMessage, harness.mockPaths);
    expect(notificationMessage).toContain('Suggested fix:');

    const expectedFallbackConfig = ensureObject(JSON5.parse(sharedDefaultConfigFixture));
    expectedFallbackConfig.keymaps = {};
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
      // The notification names the file and the JSON5 fault, and carries the
      // suggested fix that the log deliberately omits.
      expect(message).toContain(mockPaths.cfgPath);
      expect(message).toContain('JSON5');
      expect(message).toContain('Fix');
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
      // The notification carries the primary diagnostic's path, message,
      // suggested fix, and both hints in one sentence.
      expect(message).toContain('/plugins');
      expect(message).toContain('array of strings');
      expect(message).toContain('array of plugin');
      expect(message).toContain('Default: []');
      expect(message).toContain('Hint:');
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
      expect(message).toContain('number');
      expect(message).toContain('documented types');
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

    const importedConfig = harness._import('startup');

    expect(harness.initMock).toHaveBeenCalledTimes(1);
    expect(importedConfig.config.config.defaultProfile).toBe('work');
    expect(importedConfig.report).toEqual({config: 'applied', keybindings: 'applied'});

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
    expect(calledUserCfg.keymaps).toEqual({'window:close': 'ctrl+w'});

    const calledDefaultCfg = ensureObject(harness.initMock.mock.calls[0]?.[1]);
    expect(calledDefaultCfg.keymaps).toEqual({'window:new': ['ctrl+n']});
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    // Start-up seeds the new file from the legacy keymaps, which is a
    // one-time migration the user should hear about.
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock.mock.calls[0]?.[0]).toBe('Shortcuts moved to keybindings.json5');
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

    harness._import('startup');

    expect(existsSync(harness.mockPaths.cfgPath)).toBe(true);
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(true);
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(true);
    expect(existsSync(path.join(harness.mockPaths.keybindingsDir, harness.mockPaths.keybindingsSchemaFile))).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(true);
    // A freshly created config has no shortcuts to migrate, so this only
    // announces the new file.
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock.mock.calls[0]?.[0]).toBe('Shortcuts moved to keybindings.json5');

    const writtenConfig = JSON5.parse(readFileSync(harness.mockPaths.cfgPath, 'utf8'));
    const expectedConfig = JSON5.parse(defaultConfigFixture);
    // Shortcuts belong in `keybindings.json5`; a copy here would be ignored on
    // the next launch and reported as an ignored setting, so the bootstrap
    // template carries none even though the runtime defaults still have them.
    expectedConfig.keymaps = {};
    expect(writtenConfig.plugins).toEqual(['plugin-a']);
    expect(writtenConfig).toEqual(expectedConfig);
    // The file carries no shortcuts, but the platform bindings still reach the
    // running configuration through the defaults layer.
    expect(harness.initMock.mock.calls[0]?.[1]).toMatchObject({keymaps: {'window:new': ['ctrl+n']}});
    expect(JSON5.parse(readFileSync(harness.mockPaths.keybindingsPath, 'utf8'))).toEqual({});
  } finally {
    harness.cleanup();
  }
});

test('start-up creates no config file when the active path could not be inspected', async () => {
  const harness = await createConfigImportHarness({configInspection: 'inaccessible'});
  try {
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{}', 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    harness._import('startup');

    // A file we could not read may already hold the user's configuration, so
    // bootstrapping would replace it rather than fill a gap.
    expect(existsSync(harness.mockPaths.cfgPath)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('getDefaultConfig reads and caches the defaults without writing', async () => {
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

    expect(result.defaults).toEqual(expect.any(Object));
    expect(result.failure).toBeUndefined();
    expect(result.platformKeymapFault).toBe(false);
    // A query is read-only: no plugin directories, schema copy, or user file.
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(false);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(false);
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(false);
    expect(existsSync(harness.mockPaths.cfgPath)).toBe(false);
    expect(harness.initMock).not.toHaveBeenCalled();
    expect(harness.notifyMock).not.toHaveBeenCalled();

    // A second query returns an equal defensive copy of the cached payload.
    const result2 = harness.getDefaultConfig();
    expect(result2).toEqual(result);
    expect(result2).not.toBe(result);
    expect(harness.initMock).not.toHaveBeenCalled();
  } finally {
    harness.cleanup();
  }
});

test('getDefaultConfig performs zero writes through the injected filesystem', async () => {
  const writeCounts = {copy: 0, mkdirp: 0, writeFile: 0};
  const recordingFileSystem: ConfigImportFileSystem = {
    ...fsExtra,
    copySync: (...args) => {
      writeCounts.copy += 1;
      fsExtra.copySync(...args);
    },
    mkdirpSync: (directory) => {
      writeCounts.mkdirp += 1;
      fsExtra.mkdirpSync(directory);
    },
    writeFileSync: (...args) => {
      writeCounts.writeFile += 1;
      fsExtra.writeFileSync(...args);
    }
  };
  const harness = await createConfigImportHarness({fs: recordingFileSystem});
  try {
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const defaults = harness.getDefaultConfig();

    expect(defaults.defaults).toEqual(expect.any(Object));
    // The recording double is the proof: the query made no directory, copied
    // no schema, and wrote no file.
    expect(writeCounts).toEqual({copy: 0, mkdirp: 0, writeFile: 0});
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(false);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(false);
    expect(existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile))).toBe(false);
    expect(existsSync(harness.mockPaths.cfgPath)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('getDefaultConfig returns the same defaults before and after a start-up import', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const before = harness.getDefaultConfig();
    harness._import('startup');
    const after = harness.getDefaultConfig();

    expect(after).toEqual(before);
    expect(after.defaults.keymaps).toEqual({'window:new': ['ctrl+n']});
  } finally {
    harness.cleanup();
  }
});
