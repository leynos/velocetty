/** @file Verifies KB-SVC-3: start-up may seed once, reload writes nothing at all. */
import {expect, test} from 'bun:test';

import {existsSync, mkdirpSync, readFileSync, removeSync, writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import type {ConfigImportKeybindings} from '../../app/config/import';
import {describeImportDecision, shouldAnnounceReload} from '../../app/config/import-report';
import type {KeybindingsLoadOutcome} from '../../app/config/keybindings-ports';
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
) => describeImportDecision({announced, config, configSource: 'velocetty', keybindings, phase});

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

test('announces a deferred migration when an invalid legacy keymaps value blocks the seed', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    // The legacy value passes the raw-config schema but fails the codec, so
    // start-up has nothing it can safely seed.
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'': 'ctrl+n'}`), 'utf8');

    const {report} = harness._import('startup');

    // A deferred bootstrap leaves the file absent, which the report calls
    // `unchanged` rather than `kept`: there was nothing to keep.
    expect(report).toEqual({config: 'applied', keybindings: 'unchanged'});
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(false);
    const titles = harness.notifyMock.mock.calls.map((call) => call[0]);
    expect(titles.some((title) => title.startsWith("Couldn't move shortcuts to keybindings.json5."))).toBe(true);
  } finally {
    harness.cleanup();
  }
});

test('does not announce a deferred migration when the keybindings file already exists', async () => {
  const harness = await createConfigImportHarness();
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'': 'ctrl+n'}`), 'utf8');
    const storedKeymaps = `{'window:new': 'ctrl+n'}`;
    writeFileSync(harness.mockPaths.keybindingsPath, storedKeymaps, 'utf8');

    const {config, report} = harness._import('startup');

    expect(config.keymaps).toEqual({'window:new': ['ctrl+n']});
    expect(report).toEqual({config: 'applied', keybindings: 'applied'});
    expect(readFileSync(harness.mockPaths.keybindingsPath, 'utf8')).toBe(storedKeymaps);
    // Nothing was deferred: the file wins, so "fix the keymaps" would promise a
    // migration that cannot happen.
    const titles = harness.notifyMock.mock.calls.map((call) => call[0]);
    expect(titles.some((title) => title.startsWith("Couldn't move shortcuts"))).toBe(false);
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

test('announces the hidden configuration copies once, at start-up only', async () => {
  const shadowed = ['/home/user/.hyper/config.json5'];
  const harness = await createConfigImportHarness({hyperTree: true, shadowedConfigPaths: shadowed});
  try {
    writeDefaultSources(harness);
    mkdirpSync(harness.mockPaths.cfgDir);
    writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps('{}'), 'utf8');

    harness._import('startup');
    harness._import('reload');

    // The notice belongs to start-up; a reload must not repeat it.
    const shadowedNotices = harness.notifyMock.mock.calls.filter(
      ([title]) => title === 'Using the active configuration'
    );
    expect(shadowedNotices).toHaveLength(1);
    expect(shadowedNotices[0]?.[1]).toContain('/home/user/.hyper/config.json5');
  } finally {
    harness.cleanup();
  }
});

/** One start-up notice and the state that produces it. */
type NoticeScenario = {
  readonly label: string;
  readonly notices: readonly string[];
  readonly options: Parameters<typeof createConfigImportHarness>[0];
  readonly prepare: (harness: ConfigImportHarness) => void;
};

/**
 * The four start-up notices, each reachable through the same importer.
 *
 * The guards live in the notice factory, so one importer must not repeat a
 * notice when a reload runs the same reporting path again.
 */
const noticeScenarios: readonly NoticeScenario[] = [
  {
    label: 'seeded',
    notices: ['Shortcuts moved to keybindings.json5'],
    options: {},
    prepare: (harness) => {
      writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');
    }
  },
  {
    label: 'deferred',
    notices: ["Couldn't move shortcuts to keybindings.json5."],
    options: {},
    prepare: (harness) => {
      writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'': 'ctrl+n'}`), 'utf8');
    }
  },
  {
    label: 'legacy-ignored',
    notices: ['Shortcuts in config.json5 are ignored'],
    options: {},
    prepare: (harness) => {
      writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');
      writeFileSync(harness.mockPaths.keybindingsPath, `{'window:new': 'ctrl+n'}`, 'utf8');
    }
  },
  {
    label: 'shadowed',
    notices: ['Using the active configuration'],
    options: {shadowedConfigPaths: ['/home/user/.hyper/config.json5']},
    prepare: () => {}
  }
];

test('one importer announces each start-up notice at most once across reloads', async () => {
  for (const scenario of noticeScenarios) {
    const harness = await createConfigImportHarness(scenario.options);
    try {
      writeDefaultSources(harness);
      mkdirpSync(harness.mockPaths.cfgDir);
      scenario.prepare(harness);

      harness._import('startup');
      harness._import('reload');
      harness._import('reload');

      const titles = harness.notifyMock.mock.calls.map(([title]) => title);
      for (const expected of scenario.notices) {
        // The deferred notice appends diagnostics, so only its opening is fixed.
        const matching = titles.filter((title) => title === expected || title.startsWith(expected));
        expect(matching, `${scenario.label}: ${expected}`).toHaveLength(1);
      }
    } finally {
      harness.cleanup();
    }
  }
});

/** A keybindings double that returns the same outcome for every import. */
const repeatingKeybindings = (outcome: KeybindingsLoadOutcome): ConfigImportKeybindings => ({
  reload: () => outcome,
  start: () => outcome
});

/** One recorded notification, in the shape the mock stores its arguments. */
type NotifyCall = [title: string, body?: string, details?: {error?: unknown}];

/** One notice scenario driven through a scripted keybindings double. */
type NoticeGuardScenario = {
  readonly expected: NotifyCall[];
  readonly label: string;
  readonly options: Parameters<typeof createConfigImportHarness>[0];
  readonly outcome: KeybindingsLoadOutcome;
  readonly prepare: (harness: ConfigImportHarness) => void;
};

/**
 * The four notices, each produced by a double that repeats its outcome.
 *
 * The real service changes what it reports on a second import, so only a
 * double can show that the guard, rather than the service, suppresses a
 * repeat. Start-up is repeated because the shadowed notice is reachable only
 * from that phase.
 */
const noticeGuardScenarios: readonly NoticeGuardScenario[] = [
  {
    expected: [
      [
        'Shortcuts moved to keybindings.json5',
        'Your shortcuts now live in keybindings.json5. The keymaps key in config.json5 is no longer read.'
      ]
    ],
    label: 'seeded',
    options: {},
    outcome: {keymaps: {'window:close': 'ctrl+w'}, kind: 'applied', origin: 'seeded'},
    prepare: (harness) => {
      writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');
    }
  },
  {
    expected: [
      [
        'Couldn\'t move shortcuts to keybindings.json5. Fix the keymaps in config.json5 to migrate them. /: Invalid command identifier "": it must be non-empty and carry no leading or trailing whitespace. Suggested fix: Remove the surrounding whitespace or rename the command.'
      ]
    ],
    label: 'deferred',
    options: {},
    outcome: {basis: 'empty', cause: 'deferred', diagnostics: [], keymaps: {}, kind: 'kept'},
    prepare: (harness) => {
      writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'': 'ctrl+n'}`), 'utf8');
    }
  },
  {
    expected: [
      [
        'Shortcuts in config.json5 are ignored',
        'keybindings.json5 takes precedence, so the keymaps key in config.json5 is not used.'
      ]
    ],
    label: 'legacy-ignored',
    options: {},
    outcome: {keymaps: {'window:close': 'ctrl+w'}, kind: 'applied', origin: 'file'},
    prepare: (harness) => {
      writeFileSync(harness.mockPaths.cfgPath, userConfigWithKeymaps(`{'window:close': 'ctrl+w'}`), 'utf8');
    }
  },
  {
    expected: [
      ['Using the active configuration', 'Ignoring the lower-priority copy at /home/user/.hyper/config.json5.']
    ],
    label: 'shadowed',
    options: {shadowedConfigPaths: ['/home/user/.hyper/config.json5']},
    outcome: {keymaps: {}, kind: 'applied', origin: 'file'},
    prepare: () => {}
  }
];

test('repeated start-ups through one importer announce each notice once', async () => {
  for (const scenario of noticeGuardScenarios) {
    const harness = await createConfigImportHarness({
      ...scenario.options,
      keybindings: repeatingKeybindings(scenario.outcome)
    });
    try {
      writeDefaultSources(harness);
      mkdirpSync(harness.mockPaths.cfgDir);
      scenario.prepare(harness);

      harness._import('startup');
      harness._import('startup');
      harness._import('reload');

      // The complete argument list is asserted, so a changed body or a second
      // notification fails rather than passing on a title prefix.
      expect(harness.notifyMock.mock.calls, scenario.label).toEqual(scenario.expected);
    } finally {
      harness.cleanup();
    }
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
    // The Hyper tree is gone, so the reload reports a read fallback and says so.
    expect(report).toEqual({config: 'fallback', configCause: 'read', keybindings: 'applied'});
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
    'phase=reload config=applied configSource=velocetty keybindings=applied origin=file announced=true'
  );
  // A seed and an empty file are applications too, so `origin` separates them.
  expect(describeDecision('startup', 'applied', {keymaps: {}, kind: 'applied', origin: 'seeded'})).toBe(
    'phase=startup config=applied configSource=velocetty keybindings=applied origin=seeded announced=false'
  );
  expect(describeDecision('startup', 'applied', {keymaps: {}, kind: 'applied', origin: 'seeded-unsaved'})).toBe(
    'phase=startup config=applied configSource=velocetty keybindings=applied origin=seeded-unsaved announced=false'
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
  ).toBe(
    'phase=reload config=applied configSource=velocetty keybindings=kept basis=last-known-good cause=invalid announced=false'
  );
  expect(
    describeDecision('reload', 'applied', {
      basis: 'empty',
      cause: 'unreadable',
      diagnostics: [],
      keymaps: {},
      kind: 'kept'
    })
  ).toBe(
    'phase=reload config=applied configSource=velocetty keybindings=kept basis=empty cause=unreadable announced=false'
  );
  expect(
    describeDecision('reload', 'fallback', {
      basis: 'last-known-good',
      cause: 'deferred',
      diagnostics: [],
      keymaps: {},
      kind: 'kept'
    })
  ).toBe(
    'phase=reload config=fallback configSource=velocetty keybindings=kept basis=last-known-good cause=deferred announced=false'
  );
});
