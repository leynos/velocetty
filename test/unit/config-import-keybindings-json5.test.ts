/** @file Verifies KB-SVC-3: start-up may seed once, reload writes nothing at all. */
import {expect, test} from 'bun:test';

import {existsSync, mkdirpSync, readFileSync, removeSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import {describeImportDecision, shouldAnnounceReload} from '../../app/config/import-report';
import {
  configBytesUnchanged,
  createConfigImportHarness,
  type ConfigImportHarness,
  sharedDefaultConfigFixture,
  snapshotConfigBytes
} from '../testUtils/config-import-harness';

const userConfigWithKeymaps = (keymaps: string): string => `{
  config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
  plugins: [],
  localPlugins: [],
  keymaps: ${keymaps}
}`;

/** Builds one decision record for the table below without repeating the shape. */
const describeDecision = (
  phase: 'reload' | 'startup',
  config: 'applied' | 'fallback',
  keybindings: Parameters<typeof describeImportDecision>[0]['keybindings'],
  announced = false
) => describeImportDecision({announced, config, keybindings, phase});

/** Writes the bundled defaults and an empty platform keymap to isolate user keymaps. */
const writeDefaultSources = (harness: ConfigImportHarness) => {
  writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
  writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{}', 'utf8');
  writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
};

test('prefers keybindings.json5 over legacy keymaps and stores its text verbatim', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');
    const storedText = `// user formatting survives\n{'window:close': 'ctrl+shift+w',}`;
    writeFileSync(harness.mockPaths.keybindingsPath, storedText, 'utf8');
    const configBefore = snapshotConfigBytes(harness.mockPaths);

    const {config, report} = harness._import('startup');

    expect(config.keymaps).toEqual({'window:close': ['ctrl+shift+w']});
    expect(harness.initMock.mock.calls[0]?.[0]).toMatchObject({
      keymaps: {'window:close': 'ctrl+shift+w'}
    });
    expect(readFileSync(harness.mockPaths.keybindingsPath, 'utf8')).toBe(storedText);
    expect(configBytesUnchanged(harness.mockPaths, configBefore)).toBe(true);
    expect(report).toEqual({config: 'applied', keybindings: 'applied'});
    // The legacy keymaps are readable, so the user is told once that the file wins.
    expect(harness.notifyMock.mock.calls[0]?.[0]).toBe('Shortcuts in config.json5 are ignored');
  } finally {
    harness.cleanup();
  }
});

test('seeds keybindings.json5 from legacy keymaps when the new file is missing', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': ['ctrl+w', 'alt+w']}`), 'utf8');
    const configBefore = snapshotConfigBytes(harness.mockPaths);

    const {config, report} = harness._import('startup');

    expect(JSON5.parse(readFileSync(harness.mockPaths.keybindingsPath, 'utf8'))).toEqual({
      'window:close': ['ctrl+w', 'alt+w']
    });
    expect(config.keymaps).toEqual({'window:close': ['ctrl+w', 'alt+w']});
    expect(configBytesUnchanged(harness.mockPaths, configBefore)).toBe(true);
    expect(report).toEqual({config: 'applied', keybindings: 'applied'});
    expect(harness.notifyMock.mock.calls[0]?.[0]).toBe('Shortcuts moved to keybindings.json5');
  } finally {
    harness.cleanup();
  }
});

test('does not announce a completed migration when the seed write fails', async () => {
  const harness = await createConfigImportHarness({failSeedWrite: true});
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');

    const {config, report} = harness._import('startup');

    // The seed still applies in memory, so the session keeps the shortcuts...
    expect(config.keymaps).toEqual({'window:close': ['ctrl+w']});
    expect(report).toEqual({config: 'applied', keybindings: 'applied'});
    // ...but nothing was migrated on disk, so only the failure is reported.
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(false);
    const titles = harness.notifyMock.mock.calls.map((call) => call[0]);
    expect(titles.some((title) => title.includes("Couldn't create a keybindings file"))).toBe(true);
    expect(titles).not.toContain('Shortcuts moved to keybindings.json5');
  } finally {
    harness.cleanup();
  }
});

test('keeps the last known good keymaps when the file becomes invalid', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    // The legacy keymaps differ from the file, so returning them would be a
    // visible regression rather than a coincidence.
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');
    const storedKeymaps = `{'window:new': 'ctrl+shift+n'}`;
    writeFileSync(harness.mockPaths.keybindingsPath, storedKeymaps, 'utf8');

    harness._import('startup');
    const configBefore = snapshotConfigBytes(harness.mockPaths);

    writeFileSync(harness.mockPaths.keybindingsPath, `{'window:new': 'ctrl+shift+n'`, 'utf8');
    const {config, report} = harness._import('reload');

    expect(config.keymaps).toEqual({'window:new': ['ctrl+shift+n']});
    expect(harness.initMock.mock.calls[1]?.[0]).toMatchObject({
      keymaps: {'window:new': 'ctrl+shift+n'}
    });
    expect(report).toEqual({config: 'applied', keybindings: 'kept'});
    expect(shouldAnnounceReload(report)).toBe(false);
    expect(configBytesUnchanged(harness.mockPaths, configBefore)).toBe(true);
    const lastMessage = harness.notifyMock.mock.calls.at(-1)?.[0] ?? '';
    expect(lastMessage).toContain("Couldn't parse keybindings file.");
    expect(lastMessage).toContain('Keeping your previous shortcuts.');
  } finally {
    harness.cleanup();
  }
});

test('a mid-session delete followed by reload leaves no keybindings file', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{}`), 'utf8');
    writeFileSync(harness.mockPaths.keybindingsPath, `{'window:new': 'ctrl+n'}`, 'utf8');

    harness._import('startup');
    removeSync(harness.mockPaths.keybindingsPath);

    const {config, report} = harness._import('reload');

    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(false);
    expect(config.keymaps).toEqual({});
    expect(report).toEqual({config: 'applied', keybindings: 'applied'});
    expect(shouldAnnounceReload(report)).toBe(true);
  } finally {
    harness.cleanup();
  }
});

test('a reload recreates neither config.json5 nor the plugin directories', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{}`), 'utf8');

    harness._import('startup');
    removeSync(harness.mockPaths.cfgPath);
    removeSync(harness.mockPaths.plugs.base);

    harness._import('reload');

    expect(existsSync(harness.mockPaths.cfgPath)).toBe(false);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(false);
    expect(existsSync(harness.mockPaths.plugs.local)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('an active Hyper tree never has config.json5 created for it', async () => {
  const harness = await createConfigImportHarness({hyperTree: true});
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);

    harness._import('startup');

    expect(existsSync(harness.mockPaths.cfgPath)).toBe(false);
    // Start-up may still create the plugin directories the active tree uses.
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(true);

    // Remove the whole Hyper tree; a reload must not recreate either.
    removeSync(harness.mockPaths.cfgDir);
    harness._import('reload');

    expect(existsSync(harness.mockPaths.cfgPath)).toBe(false);
    expect(existsSync(harness.mockPaths.plugs.base)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('a Hyper tree seeds keybindings in the Velocetty tree and keeps them on reload', async () => {
  const harness = await createConfigImportHarness({hyperTree: true});
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');

    harness._import('startup');
    const keybindingsInVelocettyTree = harness.mockPaths.keybindingsPath;
    expect(existsSync(keybindingsInVelocettyTree)).toBe(true);

    removeSync(harness.mockPaths.cfgDir);
    const {report} = harness._import('reload');

    expect(existsSync(keybindingsInVelocettyTree)).toBe(true);
    expect(report).toEqual({config: 'fallback', keybindings: 'applied'});
    expect(shouldAnnounceReload(report)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('announces a reload only when a file applied and none fell back', () => {
  expect(shouldAnnounceReload({config: 'applied', keybindings: 'applied'})).toBe(true);
  expect(shouldAnnounceReload({config: 'applied', keybindings: 'unchanged'})).toBe(true);
  expect(shouldAnnounceReload({config: 'fallback', keybindings: 'applied'})).toBe(false);
  expect(shouldAnnounceReload({config: 'applied', keybindings: 'kept'})).toBe(false);
  expect(shouldAnnounceReload({config: 'fallback', keybindings: 'unchanged'})).toBe(false);
});

test('describes each import decision in the outcome vocabulary', () => {
  expect(describeDecision('reload', 'applied', {keymaps: {}, kind: 'applied', origin: 'file'}, true)).toBe(
    'phase=reload config=applied keybindings=applied origin=file announced=true'
  );
  // A seed and an empty file are applications too, so `origin` separates them.
  expect(describeDecision('startup', 'applied', {keymaps: {}, kind: 'applied', origin: 'seeded'})).toBe(
    'phase=startup config=applied keybindings=applied origin=seeded announced=false'
  );
  expect(describeDecision('startup', 'applied', {keymaps: {}, kind: 'applied', origin: 'seeded-unsaved'})).toBe(
    'phase=startup config=applied keybindings=applied origin=seeded-unsaved announced=false'
  );
  // The kept states carry the basis and the cause, so a parse failure, a read
  // failure, and a deferred bootstrap are three distinct records rather than
  // one indistinguishable "kept".
  expect(
    describeDecision('reload', 'applied', {
      basis: 'last-known-good',
      cause: 'invalid',
      diagnostics: [],
      keymaps: {},
      kind: 'kept'
    })
  ).toBe('phase=reload config=applied keybindings=kept basis=last-known-good cause=invalid announced=false');
  expect(
    describeDecision('reload', 'applied', {
      basis: 'empty',
      cause: 'unreadable',
      diagnostics: [],
      keymaps: {},
      kind: 'kept'
    })
  ).toBe('phase=reload config=applied keybindings=kept basis=empty cause=unreadable announced=false');
  expect(
    describeDecision('reload', 'fallback', {
      basis: 'last-known-good',
      cause: 'deferred',
      diagnostics: [],
      keymaps: {},
      kind: 'kept'
    })
  ).toBe('phase=reload config=fallback keybindings=kept basis=last-known-good cause=deferred announced=false');
});
