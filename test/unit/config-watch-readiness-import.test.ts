/**
 * @file Drives readiness reconciliation through the real importer over real files.
 *
 * The composition-root readiness spec stubs the importer, so it pins the order
 * the baseline is captured and settled in but never reads a file. These
 * examples run the real importer and the real keybindings store over a
 * temporary workspace: they prove that the text the importer reports it applied
 * is the text settlement compares against, and that an external write to a file
 * start-up created still reaches the running configuration through a reload.
 *
 * Cross-links:
 * - Sequence: `app/config/startup-import.ts`
 * - Stamps: `app/config/watched-file-stamp.ts`
 * - Importer: `app/config/import.ts`
 */
import {expect, test} from 'bun:test';
import {existsSync, rmSync, writeFileSync} from 'node:fs';

import type {ConfigImportResult} from '../../app/config/import';
import {runStartupImport} from '../../app/config/startup-import';
import {
  captureWatchedFileStamps,
  createWatchedFileReconciler,
  settleWatchedFileStamps
} from '../../app/config/watched-file-stamp';
import {
  createConfigImportHarness,
  type ConfigImportHarness,
  sharedDefaultConfigFixture
} from '../testUtils/config-import-harness';

/** Writes the bundled files the importer reads, so start-up can produce a file. */
const seedShippedFiles = (harness: ConfigImportHarness) => {
  writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
  writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{"window:new": ["ctrl+n"]}', 'utf8');
  writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
};

/**
 * Runs the shipped start-up sequence over the harness's temporary workspace.
 *
 * `afterImport` runs where the composition root settles the baseline next: the
 * import has written its files and returned, but no stamp has been adopted yet.
 */
const runStartup = (
  harness: ConfigImportHarness,
  watchedFiles: readonly string[],
  afterImport: (imported: ConfigImportResult) => void
) =>
  runStartupImport({
    captureStamps: () => captureWatchedFileStamps(watchedFiles),
    prepare: () => {},
    importConfiguration: () => {
      const imported = harness._import('startup');
      afterImport(imported);
      return imported;
    },
    settleStamps: settleWatchedFileStamps
  });

/** One file start-up writes, and the external content a later writer leaves. */
type ExternalWriteCase = Readonly<{
  /** Test name, which states the file and what the reload must apply. */
  readonly title: string;
  /** The path start-up creates in this case. */
  readonly writtenPath: (harness: ConfigImportHarness) => string;
  /** What an external writer leaves after the start-up write. */
  readonly externalText: string;
  /** What the reconciling reload must put in effect. */
  readonly assertApplied: (imported: ConfigImportResult) => void;
}>;

/** A config the start-up template does not contain, so the reload is visible. */
const EXTERNAL_CONFIG = `{
  config: {defaultProfile: 'work', profiles: [{name: 'work', config: {}}]},
  plugins: ['external-plugin'],
  localPlugins: [],
  keymaps: {}
}`;

/** The bindings an external writer adds to the seeded keybindings file. */
const EXTERNAL_KEYMAPS = {'window:new': ['ctrl+shift+n']};

const externalWriteCases: readonly ExternalWriteCase[] = [
  {
    assertApplied: (imported) => {
      expect(imported.config.config.defaultProfile).toBe('work');
      expect(imported.config.plugins).toEqual(['external-plugin']);
    },
    externalText: EXTERNAL_CONFIG,
    title: 'reconciles an external write to the bootstrapped config',
    writtenPath: (harness) => harness.mockPaths.cfgPath
  },
  {
    assertApplied: (imported) => {
      expect(imported.keybindings).toMatchObject({kind: 'applied', keymaps: EXTERNAL_KEYMAPS});
      expect(imported.config.keymaps).toEqual(EXTERNAL_KEYMAPS);
    },
    externalText: '{"window:new": ["ctrl+shift+n"]}\n',
    title: 'reconciles an external write to the seeded keybindings',
    writtenPath: (harness) => harness.mockPaths.keybindingsPath
  }
];

for (const testCase of externalWriteCases) {
  test(testCase.title, async () => {
    const harness = await createConfigImportHarness();
    try {
      seedShippedFiles(harness);
      const writtenPath = testCase.writtenPath(harness);
      const watchedFiles = [harness.mockPaths.cfgPath, harness.mockPaths.keybindingsPath];

      const outcome = runStartup(harness, watchedFiles, (imported) => {
        // The importer has written the file and returned, so this is exactly
        // where an external writer can land before settlement inspects it.
        expect(imported.writtenFiles.map((file) => file.path)).toContain(writtenPath);
        writeFileSync(writtenPath, testCase.externalText, 'utf8');
      });

      // The baseline was captured before the import and must not adopt a file
      // whose content the application never applied.
      expect(createWatchedFileReconciler(outcome.startupStamps)()).toBe(true);
      testCase.assertApplied(harness._import('reload'));
    } finally {
      harness.cleanup();
    }
  });
}

test('reconciles the deletion of a seeded keybindings file', async () => {
  const harness = await createConfigImportHarness();
  try {
    // The user's legacy binding is what start-up migrates into the seeded file,
    // so its disappearance is visible: the platform binding for the same
    // command is what the reload falls back to.
    writeFileSync(harness.mockPaths.defaultCfg, sharedDefaultConfigFixture, 'utf8');
    writeFileSync(
      harness.mockPaths.cfgPath,
      `{
  config: {defaultProfile: 'default', profiles: [{name: 'default', config: {}}]},
  plugins: [],
  localPlugins: [],
  keymaps: {'window:new': ['ctrl+shift+n']}
}`,
      'utf8'
    );
    writeFileSync(harness.mockPaths.defaultPlatformKeyPath(), '{"window:new": ["ctrl+n"]}', 'utf8');
    writeFileSync(harness.mockPaths.schemaPath, '{"title":"schema"}', 'utf8');
    const watchedFiles = [harness.mockPaths.cfgPath, harness.mockPaths.keybindingsPath];

    const outcome = runStartup(harness, watchedFiles, (imported) => {
      expect(imported.writtenFiles.map((file) => file.path)).toContain(harness.mockPaths.keybindingsPath);
      // The user deletes the file start-up seeded, before readiness looks. Its
      // pre-import identity is "absent" as well, so keeping that identity would
      // compare equal and skip the reload that applies the deletion.
      rmSync(harness.mockPaths.keybindingsPath);
    });

    expect(outcome.imported.config.keymaps).toEqual({'window:new': ['ctrl+shift+n']});
    expect(createWatchedFileReconciler(outcome.startupStamps)()).toBe(true);

    const reloaded = harness._import('reload');

    // The deletion reaches the running configuration: the seeded binding is
    // gone, the platform default is back, and reload did not recreate the file.
    expect(reloaded.config.keymaps).toEqual({'window:new': ['ctrl+n']});
    expect(existsSync(harness.mockPaths.keybindingsPath)).toBe(false);
  } finally {
    harness.cleanup();
  }
});

test('leaves an untouched start-up quiet', async () => {
  const harness = await createConfigImportHarness();
  try {
    seedShippedFiles(harness);
    const watchedFiles = [harness.mockPaths.cfgPath, harness.mockPaths.keybindingsPath];
    const outcome = runStartup(harness, watchedFiles, () => {});

    // Start-up wrote both files, and settlement adopts each one only because it
    // still holds the text the importer applied, so readiness has nothing to do.
    expect(outcome.imported.writtenFiles.map((file) => file.path).toSorted()).toEqual(watchedFiles.toSorted());
    expect(createWatchedFileReconciler(outcome.startupStamps)()).toBe(false);
  } finally {
    harness.cleanup();
  }
});
