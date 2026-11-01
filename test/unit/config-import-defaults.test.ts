/** @file Verifies the read-only default query and the injected schema copy. */
import {expect, test} from 'bun:test';

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

// The bundled file is valid, invalid, or absent; only a parse fault is announced.
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
    seed: '{plugins: "not-an-array"}'
  },
  {announces: false, description: 'unreadable', expected: {keymaps: {}}, seed: undefined}
];

test('getDefaultConfig neither notifies nor re-reads, before or after start-up', async () => {
  for (const {announces, description, expected, seed} of bundledDefaultCases) {
    const harness = await createConfigImportHarness();
    try {
      seedBundledFiles(harness, seed);

      expect(harness.getDefaultConfig(), description).toEqual(expected);
      expect(bundledDefaultNotices(harness.notifyMock), description).toEqual([]);

      harness._import('startup');

      // Start-up is the command that acts on the fault, so it announces it once.
      expect(bundledDefaultNotices(harness.notifyMock), description).toHaveLength(announces ? 1 : 0);
      expect(harness.getDefaultConfig(), description).toEqual(expected);
      expect(bundledDefaultNotices(harness.notifyMock), description).toHaveLength(announces ? 1 : 0);
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
      copySync: (source, destination, options) => {
        copies.push(destination);
        if (shouldFail) {
          throw new Error('copy refused');
        }
        fsExtra.copySync(source, destination, options);
      }
    };
    const harness = await createConfigImportHarness({fs: recordingFileSystem});
    try {
      seedBundledFiles(harness, sharedDefaultConfigFixture);

      harness._import('startup');

      expect(copies).toContain(path.join(harness.mockPaths.cfgDir, harness.mockPaths.schemaFile));
      expect(copies).toContain(path.join(harness.mockPaths.keybindingsDir, harness.mockPaths.keybindingsSchemaFile));
      const messages = harness.notifyMock.mock.calls.map(([message]) => message);
      const refusedCopy = "Couldn't update config schema metadata. Config editor validation may be stale.";
      expect(messages.includes(refusedCopy)).toBe(shouldFail);
    } finally {
      harness.cleanup();
    }
  }
});
