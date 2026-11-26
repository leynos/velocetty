/**
 * @file Loads a settings snapshot and derives the filtered panel model.
 *
 * The snapshot hook owns the gateway subscription and revision guard, and the
 * panel derivation lives in `settings-editor-model.ts` so its rules can be
 * read without React. This hook only joins them into the view model, with the
 * field store refreshed whenever a newer snapshot arrives.
 */

import {useEffect, useMemo, useSyncExternalStore} from 'react';

import type {SettingsSnapshot} from '@shared/settings/protocol';

import {
  buildFieldEntries,
  buildSettingsPanel,
  type SettingsEditorArguments,
  type SettingsPanel
} from './settings-editor-model';
import {useSettingsSnapshot} from './use-settings-snapshot';

import type {FieldStore, FieldStoreSnapshot} from '../field-store';

/** What the settings view renders. */
export type SettingsEditor = SettingsPanel & {
  readonly isLoading: boolean;
  readonly loadError: string | null;
};

export type {SettingsEditorArguments} from './settings-editor-model';

const useFieldSnapshot = (fieldStore: FieldStore, snapshot: SettingsSnapshot | null): FieldStoreSnapshot => {
  const fieldSnapshot = useSyncExternalStore(fieldStore.subscribe, fieldStore.getSnapshot, fieldStore.getSnapshot);
  useEffect(() => {
    if (snapshot !== null) {
      fieldStore.refresh(snapshot);
    }
  }, [snapshot, fieldStore]);
  return fieldSnapshot;
};

/**
 * Loads a snapshot and derives the filtered model.
 *
 * @param arguments_ - The gateway, the Redux-owned filters, and label lookups.
 * @returns Sections, categories, counts, status, and file state.
 *
 * @example
 * const editor = useSettingsEditor({gateway, query: '', selectedCategory: 'all', ...});
 */
export const useSettingsEditor = (arguments_: SettingsEditorArguments): SettingsEditor => {
  const {snapshot, isLoading, loadError} = useSettingsSnapshot(arguments_.gateway);
  const fields = useFieldSnapshot(arguments_.fieldStore, snapshot);
  // An applied write carries a newer snapshot than the last watcher reload, so
  // the panel's changed markers and `@modified` filter follow it immediately.
  const panelSnapshot = fields.settingsSnapshot ?? snapshot;
  const entries = useMemo(() => buildFieldEntries(arguments_), [arguments_.labelFor, arguments_.descriptionFor]);
  const panel = useMemo(
    () =>
      buildSettingsPanel({
        entries,
        snapshot: panelSnapshot,
        fields,
        query: arguments_.query,
        selectedCategory: arguments_.selectedCategory,
        arguments_
      }),
    [entries, panelSnapshot, fields, arguments_.query, arguments_.selectedCategory]
  );
  return {...panel, isLoading, loadError};
};
