/**
 * @file Behaviour of the settings snapshot loader and the pure panel model.
 *
 * Two glue rules earn their keep here. The loader must ignore an older
 * revision that arrives after a newer one, and the panel must treat
 * `@modified` as "present in the user's config file", not as a substring of a
 * label. Both would leave every other suite green if they were removed or
 * inverted.
 */
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, describe, expect, test} from 'bun:test';

import type {CoreSettingKey} from '@shared/settings/core-catalogue';
import type {SettingsSnapshot, SettingsWriteOutcome} from '@shared/settings/protocol';
import type {SettingTarget} from '@shared/settings/protocol';

import {
  buildFieldEntries,
  buildSettingsPanel,
  type SettingsEditorArguments
} from '../../lib/settings/hooks/settings-editor-model';
import {useSettingsSnapshot, type SettingsSnapshotState} from '../../lib/settings/hooks/use-settings-snapshot';
import type {FieldStore, FieldStoreSnapshot} from '../../lib/settings/field-store';
import type {SettingsGateway} from '../../lib/settings/ports';
import {setupHappyDom} from '../testUtils/happy-dom';

const CONFIG_PATH = '/home/me/.config/Velocetty/config.json5';
const NO_CHANGE = () => {};
const NO_TEXT: string | undefined = undefined;

const snapshotOf = (revision: number, userValues: Readonly<Record<string, number>> = {}): SettingsSnapshot => ({
  revision,
  filePath: CONFIG_PATH,
  fileStatus: {kind: 'ok'},
  userValues,
  defaultValues: {},
  profileOverriddenKeys: []
});

type PendingLoad = {
  readonly resolve: (snapshot: SettingsSnapshot) => void;
  readonly reject: (error: Error) => void;
};

/**
 * Builds a gateway whose loads the test resolves by hand.
 *
 * Resolving by hand is what makes a late older snapshot observable: the test
 * chooses the order the promises settle in, rather than the transport.
 */
const createRecordingGateway = () => {
  const loads: PendingLoad[] = [];
  let onChange: () => void = NO_CHANGE;

  const gateway: SettingsGateway = {
    getSnapshot: () =>
      new Promise<SettingsSnapshot>((resolve, reject) => {
        loads.push({resolve, reject});
      }),
    resetValue: async (_target: SettingTarget): Promise<SettingsWriteOutcome> => ({
      kind: 'failed',
      reason: 'io-error'
    }),
    setValue: async (_target: SettingTarget): Promise<SettingsWriteOutcome> => ({kind: 'failed', reason: 'io-error'}),
    subscribe: (callback) => {
      onChange = callback;
      return () => {
        onChange = NO_CHANGE;
      };
    }
  };

  return {gateway, loads, notifyChange: () => onChange()};
};

const fieldStoreDouble = (): FieldStore => ({
  getSnapshot: (): FieldStoreSnapshot => ({fields: new Map()}),
  refresh: () => {},
  reset: () => {},
  revert: () => {},
  setDraft: () => {},
  submit: () => {},
  subscribe: () => () => {},
  whenIdle: async () => {}
});

const editorArguments = (overrides: Partial<SettingsEditorArguments> = {}): SettingsEditorArguments => ({
  allSettingsLabel: 'All settings',
  categoryLabelFor: (category) => category,
  descriptionFor: () => NO_TEXT,
  disabledReasonFor: () => NO_TEXT,
  fieldStore: fieldStoreDouble(),
  gateway: createRecordingGateway().gateway,
  labelFor: (key: CoreSettingKey) => key,
  query: '',
  selectedCategory: 'all',
  ...overrides
});

const panelOf = (snapshot: SettingsSnapshot, query: string) => {
  const arguments_ = editorArguments({query});
  const entries = buildFieldEntries(arguments_);
  return buildSettingsPanel({
    arguments_,
    entries,
    fields: {fields: new Map()},
    query,
    selectedCategory: 'all',
    snapshot
  });
};

let cleanup: (() => void) | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  cleanup = await setupHappyDom();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  cleanup?.();
  root = null;
  container = null;
  cleanup = null;
});

describe('useSettingsSnapshot', () => {
  test('a late older revision does not replace a newer snapshot', async () => {
    const recording = createRecordingGateway();
    let latest: SettingsSnapshotState | null = null;
    const current = (): SettingsSnapshotState | null => latest;

    const Probe = () => {
      latest = useSettingsSnapshot(recording.gateway);
      return null;
    };

    await act(async () => {
      root?.render(<Probe />);
    });
    expect(recording.loads).toHaveLength(1);

    await act(async () => {
      recording.notifyChange();
    });
    expect(recording.loads).toHaveLength(2);

    // The newer load settles first; the older one must not win afterwards.
    await act(async () => {
      recording.loads[1]?.resolve(snapshotOf(2, {fontSize: 16}));
    });
    expect(current()?.snapshot?.revision).toBe(2);

    await act(async () => {
      recording.loads[0]?.resolve(snapshotOf(1, {fontSize: 12}));
    });
    expect(current()?.snapshot?.revision).toBe(2);
    expect(current()?.snapshot?.userValues).toEqual({fontSize: 16});
  });
});

describe('buildSettingsPanel', () => {
  test('@modified lists only keys present in the user config file', () => {
    const panel = panelOf(snapshotOf(1, {fontSize: 16}), '@modified');

    expect(panel.resultCount).toBe(1);
    expect(panel.sections.flatMap((section) => section.rows.map((row) => row.id))).toEqual(['core:fontSize']);
    // Inverting the modified flag would list every field instead.
    expect(panel.resultCount).toBeLessThan(buildFieldEntries(editorArguments()).length);
  });

  test('category counts sum to the all-settings count', () => {
    const panel = panelOf(snapshotOf(1, {fontSize: 16}), '');
    const allCount = panel.categories.find((category) => category.id === 'all')?.count ?? -1;
    const categoryTotal = panel.categories
      .filter((category) => category.id !== 'all')
      .reduce((total, category) => total + category.count, 0);

    expect(allCount).toBe(panel.resultCount);
    expect(categoryTotal).toBe(panel.resultCount);
  });
});
