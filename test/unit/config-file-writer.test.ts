/**
 * @file Behavioural and property tests for the single config writer.
 *
 * The writer is the only path that may change the user's file, so these tests
 * assert both the happy path and, for every refusal, that nothing was written.
 */
import {describe, expect, test} from 'bun:test';
import JSON5 from 'json5';
import fc from 'fast-check';
import path from 'node:path';

import {
  asConfigFilePath,
  lastPathSegment,
  type ConfigWriteGuard,
  type ConfigWriterDependencies,
  TEMPORARY_FILE_PREFIX,
  sweepTemporaryFiles,
  writeConfigEdit
} from '../../app/config/config-file-writer';
import {checkWritePolicy} from '../../app/settings/settings-write-policy';
import {createMemoryConfigFileSystem, type MemoryConfigFileSystem} from '../testUtils/config-file-port';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

import type {JsonValue} from '@shared/types/json';

const CONFIG_PATH = '/home/user/.config/Hyper/config.json5';

const guard: ConfigWriteGuard = {
  checkPolicy: (segments, value) => checkWritePolicy(lastPathSegment(segments), value)
};

type Harness = {
  readonly port: MemoryConfigFileSystem;
  readonly dependencies: ConfigWriterDependencies;
  readonly revision: () => number;
  readonly lastHash: () => string | null;
};

const createHarness = (): Harness => {
  const port = createMemoryConfigFileSystem();
  let revision = 0;
  let lastHash: string | null = null;
  const dependencies: ConfigWriterDependencies = {
    fileSystem: port,
    sleep: async () => {
      await Promise.resolve();
    },
    log: () => {
      // Deliberately quiet in tests.
    },
    platform: 'linux',
    processId: () => 42,
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    currentRevision: () => revision,
    recordWrittenText: (text) => {
      lastHash = text;
    }
  };
  return {port, dependencies, revision: () => revision, lastHash: () => lastHash};
};

const invalidFontSizeValues = fc.oneof(fc.constant(-1), fc.constant('big'), fc.constant(true), fc.constant(null));

const configOf = (harness: Harness): JsonValue =>
  // SAFETY: the writer only produces a document whose root has an object `config`.
  (JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '{}') as {config: JsonValue}).config;

const set = (harness: Harness, value: JsonValue, key = 'fontSize', filePath = CONFIG_PATH) =>
  writeConfigEdit(harness.dependencies, filePath, {kind: 'set', path: ['config', key], value}, guard);

const remove = (harness: Harness, key = 'fontSize', filePath = CONFIG_PATH) =>
  writeConfigEdit(harness.dependencies, filePath, {kind: 'remove', path: ['config', key]}, guard);

describe('config writer', () => {
  test('writes a set edit, reports the new revision, and records the text', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{\n  // note\n  config: {\n    fontSize: 14\n  }\n}\n');

    const outcome = await set(harness, 16);

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') {
      return;
    }
    expect(outcome.revision).toBe(1);
    expect(harness.revision()).toBe(1);
    expect(harness.lastHash()).toBe(outcome.text);
    expect(JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '')).toEqual({config: {fontSize: 16}});
    expect(harness.port.readFile(CONFIG_PATH)).toContain('// note');
  });

  test('removes a key without touching other comments', async () => {
    const harness = createHarness();
    harness.port.setFile(
      CONFIG_PATH,
      '{\n  // keep\n  config: {\n    fontSize: 14, // gone\n    shell: "bash"\n  }\n}\n'
    );

    const outcome = await remove(harness);

    expect(outcome.kind).toBe('written');
    const written = harness.port.readFile(CONFIG_PATH) ?? '';
    expect(written).not.toContain('fontSize');
    expect(written).toContain('// keep');
    expect(configOf(harness)).toEqual({shell: 'bash'});
  });

  test('refuses a missing file without creating one', async () => {
    const harness = createHarness();
    expect(await set(harness, 16)).toEqual({kind: 'refused', reason: 'config-file-missing'});
    expect(harness.port.writes).toHaveLength(0);
  });

  test('refuses an unparseable file without writing', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{ config: {');
    expect(await set(harness, 16)).toEqual({kind: 'refused', reason: 'user-config-unparseable'});
    expect(harness.port.writes).toHaveLength(0);
  });

  test('refuses a non-object config without writing', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: 5}');
    expect(await set(harness, 16)).toEqual({kind: 'refused', reason: 'config-not-object'});
    expect(harness.port.writes).toHaveLength(0);
  });

  test('refuses a duplicate key on the path without writing', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {fontSize: 14, fontSize: 15}}');
    expect(await set(harness, 16)).toEqual({kind: 'refused', reason: 'duplicate-key'});
    expect(harness.port.writes).toHaveLength(0);
  });

  test('refuses a policy violation with diagnostics and no write', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');

    const outcome = await set(harness, -3, 'scrollback');

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') {
      return;
    }
    expect(outcome.reason).toBe('not-editable');
    expect(outcome.diagnostics?.[0]?.path).toBe('/config/scrollback');
    expect(harness.port.writes).toHaveLength(0);
  });

  test('a schema issue on another key does not block an unrelated edit', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {scrollback: "lots", fontSize: 14}}');
    const outcome = await set(harness, 16);
    expect(outcome.kind).toBe('written');
  });

  test('retries a busy file and then succeeds', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');
    harness.port.queueFault('rename', 'EBUSY');
    harness.port.queueFault('rename', 'EPERM');

    const outcome = await set(harness, 16);

    expect(outcome.kind).toBe('written');
    expect(JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '')).toEqual({config: {fontSize: 16}});
  });

  test('gives up after three retryable failures without changing the file', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      harness.port.queueFault('rename', 'EACCES');
    }

    const outcome = await set(harness, 16);

    expect(outcome).toEqual({kind: 'refused', reason: 'io-error'});
    expect(harness.port.readFile(CONFIG_PATH)).toBe('{config: {}}');
  });

  test('a set on a healthy file reports confirmed durability', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');

    const outcome = await set(harness, 16);

    expect(outcome).toMatchObject({kind: 'written', durability: 'confirmed'});
  });

  test('a directory fsync failure after the rename still reports success', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {fontSize: 14}}');
    harness.port.queueFault('fsyncDirectory', 'EIO');

    const outcome = await set(harness, 16);

    expect(outcome).toMatchObject({kind: 'written', revision: 1, durability: 'unconfirmed'});
    expect(JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '')).toEqual({config: {fontSize: 16}});
  });

  test('a failed rename leaves no temporary file behind', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');
    harness.port.queueFault('rename', 'EIO');

    await set(harness, 16);

    const leftovers = [...harness.port.files.keys()].filter((file) => file.includes(TEMPORARY_FILE_PREFIX));
    expect(leftovers).toEqual([]);
  });

  test('sweeps only its own temporary files', () => {
    const harness = createHarness();
    // The port keys files the way the writer builds paths, which is the
    // platform's own separator on Windows.
    const directory = path.join('/home/user/.config/Hyper');
    const keep = path.join(directory, 'keep.json5');
    harness.port.setFile(keep, '{}');
    harness.port.setFile(path.join(directory, `${TEMPORARY_FILE_PREFIX}1-1`), '{}');
    harness.port.setFile(path.join(directory, `${TEMPORARY_FILE_PREFIX}1-2`), '{}');

    expect(sweepTemporaryFiles(harness.port, asConfigFilePath(directory))).toBe(2);
    expect([...harness.port.files.keys()]).toEqual([keep]);
  });

  test('concurrent writers never lose an update', async () => {
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');
    const keys = ['fontSize', 'shell', 'scrollback', 'padding'] as const;
    const values: JsonValue[] = [16, 'bash', 1000, '12px 14px'];

    const outcomes = await Promise.all(keys.map((key, index) => set(harness, values[index] ?? 16, key)));

    expect(outcomes.every((outcome) => outcome.kind === 'written')).toBe(true);
    // SAFETY: the writer only produces a document whose root has an object
    // `config`, so the parsed shape is known.
    const written = JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '') as {config: Record<string, JsonValue>};
    expect(Object.keys(written.config).toSorted()).toEqual([...keys].toSorted());
  });

  test('a writer that yields between read and write loses an update', async () => {
    // A deliberately broken writer, proving the exclusivity property above is
    // sensitive: the synchronous critical section is what prevents the loss.
    const harness = createHarness();
    harness.port.setFile(CONFIG_PATH, '{config: {}}');
    const brokenWrite = async (key: string, value: JsonValue): Promise<void> => {
      // Read once, yield, then write that snapshot back: the classic lost
      // update the synchronous critical section prevents.
      // SAFETY: this test seeds the file with an object `config`.
      const snapshot = JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '') as {config: Record<string, JsonValue>};
      await Promise.resolve();
      snapshot.config[key] = value;
      harness.port.setFile(CONFIG_PATH, JSON.stringify(snapshot));
    };
    await Promise.all([brokenWrite('fontSize', 16), brokenWrite('shell', 'bash')]);
    // SAFETY: this test seeds the file with an object `config`.
    const written = JSON5.parse(harness.port.readFile(CONFIG_PATH) ?? '') as {config: Record<string, JsonValue>};
    expect(Object.keys(written.config).length).toBe(1);
  });

  test('generated invalid values never reach the file', async () => {
    await fc.assert(
      fc.asyncProperty(invalidFontSizeValues, async (value) => {
        const harness = createHarness();
        harness.port.setFile(CONFIG_PATH, '{config: {}}');
        const outcome = await set(harness, value, 'fontSize');
        expect(outcome.kind).toBe('refused');
        expect(harness.port.writes).toHaveLength(0);
      }),
      {numRuns: fastCheckRunCount()}
    );
  });
});
