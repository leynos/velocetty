/**
 * @file Loads a settings snapshot and derives the filtered panel model.
 *
 * The snapshot comes from the gateway (one load per subscription change, with
 * an abort signal for a superseded load), and an older revision is ignored so
 * a late answer cannot overwrite a newer one. Filtering runs through the proved
 * search core in `shared/src/settings/search.ts`.
 */

import {useEffect, useMemo, useRef, useState} from 'react';

import {formatValue, type SettingValue} from '@shared/settings/coerce';
import {isBoolean, isNumber, isString} from '@shared/types/guards';
import {buildCorePanelModel, coreKeyFromSettingId, type CoreSettingKey} from '@shared/settings/core-catalogue';
import type {PanelField} from '@shared/settings/panel-model';
import {normalizeSearchText, searchFieldIndices} from '@shared/settings/search';
import {SETTING_CATEGORY_IDS, type SettingCategoryId} from '@shared/settings/panel-model';
import type {SettingsFileStatus, SettingsSnapshot} from '@shared/settings/protocol';
import type {JsonValue} from '@shared/types/json';
import type {SettingsCategorySelection} from '@shared/constants/settings-tab';

import {formatResultCount} from '../i18n';
import type {SettingsGateway} from '../ports';
import type {SettingsCategory, SettingsRow, SettingsSection} from '../components/settings-view';

/** Arguments for the settings editor hook. */
export type SettingsEditorArguments = {
  readonly gateway: SettingsGateway;
  readonly query: string;
  readonly selectedCategory: SettingsCategorySelection;
  readonly labelFor: (key: CoreSettingKey) => string;
  readonly descriptionFor: (key: CoreSettingKey) => string | undefined;
  readonly categoryLabelFor: (category: SettingCategoryId) => string;
  readonly allSettingsLabel: string;
};

/** What the settings view renders. */
export type SettingsEditor = {
  readonly sections: readonly SettingsSection[];
  readonly categories: readonly SettingsCategory[];
  readonly resultCount: number;
  readonly statusMessage: string;
  readonly fileStatus: SettingsFileStatus | null;
  readonly isLoading: boolean;
  readonly loadError: string | null;
};

type FieldEntry = {
  readonly field: PanelField;
  readonly key: CoreSettingKey;
  readonly categoryIndex: number;
  readonly haystack: string;
};

const ALL_CATEGORIES = -1;

const asSettingValue = (value: JsonValue | undefined): SettingValue | undefined => {
  if (isString(value) || isNumber(value) || isBoolean(value)) {
    return value;
  }
  return undefined;
};

const haystackFor = (entry: Omit<FieldEntry, 'haystack'>, label: string, description: string | undefined): string =>
  normalizeSearchText([label, entry.key, description ?? ''].join(' '));

const buildFieldEntries = (arguments_: SettingsEditorArguments): readonly FieldEntry[] => {
  const model = buildCorePanelModel();
  return model.sections.flatMap((section, categoryIndex) =>
    section.fields.flatMap((field): FieldEntry[] => {
      const key = coreKeyFromSettingId(field.id);
      if (key === undefined) {
        return [];
      }
      const entry = {field, key, categoryIndex};
      const label = field.label.kind === 'key' ? arguments_.labelFor(key) : field.label.text;
      const description = arguments_.descriptionFor(key);
      return [{...entry, haystack: haystackFor(entry, label, description)}];
    })
  );
};

const sectionIndexFor = (entries: readonly FieldEntry[], selectedCategory: SettingsCategorySelection): number => {
  if (selectedCategory === 'all') {
    return ALL_CATEGORIES;
  }
  return (
    entries.find((entry) => SETTING_CATEGORY_IDS[entry.categoryIndex] === selectedCategory)?.categoryIndex ??
    ALL_CATEGORIES
  );
};

const rowFor = (
  entry: FieldEntry,
  snapshot: SettingsSnapshot | null,
  arguments_: SettingsEditorArguments
): SettingsRow => {
  const stored = snapshot?.userValues[entry.key];
  const description = arguments_.descriptionFor(entry.key);
  const row: SettingsRow = {
    id: entry.field.id,
    label: arguments_.labelFor(entry.key),
    value: formatValue(entry.field.control, asSettingValue(stored)),
    isModified: snapshot !== null && Object.hasOwn(snapshot.userValues, entry.key)
  };
  return description === undefined ? row : {...row, description};
};

const groupSections = (
  entries: readonly FieldEntry[],
  matches: readonly number[],
  snapshot: SettingsSnapshot | null,
  arguments_: SettingsEditorArguments
): readonly SettingsSection[] => {
  const rowsByCategory = new Map<SettingCategoryId, SettingsRow[]>();
  const matched = new Set(matches);
  entries.forEach((entry, index) => {
    if (!matched.has(index)) {
      return;
    }
    const category = SETTING_CATEGORY_IDS[entry.categoryIndex];
    const rows = rowsByCategory.get(category) ?? [];
    rows.push(rowFor(entry, snapshot, arguments_));
    rowsByCategory.set(category, rows);
  });
  return [...rowsByCategory].map(([category, rows]) => ({
    category,
    label: arguments_.categoryLabelFor(category),
    rows
  }));
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
  const {gateway} = arguments_;
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestRevision = useRef(-1);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const next = await gateway.getSnapshot(controller.signal);
        if (controller.signal.aborted || next.revision < latestRevision.current) {
          return;
        }
        latestRevision.current = next.revision;
        setSnapshot(next);
        setLoadError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Could not load settings.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    void load();
    const unsubscribe = gateway.subscribe(() => {
      void load();
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [gateway]);

  const entries = useMemo(() => buildFieldEntries(arguments_), [arguments_.labelFor, arguments_.descriptionFor]);

  return useMemo((): SettingsEditor => {
    const normalizedQuery = normalizeSearchText(arguments_.query);
    const haystacks = entries.map((entry) => entry.haystack);
    const modifiedFlags = entries.map((entry) => snapshot !== null && Object.hasOwn(snapshot.userValues, entry.key));
    const categoryIndices = entries.map((entry) => entry.categoryIndex);
    const selectedIndex = sectionIndexFor(entries, arguments_.selectedCategory);
    const matches = searchFieldIndices(normalizedQuery, haystacks, modifiedFlags, categoryIndices, selectedIndex);
    const categories: SettingsCategory[] = [
      {
        id: 'all',
        label: arguments_.allSettingsLabel,
        count: searchFieldIndices(normalizedQuery, haystacks, modifiedFlags, categoryIndices, ALL_CATEGORIES).length
      },
      ...SETTING_CATEGORY_IDS.map((category, categoryIndex) => ({
        id: category,
        label: arguments_.categoryLabelFor(category),
        count: searchFieldIndices(normalizedQuery, haystacks, modifiedFlags, categoryIndices, categoryIndex).length
      }))
    ];
    return {
      sections: groupSections(entries, matches, snapshot, arguments_),
      categories,
      resultCount: matches.length,
      statusMessage: formatResultCount(matches.length),
      fileStatus: snapshot?.fileStatus ?? null,
      isLoading,
      loadError
    };
  }, [entries, snapshot, isLoading, loadError, arguments_.query, arguments_.selectedCategory]);
};
