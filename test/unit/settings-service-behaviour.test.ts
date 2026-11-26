/**
 * @file Behavioural scenarios for the settings service.
 *
 * These are the file-state rules a user can reach: a healthy file, a missing
 * one, one that will not parse, one that fails the schema, and the legacy
 * `hyper.json`. Each scenario states what the settings tab is allowed to do.
 */
import {describe, expect, test} from 'bun:test';

import type {ConfigWriterDependencies} from '../../app/config/config-file-writer';
import {createSettingsService, type SettingsService} from '../../app/settings/settings-service';
import {createMemoryConfigFileSystem} from '../testUtils/config-file-port';

import type {JsonObject} from '@shared/types/json';
import type {SettingTarget, SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

const CONFIG_PATH = '/home/user/.config/Hyper/config.json5';
const LEGACY_PATH = '/home/user/.config/Hyper/hyper.json';

const DEFAULTS: JsonObject = {
  fontSize: 12,
  shell: '/bin/bash',
  updateChannel: 'stable',
  colors: {black: '#000000'},
  css: ''
};

const target = (key: SettingTarget['key']): SettingTarget => ({scope: 'core', key});

type Harness = {
  readonly service: SettingsService;
  readonly port: ReturnType<typeof createMemoryConfigFileSystem>;
  readonly revision: () => number;
};

const createHarness = (filePath = CONFIG_PATH): Harness => {
  const port = createMemoryConfigFileSystem();
  let revision = 0;
  const writer: ConfigWriterDependencies = {
    fileSystem: port,
    sleep: async () => {
      await Promise.resolve();
    },
    log: () => {
      // Deliberately quiet in tests.
    },
    platform: 'linux',
    processId: () => 7,
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    currentRevision: () => revision,
    recordWrittenText: () => {
      // Exercised by the writer suite.
    }
  };
  const service = createSettingsService({
    filePath,
    fileSystem: port,
    writer,
    defaults: DEFAULTS,
    getDefaultProfileName: () => 'default'
  });
  return {service, port, revision: () => revision};
};

const harnessWithFile = (text: string): Harness => {
  const harness = createHarness();
  harness.port.setFile(CONFIG_PATH, text);
  return harness;
};

/** Asserts a read path wrote nothing and left the file's text alone. */
const expectReadOnly = (harness: Harness, filePath: string, expectedText?: string): void => {
  expect(harness.port.writes).toEqual([]);
  expect(harness.port.readFile(filePath)).toBe(expectedText);
};

const appliedSnapshot = async (outcome: Promise<SettingsWriteOutcome>): Promise<SettingsSnapshot> => {
  const result = await outcome;
  expect(result.kind).toBe('applied');
  if (result.kind !== 'applied') {
    throw new Error(`expected an applied write, got ${result.kind}`);
  }
  return result.snapshot;
};

type AppliedWrite = {
  readonly name: string;
  readonly initialText: string;
  readonly write: (service: SettingsService) => Promise<SettingsWriteOutcome>;
  readonly assertSnapshot: (snapshot: SettingsSnapshot) => void;
};

const APPLIED_WRITE_SCENARIOS: readonly AppliedWrite[] = [
  {
    name: 'a valid edit applies and returns the new snapshot',
    initialText: '{config: {fontSize: 14}}',
    write: (service) => service.setValue(target('fontSize'), 16),
    assertSnapshot: (snapshot) => {
      expect(snapshot.userValues).toEqual({fontSize: 16});
      expect(snapshot.revision).toBe(1);
    }
  },
  {
    name: 'a reset removes the key and reports it as no longer modified',
    initialText: '{config: {fontSize: 14, shell: "zsh"}}',
    write: (service) => service.resetValue(target('fontSize')),
    assertSnapshot: (snapshot) => {
      expect(snapshot.userValues).toEqual({shell: 'zsh'});
    }
  }
];

describe('settings snapshot', () => {
  test('reports the user values, the core defaults, and profile overrides', () => {
    const harness = createHarness();
    harness.port.setFile(
      CONFIG_PATH,
      '{config: {fontSize: 14, profiles: [{name: "default", config: {fontSize: 20}}]}}'
    );

    const snapshot = harness.service.getSnapshot();

    expect(snapshot.fileStatus).toEqual({kind: 'ok'});
    expect(snapshot.userValues).toEqual({fontSize: 14, profiles: [{name: 'default', config: {fontSize: 20}}]});
    expect(Object.keys(snapshot.defaultValues).toSorted()).toEqual(['fontSize', 'shell', 'updateChannel']);
    expect(snapshot.profileOverriddenKeys).toEqual(['fontSize']);
    expect(snapshot.filePath).toBe(CONFIG_PATH);
    expect(snapshot.revision).toBe(0);
    expectReadOnly(
      harness,
      CONFIG_PATH,
      '{config: {fontSize: 14, profiles: [{name: "default", config: {fontSize: 20}}]}}'
    );
  });

  test('reports a missing file without inventing values', () => {
    const harness = createHarness();
    const snapshot = harness.service.getSnapshot();
    expect(snapshot.fileStatus).toEqual({kind: 'missing'});
    expect(snapshot.userValues).toEqual({});
    expectReadOnly(harness, CONFIG_PATH);
  });

  test('reports an unparseable file with a diagnostic', () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {');
    const snapshot = harness.service.getSnapshot();
    expect(snapshot.fileStatus.kind).toBe('unparseable');
    if (snapshot.fileStatus.kind !== 'unparseable') {
      return;
    }
    expect(snapshot.fileStatus.diagnostics.length).toBeGreaterThan(0);
    expectReadOnly(harness, CONFIG_PATH, '{config: {');
  });

  test('reports a schema-invalid file with every diagnostic', () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {scrollback: "lots", fontSize: "big"}}');
    const snapshot = harness.service.getSnapshot();
    expect(snapshot.fileStatus.kind).toBe('invalid');
    if (snapshot.fileStatus.kind !== 'invalid') {
      return;
    }
    const paths = snapshot.fileStatus.diagnostics.map((item) => item.path).toSorted();
    expect(paths).toEqual(['/config/fontSize', '/config/scrollback']);
    expect(snapshot.userValues).toEqual({scrollback: 'lots', fontSize: 'big'});
    expectReadOnly(harness, CONFIG_PATH, '{config: {scrollback: "lots", fontSize: "big"}}');
  });

  test('reports a top-level field the load path rejects', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}, plugins: "nope"}');

    const snapshot = harness.service.getSnapshot();

    expect(snapshot.fileStatus.kind).toBe('invalid');
    if (snapshot.fileStatus.kind !== 'invalid') {
      return;
    }
    expect(snapshot.fileStatus.diagnostics.map((item) => item.path)).toEqual(['/plugins']);
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'user-config-invalid'
    });
    expectReadOnly(harness, CONFIG_PATH, '{config: {}, plugins: "nope"}');
  });

  test('reports a legacy hyper.json as read-only', () => {
    const harness = createHarness(LEGACY_PATH);
    harness.port.setFile(LEGACY_PATH, '{"config": {"fontSize": 14}}');
    expect(harness.service.getSnapshot().fileStatus).toEqual({kind: 'legacy-json'});
    expectReadOnly(harness, LEGACY_PATH, '{"config": {"fontSize": 14}}');
  });
});

describe('settings writes', () => {
  for (const scenario of APPLIED_WRITE_SCENARIOS) {
    test(scenario.name, async () => {
      const harness = harnessWithFile(scenario.initialText);

      const snapshot = await appliedSnapshot(scenario.write(harness.service));

      scenario.assertSnapshot(snapshot);
    });
  }

  test('a policy violation is rejected with diagnostics and does not write', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');

    const outcome = await harness.service.setValue(target('scrollback'), -3);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') {
      return;
    }
    expect(outcome.diagnostics[0]?.path).toBe('/config/scrollback');
    expect(harness.port.writes).toHaveLength(0);
  });

  test('a missing file cannot be written', async () => {
    const harness = createHarness();
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'config-file-missing'
    });
  });

  test('a legacy file cannot be written and says why', async () => {
    const harness = createHarness(LEGACY_PATH);
    harness.port.setFile(LEGACY_PATH, '{"config": {}}');
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'legacy-json-config'
    });
    expect(await harness.service.resetValue(target('fontSize'))).toEqual({
      kind: 'failed',
      reason: 'legacy-json-config'
    });
  });

  test('a schema-invalid file can be fixed one diagnosed key at a time', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {scrollback: "lots", fontSize: 14}}');

    const blocked = await harness.service.setValue(target('fontSize'), 16);
    expect(blocked).toEqual({kind: 'failed', reason: 'user-config-invalid'});
    expect(harness.port.writes).toHaveLength(0);

    const fixed = await harness.service.resetValue(target('scrollback'));
    expect(fixed.kind).toBe('applied');
    if (fixed.kind !== 'applied') {
      return;
    }
    expect(fixed.snapshot.fileStatus).toEqual({kind: 'ok'});
    expect(fixed.snapshot.userValues).toEqual({fontSize: 14});
  });

  test('an unparseable file cannot be written', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {');
    expect(await harness.service.setValue(target('fontSize'), 16)).toEqual({
      kind: 'failed',
      reason: 'user-config-unparseable'
    });
  });
});
