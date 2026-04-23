/** @file Verifies config-import behaviour that is specific to keybindings.json5 storage. */
import {expect, test} from 'bun:test';

import {mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import {createConfigImportHarness, ensureObject, sharedDefaultConfigFixture} from '../testUtils/config-import-harness';

test('prefers keybindings.json5 over legacy config keymaps when both exist', async () => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(
      harness.mockPaths.cfgPath,
      `{
        config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
        plugins: [],
        localPlugins: [],
        keymaps: {'window:close': 'ctrl+w'}
      }`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.keybindingsPath, `{'window:close': 'ctrl+shift+w'}`, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    harness._import();

    const calledUserCfg = ensureObject(harness.initMock.mock.calls[0]?.[0]);
    expect(calledUserCfg.keymaps).toEqual({'window:close': 'ctrl+shift+w'});
    expect(JSON5.parse(readFileSync(harness.mockPaths.keybindingsPath, 'utf8'))).toEqual({
      'window:close': 'ctrl+shift+w'
    });
  } finally {
    harness.cleanup();
  }
});

test('bootstraps keybindings.json5 from legacy config keymaps when the new file is missing', async () => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(
      harness.mockPaths.cfgPath,
      `{
        config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
        plugins: [],
        localPlugins: [],
        keymaps: {'window:close': ['ctrl+w', 'cmd+w']}
      }`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    harness._import();

    expect(JSON5.parse(readFileSync(harness.mockPaths.keybindingsPath, 'utf8'))).toEqual({
      'window:close': ['ctrl+w', 'cmd+w']
    });
    const calledUserCfg = ensureObject(harness.initMock.mock.calls[0]?.[0]);
    expect(calledUserCfg.keymaps).toEqual({'window:close': ['ctrl+w', 'cmd+w']});
  } finally {
    harness.cleanup();
  }
});

test('keeps the last known good keybindings when keybindings.json5 becomes invalid', async () => {
  const harness = await createConfigImportHarness();
  try {
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{"window:new": ["ctrl+n"]}`, 'utf8');
    writeFileSync(
      harness.mockPaths.cfgPath,
      `{
        config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
        plugins: [],
        localPlugins: [],
        keymaps: {'window:close': 'ctrl+w'}
      }`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    harness._import();
    writeFileSync(harness.mockPaths.keybindingsPath, `{'window:close': 'ctrl+w'`, 'utf8');

    harness._import();

    const calledUserCfg = ensureObject(harness.initMock.mock.calls[1]?.[0]);
    expect(calledUserCfg.keymaps).toEqual({'window:close': 'ctrl+w'});
    expect(harness.notifyMock.mock.calls.at(-1)?.[0]).toContain('Keeping the last known good keybindings');
  } finally {
    harness.cleanup();
  }
});
