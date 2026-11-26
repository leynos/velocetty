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
  getSnapshot: (): FieldStoreSnapshot => ({fields: new Map(), status: 'idle'}),
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
    fields: {fields: new Map(), status: 'idle'},
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

/** Reads the newest hook state the probe observed. */
type ProbeReader = () => SettingsSnapshotState | null;

/** Mounts a probe for the snapshot hook and returns its latest state. */
const mountSnapshotProbe = async (gateway: SettingsGateway): Promise<ProbeReader> => {
  let latest: SettingsSnapshotState | null = null;
  const Probe = () => {
    latest = useSettingsSnapshot(gateway);
    return null;
  };
  await act(async () => {
    root?.render(<Probe />);
  });
  return () => latest;
};

/** Runs one state change inside React's act boundary. */
const settle = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
  });
};

describe('useSettingsSnapshot', () => {
  test('a late older revision does not replace a newer snapshot', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);
    expect(recording.loads).toHaveLength(1);

    await settle(() => recording.notifyChange());
    expect(recording.loads).toHaveLength(2);

    // The newer load settles first; the older one must not win afterwards.
    await settle(() => recording.loads[1]?.resolve(snapshotOf(2, {fontSize: 16})));
    expect(current()?.snapshot?.revision).toBe(2);

    await settle(() => recording.loads[0]?.resolve(snapshotOf(1, {fontSize: 12})));
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

  test('search matches the category label, as the plan requires', () => {
    const panel = panelOf(snapshotOf(1), 'appearance');

    expect(panel.resultCount).toBeGreaterThan(0);
    expect(panel.sections.every((section) => section.category === 'appearance')).toBe(true);
    expect(panel.sections.flatMap((section) => section.rows)).not.toHaveLength(0);
  });

  test('the live region announces save, reset, failure, and nothing at rest', () => {
    const messageFor = (status: 'idle' | 'saving' | 'saved' | 'reset' | 'failed') => {
      const arguments_ = editorArguments();
      return buildSettingsPanel({
        arguments_,
        entries: buildFieldEntries(arguments_),
        fields: {fields: new Map(), status},
        query: '',
        selectedCategory: 'all',
        snapshot: snapshotOf(1)
      }).statusMessage;
    };

    expect(messageFor('idle')).not.toContain('Saved');
    expect(messageFor('saved')).toContain('Saved.');
    expect(messageFor('reset')).toContain('Reset to the default value.');
    expect(messageFor('failed')).toContain('could not be saved');
    expect(messageFor('saving')).toContain('Saving.');
  });

  test('the changed marker follows the user file, not the effective value', () => {
    const changedRows = panelOf(snapshotOf(1, {fontSize: 16}), '').sections.flatMap((section) => section.rows);
    const unchangedRows = panelOf(snapshotOf(1), '').sections.flatMap((section) => section.rows);

    expect(changedRows.find((row) => row.id === 'core:fontSize')?.isModified).toBe(true);
    expect(unchangedRows.find((row) => row.id === 'core:fontSize')?.isModified).toBe(false);
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
