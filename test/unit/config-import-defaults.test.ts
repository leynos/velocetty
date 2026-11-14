/** @file Verifies the read-only default query and the injected schema copy. */
import {expect, mock, test} from 'bun:test';

import path from 'node:path';

import * as fsExtra from 'fs-extra';
import {writeFileSync} from 'fs-extra';
import JSON5 from 'json5';

import type {ConfigImportFileSystem} from '../../app/config/import-sources';
import {
  createConfigImportHarness,
  ensureObject,
  sharedDefaultConfigFixture,
  type ConfigImportHarness
} from '../testUtils/config-import-harness';

/** The notifications that concern the bundled defaults, not other start-up notices. */
const bundledDefaultNotices = (notifyMock: ConfigImportHarness['notifyMock']): string[] =>
  notifyMock.mock.calls.map(([message]) => message).filter((message) => message.includes('bundled default config'));

/** Writes the bundled artifacts the loader reads, with an empty keymap. */
const seedBundledFiles = (harness: ConfigImportHarness, defaultConfig?: string): void => {
  // Omitting the default file leaves it absent, which is the unreadable case.
  if (defaultConfig !== undefined) {
    writeFileSync(harness.mockPaths.defaultCfg, defaultConfig, 'utf8');
  }
  writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{}', 'utf8');
  writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
};

// A valid bundled file applies; a read or parse fault falls back and is
// announced once at start-up, with the fault named in the message.
const bundledDefaultCases = [
  {
    announces: false,
    description: 'valid',
    expected: {...ensureObject(JSON5.parse(sharedDefaultConfigFixture)), keymaps: {}},
    seed: sharedDefaultConfigFixture
  },
  {
    announces: true,
    description: 'invalid',
    expected: {plugins: [], localPlugins: [], keymaps: {}},
    fault: 'parse' as const,
    seed: '{plugins: "not-an-array"}'
  },
  {
    announces: true,
    description: 'unreadable',
    expected: {plugins: [], localPlugins: [], keymaps: {}},
    fault: 'read' as const,
    seed: undefined
  }
];

test('getDefaultConfig reports a fault without notifying, before and after start-up', async () => {
  for (const {announces, description, expected, fault, seed} of bundledDefaultCases) {
    const errorMock = mock<typeof console.error>(() => {});
    const harness = await createConfigImportHarness({error: errorMock});
    try {
      seedBundledFiles(harness, seed);

      const queried = harness.getDefaultConfig();
      expect(queried.defaults, description).toEqual(expected);
      // The query reports the fault instead of hiding it, without notifying.
      expect(queried.failure, description).toBe(fault);
      expect(bundledDefaultNotices(harness.notifyMock), description).toEqual([]);
      // A query must not reach the warning or error sinks either: only the
      // start-up command turns a fault into a log line.
      expect(harness.warnMock, description).not.toHaveBeenCalled();
      expect(errorMock, description).not.toHaveBeenCalled();

      harness._import('startup');

      // Start-up is the command that acts on the fault, so it announces it once,
      // naming whether the file could not be read or could not be parsed.
      const notices = bundledDefaultNotices(harness.notifyMock);
      expect(notices, description).toHaveLength(announces ? 1 : 0);
      if (fault !== undefined) {
        expect(notices[0], description).toContain(`Couldn't ${fault} the bundled default config`);
      }
      // Start-up is the boundary that logs the fault, once.
      const loggedFaults = errorMock.mock.calls.filter(([message]) =>
        String(message).includes(`Failed to ${fault ?? 'read'} the bundled default config`)
      );
      expect(loggedFaults, description).toHaveLength(fault === undefined ? 0 : 1);
      expect(harness.getDefaultConfig().defaults, description).toEqual(expected);
      expect(bundledDefaultNotices(harness.notifyMock), description).toHaveLength(announces ? 1 : 0);
    } finally {
      harness.cleanup();
    }
  }
});

test('start-up applies a source change a successful query did not see', async () => {
  const harness = await createConfigImportHarness({error: mock<typeof console.error>(() => {})});
  try {
    seedBundledFiles(harness, sharedDefaultConfigFixture);
    const queried = harness.getDefaultConfig();
    expect(queried.failure).toBeUndefined();

    // The shipped file is replaced between the query and start-up. Start-up is
    // the authority on what is in effect, so it must apply what the file holds
    // now rather than the snapshot the earlier query returned.
    const changed = `{
      config: { defaultProfile: 'changed', profiles: [{ name: 'default', config: {} }] },
      plugins: [],
      localPlugins: [],
      keymaps: {}
    }`;
    writeFileSync(harness.mockPaths.defaultCfg, changed, 'utf8');
    harness._import('startup');

    const expected = {...ensureObject(JSON5.parse(changed)), keymaps: {}};
    expect(harness.initMock.mock.calls[0]?.[1]).toEqual(expected);
    // The bootstrapped file records the same change, so start-up neither
    // reused the earlier snapshot nor wrote it through to the user's config.
    expect(JSON5.parse(fsExtra.readFileSync(harness.mockPaths.cfgPath, 'utf8'))).toEqual(expected);
    // The query reflects the replacement too: nothing links it to the earlier
    // read, so it cannot mask a start-up that ignored the change.
    expect(harness.getDefaultConfig().defaults).toEqual(expected);
  } finally {
    harness.cleanup();
  }
});

// A shipped file can fail to be read or to be parsed. Repairing either must be
// enough for a start-up that runs afterwards: start-up reads the file itself,
// so recovery never depends on a query having refreshed a cached payload.
const defaultConfigRepairCases = [
  {description: 'unreadable', seed: undefined},
  {description: 'invalid', seed: '{plugins: "not-an-array"}'}
] as const;

test('start-up after a repaired default-config fault applies the repaired file', async () => {
  for (const {description, seed} of defaultConfigRepairCases) {
    const harness = await createConfigImportHarness({error: mock<typeof console.error>(() => {})});
    try {
      // A query observes the fault first, so recovery cannot rest on a later
      // query refreshing a cache: start-up is the reader that must recover.
      seedBundledFiles(harness, seed);
      const faulted = harness.getDefaultConfig();
      expect(faulted.failure, description).toBe(seed === undefined ? 'read' : 'parse');
      writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');

      const {writtenFiles} = harness._import('startup');

      const expected = {...ensureObject(JSON5.parse(sharedDefaultConfigFixture)), keymaps: {}};
      expect(harness.initMock.mock.calls[0]?.[1], description).toEqual(expected);
      // The bootstrapped file carries the repaired defaults, without the
      // platform keymaps that belong in `keybindings.json5`.
      const bootstrappedText = fsExtra.readFileSync(harness.mockPaths.cfgPath, 'utf8');
      expect(JSON5.parse(bootstrappedText), description).toEqual(expected);
      // The baseline may settle the file start-up created, but only against
      // the text this import read back and applied. A fresh bootstrap also
      // seeds `keybindings.json5`, so the list is not only this entry.
      expect(writtenFiles, description).toContainEqual({path: harness.mockPaths.cfgPath, text: bootstrappedText});
      // The fault is gone, so start-up neither announced nor logged one.
      expect(bundledDefaultNotices(harness.notifyMock), description).toEqual([]);
      expect(harness.getDefaultConfig().failure, description).toBeUndefined();
    } finally {
      harness.cleanup();
    }
  }
});

// The safe fallback is the configuration a faulted bundled file leaves in
// effect, and start-up applies it. It must not be written to `config.json5`:
// that file is bootstrapped once, so a degraded template persisted now would
// stay the user's configuration after the installation was repaired. The fault
// is still announced once, so the fallback is visible rather than silent.
const fallbackBootstrapCases = [
  {description: 'unreadable', seed: undefined},
  {description: 'invalid', seed: '{plugins: "not-an-array"}'}
] as const;

test('start-up with a faulted bundled default applies the fallback without persisting it', async () => {
  for (const {description, seed} of fallbackBootstrapCases) {
    const harness = await createConfigImportHarness({error: mock<typeof console.error>(() => {})});
    try {
      seedBundledFiles(harness, seed);

      const {writtenFiles} = harness._import('startup');

      const fallback = {plugins: [], localPlugins: [], keymaps: {}};
      expect(harness.initMock.mock.calls[0]?.[1], description).toEqual(fallback);
      // Leaving the file absent is what lets a repaired installation create it
      // from valid defaults, which the next test exercises.
      expect(fsExtra.existsSync(harness.mockPaths.cfgPath), description).toBe(false);
      // Start-up wrote nothing, so there is no file for the baseline to settle.
      expect(writtenFiles, description).toEqual([]);
      expect(bundledDefaultNotices(harness.notifyMock), description).toHaveLength(1);
    } finally {
      harness.cleanup();
    }
  }
});

test('a repaired bundled default bootstraps the user config on a later start-up', async () => {
  for (const {description, seed} of fallbackBootstrapCases) {
    const harness = await createConfigImportHarness({error: mock<typeof console.error>(() => {})});
    try {
      seedBundledFiles(harness, seed);
      harness._import('startup');
      expect(fsExtra.existsSync(harness.mockPaths.cfgPath), description).toBe(false);

      // Repairing the shipped file is all a user has to do: the faulted run
      // persisted nothing, so this start-up writes valid defaults.
      writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
      harness._import('startup');

      const expected = {...ensureObject(JSON5.parse(sharedDefaultConfigFixture)), keymaps: {}};
      expect(JSON5.parse(fsExtra.readFileSync(harness.mockPaths.cfgPath, 'utf8')), description).toEqual(expected);
    } finally {
      harness.cleanup();
    }
  }
});

test('a user-config read fault logs a bounded line, not the path or raw error', async () => {
  const errorMock = mock<typeof console.error>(() => {});
  const harness = await createConfigImportHarness({error: errorMock});
  try {
    seedBundledFiles(harness, sharedDefaultConfigFixture);
    // A directory where the file should be makes the read fail with EISDIR,
    // and the message Node builds repeats the path.
    fsExtra.mkdirpSync(harness.mockPaths.cfgPath);

    harness._import('startup');

    const faultLines = errorMock.mock.calls.filter(([message]) =>
      String(message).includes('Failed to read or parse user config')
    );
    expect(faultLines).toHaveLength(1);
    const [message, details] = faultLines[0] ?? [];
    // The workspace path and the raw message can carry sensitive identifiers,
    // so the log keeps only the errno code.
    expect(String(message)).not.toContain(harness.workspaceRoot);
    expect(details).toEqual({code: 'EISDIR'});
  } finally {
    harness.cleanup();
  }
});

test('reports a missing platform keymap in the query and once at start-up', async () => {
  const errorMock = mock<typeof console.error>(() => {});
  const harness = await createConfigImportHarness({error: errorMock});
  try {
    // The bundled config is usable; only the platform keymap is absent.
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');

    const queried = harness.getDefaultConfig();
    expect(queried.platformKeymapFault).toBe(true);
    expect(queried.platformKeymapFailure).toBe('read');
    expect(queried.failure).toBeUndefined();
    // The query reports the fault but never notifies or logs.
    expect(harness.notifyMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();

    harness._import('startup');
    harness._import('reload');

    const faultNotices = harness.notifyMock.mock.calls.filter(([title]) =>
      title.startsWith("Couldn't read the bundled platform keymap")
    );
    expect(faultNotices).toHaveLength(1);
    // The read fault reaches the error sink at start-up, and only once.
    const loggedFaults = errorMock.mock.calls.filter(([message]) =>
      String(message).includes('Failed to read the platform keymap')
    );
    expect(loggedFaults).toHaveLength(1);
  } finally {
    harness.cleanup();
  }
});

// The platform keymap can equally be absent (a read fault) or unparseable. A
// repaired copy must reach a start-up that runs straight afterwards.
const platformKeymapRepairCases = [
  {description: 'unreadable', seed: undefined},
  {description: 'invalid', seed: '{not json'}
] as const;

test('start-up after a repaired platform-keymap fault applies the repaired keymap', async () => {
  for (const {description, seed} of platformKeymapRepairCases) {
    const harness = await createConfigImportHarness({error: mock<typeof console.error>(() => {})});
    try {
      // The bundled config is usable, so only the platform file can fault.
      writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
      writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
      if (seed !== undefined) {
        writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), seed, 'utf8');
      }

      // A query observes the fault first, so start-up must notice the repaired
      // file itself rather than inheriting a refreshed snapshot.
      const faulted = harness.getDefaultConfig();
      expect(faulted.platformKeymapFault, description).toBe(true);
      expect(faulted.platformKeymapFailure, description).toBe(seed === undefined ? 'read' : 'parse');
      writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), `{'window:new': 'ctrl+alt+shift+n'}`, 'utf8');
      harness._import('startup');

      // The repaired bindings reach the applied configuration.
      expect(harness.initMock.mock.calls[0]?.[1], description).toMatchObject({
        keymaps: {'window:new': 'ctrl+alt+shift+n'}
      });
      // The bootstrapped file keeps shortcuts out of `config.json5`.
      const bootstrapped: unknown = JSON5.parse(fsExtra.readFileSync(harness.mockPaths.cfgPath, 'utf8'));
      expect(bootstrapped, description).toEqual({
        ...ensureObject(JSON5.parse(sharedDefaultConfigFixture)),
        keymaps: {}
      });
      // No query is needed to recover: start-up read the repaired file itself.
      const recovered = harness.getDefaultConfig();
      expect(recovered.platformKeymapFault, description).toBe(false);
      expect(recovered.defaults.keymaps, description).toEqual({'window:new': 'ctrl+alt+shift+n'});
    } finally {
      harness.cleanup();
    }
  }
});

test('start-up copies schemas through the injected filesystem and reports a refused copy', async () => {
  for (const shouldFail of [false, true]) {
    const copies: string[] = [];
    const recordingFileSystem: ConfigImportFileSystem = {
      ...fsExtra,
      /** Records each copy target and can refuse the copy to exercise the failure path. */
      copySync: (source, destination, options) => {
        copies.push(destination);
        if (shouldFail) {
          throw new Error('copy refused');
        }
        fsExtra.copySync(source, destination, options);
      }
    };
    const errorMock = mock<typeof console.error>(() => {});
    const harness = await createConfigImportHarness({error: errorMock, fs: recordingFileSystem});
    try {
      seedBundledFiles(harness, sharedDefaultConfigFixture);

      harness._import('startup');

      expect(copies).toContain(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile));
      expect(copies).toContain(path.join(harness.mockPaths.keybindingsDir, harness.mockPaths.keybindingsSchemaFile));
      const messages = harness.notifyMock.mock.calls.map(([message]) => message);
      const refusedCopy = "Couldn't update config schema metadata. Config editor validation may be stale.";
      // Both copies failing still produces one notice, not one per target.
      const refusedNotices = messages.filter((message) => message === refusedCopy);
      expect(refusedNotices).toHaveLength(shouldFail ? 1 : 0);
      // Both copy targets fail together, and each failure is logged through
      // the injected error sink, not printed straight to the process.
      const loggedFailures = errorMock.mock.calls.filter(([message]) =>
        String(message).includes('Failed to copy schema file')
      );
      expect(loggedFailures).toHaveLength(shouldFail ? 2 : 0);
    } finally {
      harness.cleanup();
    }
  }
});

/** The schema paths a Hyper-tree start-up may copy to, and what it did. */
type HyperSchemaRun = {
  readonly copies: readonly string[];
  readonly expected: {
    readonly hyperKeybindingsSchema: string;
    readonly hyperSchema: string;
    readonly velocettyKeybindingsSchema: string;
    readonly velocettySchema: string;
  };
  readonly loggedFailures: number;
  readonly refusedNotices: number;
};

/** Runs one Hyper-tree start-up and records its schema-copy effects. */
const runHyperSchemaScenario = async ({
  legacySchemaExists,
  shouldFail
}: {
  legacySchemaExists: boolean;
  shouldFail: boolean;
}): Promise<HyperSchemaRun> => {
  const copies: string[] = [];
  const recordingFileSystem: ConfigImportFileSystem = {
    ...fsExtra,
    /** Records each copy target and can refuse the copy so the Hyper-tree failure is observable. */
    copySync: (source, destination, options) => {
      copies.push(destination);
      if (shouldFail) {
        throw new Error('copy refused');
      }
      fsExtra.copySync(source, destination, options);
    }
  };
  const errorMock = mock<typeof console.error>(() => {});
  const harness = await createConfigImportHarness({error: errorMock, fs: recordingFileSystem, hyperTree: true});
  try {
    seedBundledFiles(harness, sharedDefaultConfigFixture);
    fsExtra.mkdirpSync(harness.mockPaths.cfgDir);
    if (legacySchemaExists) {
      writeFileSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile), '{"title":"stale"}', 'utf8');
    }

    harness._import('startup');

    const refusedCopy = "Couldn't update config schema metadata. Config editor validation may be stale.";
    return {
      copies,
      expected: {
        hyperKeybindingsSchema: path.join(harness.mockPaths.cfgDir, harness.mockPaths.keybindingsSchemaFile),
        hyperSchema: path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile),
        velocettyKeybindingsSchema: path.join(harness.mockPaths.velocettyDir, harness.mockPaths.keybindingsSchemaFile),
        velocettySchema: path.join(harness.mockPaths.velocettyDir, harness.mockPaths.schemaFile)
      },
      loggedFailures: errorMock.mock.calls.filter(([message]) => String(message).includes('Failed to copy schema file'))
        .length,
      refusedNotices: harness.notifyMock.mock.calls
        .map(([message]) => message)
        .filter((message) => message === refusedCopy).length
    };
  } finally {
    harness.cleanup();
  }
};

test('reports each refused Hyper schema copy but notifies once', async () => {
  for (const legacySchemaExists of [false, true]) {
    for (const shouldFail of [false, true]) {
      const {copies, expected, loggedFailures, refusedNotices} = await runHyperSchemaScenario({
        legacySchemaExists,
        shouldFail
      });

      // Both Velocetty copies are always attempted.
      expect(copies).toContain(expected.velocettySchema);
      expect(copies).toContain(expected.velocettyKeybindingsSchema);
      // The legacy copy is refreshed only when it already exists, and a
      // missing legacy keybindings schema is never created.
      expect(copies.includes(expected.hyperSchema)).toBe(legacySchemaExists);
      expect(copies).not.toContain(expected.hyperKeybindingsSchema);

      const expectedCopies = 2 + (legacySchemaExists ? 1 : 0);
      expect(copies).toHaveLength(expectedCopies);

      // Each refused copy is logged, but the user sees one notice.
      expect(loggedFailures).toBe(shouldFail ? expectedCopies : 0);
      expect(refusedNotices).toBe(shouldFail ? 1 : 0);
    }
  }
});

test('refreshes an existing Hyper schema but never creates a missing one', async () => {
  const harness = await createConfigImportHarness({hyperTree: true});
  try {
    seedBundledFiles(harness, sharedDefaultConfigFixture);
    fsExtra.mkdirpSync(harness.mockPaths.cfgDir);
    // Only the legacy config schema exists; the legacy keybindings schema does
    // not, and upgrading must not add one to the old tree.
    writeFileSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile), '{"title":"stale"}', 'utf8');

    harness._import('startup');

    const velocettySchema = path.join(harness.mockPaths.velocettyDir, harness.mockPaths.schemaFile);
    const velocettyKeybindingsSchema = path.join(
      harness.mockPaths.velocettyDir,
      harness.mockPaths.keybindingsSchemaFile
    );
    // Both new copies land in the Velocetty tree.
    expect(fsExtra.readFileSync(velocettySchema, 'utf8')).toBe('{"title":"schema"}');
    expect(fsExtra.existsSync(velocettyKeybindingsSchema)).toBe(true);
    // The copy that was already in the Hyper tree is refreshed in place.
    expect(fsExtra.readFileSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile), 'utf8')).toBe(
      '{"title":"schema"}'
    );
    expect(fsExtra.existsSync(path.join(harness.mockPaths.cfgDir, harness.mockPaths.keybindingsSchemaFile))).toBe(
      false
    );
  } finally {
    harness.cleanup();
  }
});
