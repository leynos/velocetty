/**
 * @file Convergence property: after a sequence of edits, the file holds the
 * last value the user submitted, whatever order the outcomes arrive in.
 *
 * The real settings service and the real config writer run over an in-memory
 * file. The gateway issues writes in submission order — the order Electron's
 * IPC preserves — but delivers their outcomes in a generated order. The store
 * must ignore every stale outcome and settle on the file's final value.
 */
import {describe, expect, test} from 'bun:test';
import JSON5 from 'json5';
import fc from 'fast-check';

import type {ConfigWriterDependencies} from '../../app/config/config-file-writer';
import {coerceInput} from '@shared/settings/coerce';
import {createSettingsService} from '../../app/settings/settings-service';
import {createFieldStore, type FieldDefinition, type FieldStore} from '../../lib/settings/field-store';
import {createMemoryConfigFileSystem} from '../testUtils/config-file-port';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

import type {SettingsGateway} from '../../lib/settings/ports';
import type {JsonValue} from '@shared/types/json';
import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

const CONFIG_PATH = '/home/user/.config/Hyper/config.json5';
const FONT_SIZE = 'fontSize';
const SHELL = 'shell';

const FIELDS: readonly FieldDefinition[] = [
  {
    id: 'core:fontSize',
    target: {scope: 'core', key: FONT_SIZE},
    control: {kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false}
  },
  {
    id: 'core:shell',
    target: {scope: 'core', key: SHELL},
    control: {kind: 'text'}
  }
];

type Op =
  | {readonly kind: 'submit'; readonly field: string; readonly draft: string}
  | {readonly kind: 'reset'; readonly field: string};

const fieldArbitrary = fc.constantFrom(FONT_SIZE, SHELL);
const validDraftArbitrary = fc.integer({min: 6, max: 100}).map(String);
const draftArbitrary = fc.oneof(validDraftArbitrary, fc.constantFrom('abc', '', '-3'));
const submitArbitrary = fc.record({
  kind: fc.constant('submit' as const),
  field: fieldArbitrary,
  draft: draftArbitrary
});
const resetArbitrary = fc.record({kind: fc.constant('reset' as const), field: fieldArbitrary});
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(submitArbitrary, resetArbitrary);

type Pending = {
  readonly outcome: Promise<SettingsWriteOutcome>;
  readonly resolve: (outcome: SettingsWriteOutcome) => void;
};

const createHarness = () => {
  const port = createMemoryConfigFileSystem();
  port.setFile(CONFIG_PATH, '{config: {}}');
  let revision = 0;
  const writer: ConfigWriterDependencies = {
    fileSystem: port,
    sleep: async () => {
      await Promise.resolve();
    },
    log: () => {
      // Deliberately quiet.
    },
    platform: 'linux',
    processId: () => 1,
    nextRevision: () => {
      revision += 1;
      return revision;
    },
    currentRevision: () => revision,
    recordWrittenText: () => {
      // The writer suite owns self-write detection.
    }
  };
  const service = createSettingsService({
    filePath: CONFIG_PATH,
    fileSystem: port,
    writer,
    defaults: {fontSize: 12, shell: '/bin/bash'},
    getDefaultProfileName: () => 'default'
  });
  const pending: Pending[] = [];
  const defer = (outcome: Promise<SettingsWriteOutcome>): Promise<SettingsWriteOutcome> =>
    new Promise((resolve) => {
      pending.push({outcome, resolve});
    });
  const gateway: SettingsGateway = {
    getSnapshot: async (): Promise<SettingsSnapshot> => service.getSnapshot(),
    setValue: (target, value) => defer(service.setValue(target, value)),
    resetValue: (target) => defer(service.resetValue(target)),
    subscribe: () => () => {}
  };
  const store: FieldStore = createFieldStore({gateway, fields: FIELDS});
  return {port, service, store, pending};
};

const configOf = (port: ReturnType<typeof createMemoryConfigFileSystem>): Record<string, JsonValue> => {
  // SAFETY: the writer only produces a document with an object `config`.
  const parsed = JSON5.parse(port.readFile(CONFIG_PATH) ?? '{"config": {}}') as {config: Record<string, JsonValue>};
  return parsed.config;
};

const coercedDraft = (field: string, draft: string): JsonValue | undefined => {
  const definition = FIELDS.find((candidate) => candidate.target.key === field);
  if (definition === undefined) {
    return undefined;
  }
  const coercion = coerceInput(definition.control, draft);
  return coercion.ok ? coercion.value : undefined;
};

const opsArbitrary = fc.array(opArbitrary, {maxLength: 8});
const keysArbitrary = fc.array(fc.integer(), {maxLength: 8});

const flushOrder = (size: number, keys: readonly number[]): number[] => {
  const indices = Array.from({length: size}, (_unused, index) => index);
  if (keys.length === 0) {
    return indices;
  }
  return indices.toSorted((left, right) => (keys[left % keys.length] ?? 0) - (keys[right % keys.length] ?? 0));
};

describe('settings convergence', () => {
  test('the file settles on the last submission after out-of-order outcomes', async () => {
    let runs = 0;
    let reordered = 0;
    let resets = 0;

    await fc.assert(
      fc.asyncProperty(opsArbitrary, keysArbitrary, async (ops, keys) => {
        runs += 1;
        const harness = createHarness();
        harness.store.refresh(harness.service.getSnapshot());
        const expected = new Map<string, JsonValue>();

        for (const op of ops) {
          if (op.kind === 'reset') {
            resets += 1;
            harness.store.reset(`core:${op.field}`);
            expected.delete(op.field);
            continue;
          }
          harness.store.setDraft(`core:${op.field}`, op.draft);
          harness.store.submit(`core:${op.field}`);
          const coerced = coercedDraft(op.field, op.draft);
          if (coerced !== undefined) {
            expected.set(op.field, coerced);
          }
        }

        const order = flushOrder(harness.pending.length, keys);
        if (order.some((value, index) => value !== index)) {
          reordered += 1;
        }
        const entries = [...harness.pending.entries()];
        for (const index of order) {
          const entry = entries.find(([key]) => key === index);
          if (entry !== undefined) {
            const [, item] = entry;
            item.resolve(await item.outcome);
          }
        }
        await harness.store.whenIdle();

        const written = configOf(harness.port);
        for (const field of [FONT_SIZE, SHELL]) {
          expect(written[field] ?? null).toEqual(expected.get(field) ?? null);
        }
      }),
      {numRuns: Math.min(fastCheckRunCount(), 100)}
    );

    expect(reordered / runs).toBeGreaterThanOrEqual(0.1);
    expect(resets / runs).toBeGreaterThan(0.1);
  });
});
