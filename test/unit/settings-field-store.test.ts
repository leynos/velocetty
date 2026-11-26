/**
 * @file Behavioural scenarios for the settings field store.
 *
 * The store runs the proved state machine outside React and performs its
 * effects. These are the product scenarios: apply, reject, revert, reset,
 * ignore a stale outcome, and keep a newer draft when an older write lands.
 */
import {describe, expect, test} from 'bun:test';

import {createFieldStore, type FieldDefinition, type FieldStore} from '../../lib/settings/field-store';

import type {SettingsGateway} from '../../lib/settings/ports';
import type {SettingsSnapshot, SettingsWriteOutcome, SettingTarget} from '@shared/settings/protocol';

const FONT: FieldDefinition = {
  id: 'core:fontSize',
  target: {scope: 'core', key: 'fontSize'},
  control: {kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false}
};
const SHELL: FieldDefinition = {
  id: 'core:shell',
  target: {scope: 'core', key: 'shell'},
  control: {kind: 'text'}
};

const snapshotWith = (userValues: Record<string, string | number | boolean>, revision = 1): SettingsSnapshot => ({
  revision,
  filePath: '/tmp/config.json5',
  fileStatus: {kind: 'ok'},
  userValues,
  defaultValues: {fontSize: 12, shell: '/bin/bash'},
  profileOverriddenKeys: []
});

type Call =
  | {readonly kind: 'set'; readonly target: SettingTarget; readonly value: unknown}
  | {readonly kind: 'reset'; readonly target: SettingTarget};

type Deferred = {readonly resolve: (outcome: SettingsWriteOutcome) => void};

type FakeGateway = {
  readonly gateway: SettingsGateway;
  readonly calls: Call[];
  readonly pending: Deferred[];
  readonly resolveNext: (outcome: SettingsWriteOutcome) => void;
};

const createFakeGateway = (): FakeGateway => {
  const calls: Call[] = [];
  const pending: Deferred[] = [];
  const queue = (outcome?: SettingsWriteOutcome): Promise<SettingsWriteOutcome> =>
    new Promise((resolve) => {
      pending.push({resolve});
      void outcome;
    });
  return {
    calls,
    pending,
    resolveNext: (outcome) => {
      const next = pending.shift();
      next?.resolve(outcome);
    },
    gateway: {
      getSnapshot: async () => snapshotWith({}),
      setValue: (target, value) => {
        calls.push({kind: 'set', target, value});
        return queue();
      },
      resetValue: (target) => {
        calls.push({kind: 'reset', target});
        return queue();
      },
      subscribe: () => () => {}
    }
  };
};

const createStore = (gateway: SettingsGateway): FieldStore => createFieldStore({gateway, fields: [FONT, SHELL]});

const stateOf = (store: FieldStore, id = FONT.id) => {
  const state = store.getSnapshot().fields.get(id);
  if (state === undefined) {
    throw new Error(`missing field ${id}`);
  }
  return state;
};

describe('settings field store', () => {
  test('a valid edit writes the coerced value and applies the new snapshot', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    expect(stateOf(store).draft).toBe('14');

    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);

    expect(fake.calls).toEqual([{kind: 'set', target: FONT.target, value: 16}]);
    expect(stateOf(store).phase).toBe('saving');

    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 16}, 2)});
    await store.whenIdle();

    expect(stateOf(store).phase).toBe('idle');
    expect(stateOf(store).committed).toBe(16);
    expect(stateOf(store).isDirty).toBe(false);
    expect(stateOf(store).errors).toEqual([]);
  });

  test('an invalid draft shows an inline error and requests no write', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));

    store.setDraft(FONT.id, 'abc');
    store.submit(FONT.id);

    expect(fake.calls).toEqual([]);
    expect(stateOf(store).phase).toBe('invalid');
    expect(stateOf(store).errors.map((error) => error.code)).toEqual(['not-a-number']);
  });

  test('a value below the minimum names the bound', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    store.setDraft(FONT.id, '-3');
    store.submit(FONT.id);
    expect(stateOf(store).errors[0]).toEqual({code: 'below-minimum', minimum: 6, maximum: 100});
  });

  test('Escape reverts the draft without a write', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    store.setDraft(FONT.id, '20');
    store.revert(FONT.id);
    expect(stateOf(store).draft).toBe('14');
    expect(stateOf(store).isDirty).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  test('reset requests a removal and refreshes the committed value', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));

    store.reset(FONT.id);
    expect(fake.calls).toEqual([{kind: 'reset', target: FONT.target}]);

    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({}, 2)});
    await store.whenIdle();
    expect(stateOf(store).committed).toBe(12);
    expect(stateOf(store).draft).toBe('12');
  });

  test('an unset setting displays its effective default', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({}));
    expect(stateOf(store).committed).toBe(12);
    expect(stateOf(store).draft).toBe('12');
    expect(stateOf(store, SHELL.id).draft).toBe('/bin/bash');
  });

  test('a newer draft survives the applied outcome of an older write', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    store.setDraft(FONT.id, '18');

    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 16}, 2)});
    await store.whenIdle();

    expect(stateOf(store).draft).toBe('18');
    expect(stateOf(store).isDirty).toBe(true);
    expect(stateOf(store).committed).toBe(16);
  });

  test('a stale successful outcome does not refresh the newer value', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));

    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    store.setDraft(FONT.id, '20');
    store.submit(FONT.id);

    // The first request's answer arrives after the second submission. It
    // advances the committed value to the file state write 1 produced, while
    // the newer draft stays untouched; the second answer then wins.
    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 16}, 2)});
    await Promise.resolve();
    expect(stateOf(store).committed).toBe(16);
    expect(stateOf(store).draft).toBe('20');

    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 20}, 3)});
    await store.whenIdle();
    expect(stateOf(store).committed).toBe(20);
    expect(stateOf(store).draft).toBe('20');
  });

  test('an older snapshot revision is ignored', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 16}, 3));
    store.refresh(snapshotWith({fontSize: 12}, 2));
    expect(stateOf(store).committed).toBe(16);
  });

  test('the snapshot reports the last action for the live region', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    expect(store.getSnapshot().status).toBe('idle');

    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    expect(store.getSnapshot().status).toBe('saving');
    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 16}, 2)});
    await store.whenIdle();
    expect(store.getSnapshot().status).toBe('saved');

    store.reset(FONT.id);
    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({}, 3)});
    await store.whenIdle();
    expect(store.getSnapshot().status).toBe('reset');

    store.setDraft(FONT.id, '18');
    expect(store.getSnapshot().status).toBe('idle');
  });

  test('an unconfirmed durable write is announced as such', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 16}, 2), durability: 'unconfirmed'});
    await store.whenIdle();
    expect(store.getSnapshot().status).toBe('unconfirmed');
  });

  test('a locally invalid value announces itself without a write', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    store.setDraft(FONT.id, 'abc');
    store.submit(FONT.id);

    expect(store.getSnapshot().status).toBe('invalid');
    expect(fake.calls).toEqual([]);
  });

  test('a stale transport failure does not overwrite a newer success', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));

    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    store.setDraft(FONT.id, '20');
    store.submit(FONT.id);

    fake.resolveNext({kind: 'failed', reason: 'io-error'});
    await Promise.resolve();
    expect(store.getSnapshot().status).toBe('saving');

    fake.resolveNext({kind: 'applied', snapshot: snapshotWith({fontSize: 20}, 2)});
    await store.whenIdle();
    expect(store.getSnapshot().status).toBe('saved');
  });

  test('a refused write reports failure', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({}));
    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    fake.resolveNext({kind: 'failed', reason: 'io-error'});
    await store.whenIdle();
    expect(store.getSnapshot().status).toBe('failed');
  });

  test('a rejected write shows the main process diagnostic', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({}));
    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);

    fake.resolveNext({
      kind: 'rejected',
      diagnostics: [{path: '/config/fontSize', message: 'Expected at most 15.', suggestedFix: 'Lower it.'}]
    });
    await store.whenIdle();

    expect(stateOf(store).phase).toBe('rejected');
    expect(stateOf(store).errors).toEqual([
      {code: 'rejected', message: 'Expected at most 15.', suggestedFix: 'Lower it.'}
    ]);
  });

  test('a stale outcome is ignored and the newer request still resolves', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));

    store.setDraft(FONT.id, '16');
    store.submit(FONT.id);
    store.setDraft(FONT.id, '18');
    store.submit(FONT.id);
    expect(fake.calls).toHaveLength(2);

    // The first answer arrives after the second request is pending.
    const first = fake.pending.at(0);
    const second = fake.pending.at(1);
    first?.resolve({
      kind: 'rejected',
      diagnostics: [{path: '/config/fontSize', message: 'no', suggestedFix: 'no'}]
    });
    await Promise.resolve();
    second?.resolve({kind: 'applied', snapshot: snapshotWith({fontSize: 18}, 2)});
    await store.whenIdle();

    expect(stateOf(store).phase).toBe('idle');
    expect(stateOf(store).committed).toBe(18);
    expect(stateOf(store).errors).toEqual([]);
  });

  test('a refresh does not clobber a dirty draft', () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({fontSize: 14}));
    store.setDraft(FONT.id, '22');
    store.refresh(snapshotWith({fontSize: 16}, 2));
    expect(stateOf(store).draft).toBe('22');
    expect(stateOf(store).committed).toBe(16);
  });

  test('a transport failure leaves a failure phase with a message', async () => {
    const fake = createFakeGateway();
    const store = createStore(fake.gateway);
    store.refresh(snapshotWith({}));
    store.setDraft(SHELL.id, '/bin/zsh');
    store.submit(SHELL.id);
    fake.resolveNext({kind: 'failed', reason: 'io-error', detail: 'EPERM'});
    await store.whenIdle();
    expect(stateOf(store, SHELL.id).phase).toBe('failed');
    expect(stateOf(store, SHELL.id).errors[0]?.message).toBe('EPERM');
  });
});
