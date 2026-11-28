/**
 * @file Model and harness for the settings convergence property.
 *
 * Runs the real settings service and config writer over an in-memory file, with
 * a gateway that defers and reorders responses. Kept apart from the property so
 * both files stay within the 400-line limit.
 */
import {expect} from 'bun:test';
import JSON5 from 'json5';

import type {ConfigWriterDependencies} from '../../app/config/config-file-writer';
import {coerceInput} from '@shared/settings/coerce';
import {fileKindFor} from '../../app/settings/settings-file-kind';
import {createSettingsService} from '../../app/settings/settings-service';
import {createFieldStore, type FieldDefinition, type FieldStore} from '../../lib/settings/field-store';
import {createMemoryConfigFileSystem} from './config-file-port';

import type {SettingsGateway} from '../../lib/settings/ports';
import type {JsonValue} from '@shared/types/json';
import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';

export const CONFIG_PATH = '/home/user/.config/Hyper/config.json5';
export const FONT_SIZE = 'fontSize';
export const SHELL = 'shell';

export const FIELDS: readonly FieldDefinition[] = [
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

export type ExternalOp = {readonly kind: 'external'; readonly field: string; readonly draft: string};

export type Op =
  | {readonly kind: 'submit'; readonly field: string; readonly draft: string}
  | {readonly kind: 'reset'; readonly field: string};

export type SubmitOp = Extract<Op, {kind: 'submit'}>;
export type ResetOp = Extract<Op, {kind: 'reset'}>;

export type FlushOp = {readonly kind: 'flush'};
export type Action = Op | ExternalOp | FlushOp;

export type AppliedOps = {
  readonly expected: ReadonlyMap<string, JsonValue>;
  readonly resets: number;
  readonly externals: number;
  /** The draft the store should show once everything has settled. */
  readonly expectedDraft: ReadonlyMap<string, string>;
  /** Fields whose final action was a local validation refusal. */
  readonly invalidFields: ReadonlySet<string>;
  /** Fields whose final reset was refused because the key was absent. */
  readonly refusedFields: ReadonlySet<string>;
  readonly invalidActions: number;
  readonly refusedResets: number;
  readonly refusedDraft: ReadonlyMap<string, string>;
};

type Pending = {
  readonly outcome: Promise<SettingsWriteOutcome>;
  readonly resolve: (outcome: SettingsWriteOutcome) => void;
};

export const createHarness = () => {
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
    fileKind: fileKindFor(CONFIG_PATH),
    fileSystem: port,
    writer,
    defaults: {fontSize: 12, shell: '/bin/bash'},
    getDefaultProfileName: () => 'default'
  });
  const pending: Pending[] = [];
  const outcomes: SettingsWriteOutcome[] = [];
  const defer = (outcome: Promise<SettingsWriteOutcome>): Promise<SettingsWriteOutcome> =>
    new Promise((resolve) => {
      pending.push({
        outcome: outcome.then((result) => {
          outcomes.push(result);
          return result;
        }),
        resolve
      });
    });
  const gateway: SettingsGateway = {
    getSnapshot: async (): Promise<SettingsSnapshot> => service.getSnapshot(),
    setValue: (target, value) => defer(service.setValue(target, value)),
    resetValue: (target) => defer(service.resetValue(target)),
    subscribe: () => () => {}
  };
  const store: FieldStore = createFieldStore({gateway, fields: FIELDS});
  const bumpRevision = (): void => {
    revision += 1;
  };
  const externalWrite = (field: string, value: JsonValue): void => {
    port.setFile(CONFIG_PATH, JSON5.stringify({config: {...configOf(port), [field]: value}}));
    bumpRevision();
    store.refresh(service.getSnapshot());
  };
  /**
   * Waits until every submitted write has reached the file.
   *
   * The service serializes writes, so a write submitted before an external
   * edit applies before that edit is modelled. Their answers are still
   * delivered in the generated order later, which is the reordering this
   * property exercises.
   */
  const settleWrites = async (): Promise<void> => {
    await Promise.all(pending.map((item) => item.outcome));
  };
  const flushOldest = async (): Promise<void> => {
    const item = pending.shift();
    if (item !== undefined) {
      item.resolve(await item.outcome);
    }
  };
  return {port, service, store, pending, outcomes, externalWrite, flushOldest, settleWrites};
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

const flushOrder = (size: number, keys: readonly number[]): number[] => {
  const indices = Array.from({length: size}, (_unused, index) => index);
  if (keys.length === 0) {
    return indices;
  }
  return indices.toSorted((left, right) => (keys[left % keys.length] ?? 0) - (keys[right % keys.length] ?? 0));
};

const applySubmit = (store: FieldStore, expected: Map<string, JsonValue>, op: SubmitOp): void => {
  store.setDraft(`core:${op.field}`, op.draft);
  store.submit(`core:${op.field}`);
  const coerced = coercedDraft(op.field, op.draft);
  if (coerced !== undefined) {
    expected.set(op.field, coerced);
  }
};

const applyReset = (store: FieldStore, expected: Map<string, JsonValue>, op: ResetOp): void => {
  store.reset(`core:${op.field}`);
  expected.delete(op.field);
};

type Model = {
  readonly expected: Map<string, JsonValue>;
  readonly expectedDraft: Map<string, string>;
  readonly invalidFields: Set<string>;
  readonly refusedFields: Set<string>;
  readonly refusedDraft: Map<string, string>;
  resets: number;
  externals: number;
  invalidActions: number;
  refusedResets: number;
};

const applyExternalAction = (harness: ReturnType<typeof createHarness>, action: ExternalOp, model: Model): void => {
  const value = coercedDraft(action.field, action.draft);
  if (value === undefined) {
    return;
  }
  model.externals += 1;
  harness.externalWrite(action.field, value);
  model.expected.set(action.field, value);
  // A dirty error draft is preserved by the refresh, so only a clean field
  // takes the external value into its box.
  if (!model.invalidFields.has(action.field) && !model.refusedFields.has(action.field)) {
    model.expectedDraft.set(action.field, action.draft);
  }
};

const applyResetAction = (harness: ReturnType<typeof createHarness>, action: ResetOp, model: Model): void => {
  model.resets += 1;
  const displayed = harness.store.getSnapshot().fields.get(`core:${action.field}`)?.draft ?? '';
  if (model.expected.has(action.field)) {
    model.expectedDraft.set(action.field, `${defaultFor(action.field)}`);
    model.invalidFields.delete(action.field);
    model.refusedFields.delete(action.field);
  } else {
    model.invalidFields.delete(action.field);
    model.refusedFields.add(action.field);
    model.refusedResets += 1;
    // A refused reset leaves the box exactly as it was when Reset was pressed.
    model.refusedDraft.set(action.field, displayed);
  }
  applyReset(harness.store, model.expected, action);
};

const applySubmitAction = (harness: ReturnType<typeof createHarness>, action: SubmitOp, model: Model): void => {
  model.expectedDraft.set(action.field, action.draft);
  if (coercedDraft(action.field, action.draft) === undefined) {
    model.invalidFields.add(action.field);
    model.invalidActions += 1;
  } else {
    model.invalidFields.delete(action.field);
    model.refusedFields.delete(action.field);
  }
  applySubmit(harness.store, model.expected, action);
};

export const applyActions = async (
  harness: ReturnType<typeof createHarness>,
  actions: readonly Action[]
): Promise<AppliedOps> => {
  const model: Model = {
    expected: new Map<string, JsonValue>(),
    expectedDraft: new Map<string, string>(),
    invalidFields: new Set<string>(),
    refusedFields: new Set<string>(),
    refusedDraft: new Map<string, string>(),
    resets: 0,
    externals: 0,
    invalidActions: 0,
    refusedResets: 0
  };
  for (const action of actions) {
    switch (action.kind) {
      case 'flush': {
        // Deliver the oldest write's answer in the middle of the session.
        await harness.flushOldest();
        break;
      }
      case 'external': {
        // An external edit is observed against the file the serialized writer
        // has produced so far, so the writes already submitted settle first.
        await harness.settleWrites();
        applyExternalAction(harness, action, model);
        break;
      }
      case 'reset': {
        applyResetAction(harness, action, model);
        break;
      }
      case 'submit': {
        applySubmitAction(harness, action, model);
        break;
      }
    }
  }
  return {
    expected: model.expected,
    resets: model.resets,
    externals: model.externals,
    expectedDraft: model.expectedDraft,
    invalidFields: model.invalidFields,
    refusedFields: model.refusedFields,
    refusedDraft: model.refusedDraft,
    invalidActions: model.invalidActions,
    refusedResets: model.refusedResets
  };
};

export const flushInOrder = async (
  harness: ReturnType<typeof createHarness>,
  keys: readonly number[]
): Promise<boolean> => {
  const order = flushOrder(harness.pending.length, keys);
  const entries = [...harness.pending.entries()];
  for (const index of order) {
    const entry = entries.find(([key]) => key === index);
    if (entry !== undefined) {
      const [, item] = entry;
      item.resolve(await item.outcome);
    }
  }
  return order.some((value, index) => value !== index);
};

const defaultFor = (field: string): JsonValue => (field === FONT_SIZE ? 12 : '/bin/bash');

const expectCommittedValue = (
  harness: ReturnType<typeof createHarness>,
  applied: AppliedOps,
  field: string,
  expectedValue: JsonValue
): void => {
  const state = harness.store.getSnapshot().fields.get(`core:${field}`);
  expect(configOf(harness.port)[field] ?? null).toEqual(applied.expected.get(field) ?? null);
  expect(state?.committed ?? defaultFor(field)).toEqual(expectedValue);
};

const expectInvalidDraft = (harness: ReturnType<typeof createHarness>, applied: AppliedOps, field: string): void => {
  const state = harness.store.getSnapshot().fields.get(`core:${field}`);
  expect(state?.draft).toBe(applied.expectedDraft.get(field));
  expect(state?.errors.length).toBeGreaterThan(0);
};

const expectRefusedDraft = (harness: ReturnType<typeof createHarness>, applied: AppliedOps, field: string): void => {
  const state = harness.store.getSnapshot().fields.get(`core:${field}`);
  expect(state?.errors.length).toBeGreaterThan(0);
  expect(state?.draft).toBe(applied.refusedDraft.get(field));
};

const expectCleanDraft = (
  harness: ReturnType<typeof createHarness>,
  applied: AppliedOps,
  field: string,
  expectedValue: JsonValue
): void => {
  const state = harness.store.getSnapshot().fields.get(`core:${field}`);
  expect(state?.errors).toEqual([]);
  const draft = applied.expectedDraft.get(field);
  if (draft === undefined) {
    return;
  }
  // Delivery order can leave the draft at the typed text or at the final
  // committed value; either is a settled display, never an older value.
  const settledDrafts: readonly (string | undefined)[] = [draft, `${expectedValue}`];
  expect(settledDrafts).toContain(state?.draft);
};

const expectFieldSettled = (harness: ReturnType<typeof createHarness>, applied: AppliedOps, field: string): void => {
  const expectedValue = applied.expected.get(field) ?? defaultFor(field);
  expectCommittedValue(harness, applied, field, expectedValue);
  if (applied.invalidFields.has(field)) {
    expectInvalidDraft(harness, applied, field);
    return;
  }
  if (applied.refusedFields.has(field)) {
    expectRefusedDraft(harness, applied, field);
    return;
  }
  expectCleanDraft(harness, applied, field, expectedValue);
};

export const expectSettled = (harness: ReturnType<typeof createHarness>, applied: AppliedOps): void => {
  for (const field of [FONT_SIZE, SHELL]) {
    expectFieldSettled(harness, applied, field);
  }
};
