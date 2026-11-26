/**
 * @file Pure derivation of the settings panel from a snapshot and the filters.
 *
 * Kept out of the hook so the grouping and row rules can be read without
 * React. Filtering runs through the proved search core in
 * `shared/src/settings/search.ts`, and the catalogue stays the only source of
 * field order.
 */

import {buildCorePanelModel, coreKeyFromSettingId, type CoreSettingKey} from '@shared/settings/core-catalogue';
import {keyRequiresRestart} from '@shared/constants/config-reloadability';
import type {PanelField} from '@shared/settings/panel-model';
import {normalizeSearchText, searchFieldIndices, type SearchFields} from '@shared/settings/search';
import {SETTING_CATEGORY_IDS, type SettingCategoryId} from '@shared/settings/panel-model';
import type {SettingsFileStatus, SettingsSnapshot} from '@shared/settings/protocol';
import type {SettingsCategorySelection} from '@shared/constants/settings-tab';

import {describeFieldError, formatResultCount} from '../i18n';

import type {SettingsCategory, SettingsSection} from '../components/settings-view';
import type {SettingRowProps} from '../components/setting-row';
import type {FieldError, FieldStore, FieldStoreSnapshot} from '../field-store';
import type {SettingsGateway} from '../ports';
import type {FieldPhase, FieldState} from '@shared/settings/field-state';
import type {SettingValue} from '@shared/settings/coerce';

/** Arguments for the settings editor hook. */
export type SettingsEditorArguments = {
  readonly gateway: SettingsGateway;
  readonly fieldStore: FieldStore;
  readonly query: string;
  readonly selectedCategory: SettingsCategorySelection;
  readonly labelFor: (key: CoreSettingKey) => string;
  readonly descriptionFor: (key: CoreSettingKey) => string | undefined;
  readonly categoryLabelFor: (category: SettingCategoryId) => string;
  readonly allSettingsLabel: string;
  readonly disabledReasonFor: (key: CoreSettingKey, status: SettingsFileStatus | null) => string | undefined;
};

/** What the panel derivation produces. */
export type SettingsPanel = {
  readonly sections: readonly SettingsSection[];
  readonly categories: readonly SettingsCategory[];
  readonly resultCount: number;
  readonly statusMessage: string;
  readonly fileStatus: SettingsFileStatus | null;
};

/** A catalogue field with the text searched for it precomputed. */
export type FieldEntry = {
  readonly field: PanelField;
  readonly key: CoreSettingKey;
  readonly categoryIndex: number;
  readonly haystack: string;
};

/** Everything the grouping step needs to turn matches into rendered sections. */
type SectionGrouping = {
  readonly entries: readonly FieldEntry[];
  readonly matches: readonly number[];
  readonly snapshot: SettingsSnapshot | null;
  readonly fields: FieldStoreSnapshot;
  readonly arguments_: SettingsEditorArguments;
};

/** The query state needed to count each category's matches. */
type CategoryCounts = {
  readonly query: string;
  readonly searchFields: SearchFields;
  readonly arguments_: SettingsEditorArguments;
};

/** The panel derivation's inputs. */
export type SettingsPanelRequest = {
  readonly entries: readonly FieldEntry[];
  readonly snapshot: SettingsSnapshot | null;
  readonly fields: FieldStoreSnapshot;
  readonly query: string;
  readonly selectedCategory: SettingsCategorySelection;
  readonly arguments_: SettingsEditorArguments;
};

/** The field-store-derived values a row shows. */
type RowView = {
  readonly draft: string;
  readonly phase: FieldPhase;
  readonly errors: readonly string[];
  readonly isModified: boolean;
};

type FieldHandlers = Pick<SettingRowProps, 'onChange' | 'onCommit' | 'onRevert' | 'onReset'>;

type Mutable<T> = {-readonly [K in keyof T]: T[K]};

const ALL_CATEGORIES = -1;

const haystackFor = (entry: Omit<FieldEntry, 'haystack'>, label: string, description: string | undefined): string =>
  normalizeSearchText([label, entry.key, description ?? ''].join(' '));

/**
 * Builds one search entry per catalogue field, in model order.
 *
 * @param arguments_ - The label lookups that make a field searchable.
 * @returns The entries, one per field that maps to a core setting.
 */
export const buildFieldEntries = (arguments_: SettingsEditorArguments): readonly FieldEntry[] =>
  buildCorePanelModel().sections.flatMap((section, categoryIndex) =>
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

const sectionIndexFor = (entries: readonly FieldEntry[], selectedCategory: SettingsCategorySelection): number => {
  if (selectedCategory === 'all') {
    return ALL_CATEGORIES;
  }
  return (
    entries.find((entry) => SETTING_CATEGORY_IDS[entry.categoryIndex] === selectedCategory)?.categoryIndex ??
    ALL_CATEGORIES
  );
};

const rowViewOf = (state: FieldState<SettingValue, FieldError> | undefined): RowView => ({
  draft: state?.draft ?? '',
  phase: state?.phase ?? 'idle',
  errors: (state?.errors ?? []).map((error) => describeFieldError(error)),
  isModified: state !== undefined && state.committed !== undefined
});

const handlersFor = (fieldStore: FieldStore, id: string): FieldHandlers => ({
  onChange: (draft) => fieldStore.setDraft(id, draft),
  onCommit: () => fieldStore.submit(id),
  onRevert: () => fieldStore.revert(id),
  onReset: () => fieldStore.reset(id)
});

const withOptionalText = (
  base: Mutable<SettingRowProps>,
  description: string | undefined,
  disabledReason: string | undefined
): SettingRowProps => {
  if (description !== undefined) {
    base.description = description;
  }
  if (disabledReason !== undefined) {
    base.disabledReason = disabledReason;
  }
  return base;
};

const rowFor = (
  entry: FieldEntry,
  snapshot: SettingsSnapshot | null,
  fields: FieldStoreSnapshot,
  arguments_: SettingsEditorArguments
): SettingRowProps => {
  const disabledReason = arguments_.disabledReasonFor(entry.key, snapshot?.fileStatus ?? null);
  const base: Mutable<SettingRowProps> = {
    id: entry.field.id,
    label: arguments_.labelFor(entry.key),
    control: entry.field.control,
    ...rowViewOf(fields.fields.get(entry.field.id)),
    isDisabled: disabledReason !== undefined,
    isProfileOverridden: snapshot?.profileOverriddenKeys.includes(entry.key) ?? false,
    requiresRestart: keyRequiresRestart(entry.key),
    ...handlersFor(arguments_.fieldStore, entry.field.id)
  };
  return withOptionalText(base, arguments_.descriptionFor(entry.key), disabledReason);
};

const groupSections = ({
  entries,
  matches,
  snapshot,
  fields,
  arguments_
}: SectionGrouping): readonly SettingsSection[] => {
  const rowsByCategory = new Map<SettingCategoryId, SettingRowProps[]>();
  const matched = new Set(matches);
  entries.forEach((entry, index) => {
    if (!matched.has(index)) {
      return;
    }
    const category = SETTING_CATEGORY_IDS[entry.categoryIndex];
    const rows = rowsByCategory.get(category) ?? [];
    rows.push(rowFor(entry, snapshot, fields, arguments_));
    rowsByCategory.set(category, rows);
  });
  return [...rowsByCategory].map(([category, rows]) => ({
    category,
    label: arguments_.categoryLabelFor(category),
    rows
  }));
};

const countFor = (counts: CategoryCounts, categoryIndex: number): number =>
  searchFieldIndices(counts.query, counts.searchFields, categoryIndex).length;

const buildCategories = (counts: CategoryCounts): readonly SettingsCategory[] => [
  {id: 'all', label: counts.arguments_.allSettingsLabel, count: countFor(counts, ALL_CATEGORIES)},
  ...SETTING_CATEGORY_IDS.map((category, categoryIndex) => ({
    id: category,
    label: counts.arguments_.categoryLabelFor(category),
    count: countFor(counts, categoryIndex)
  }))
];

/**
 * Derives the sections, categories, and counts for one render.
 *
 * @param request - The search entries, snapshot, field state, and filters.
 * @returns The panel model the view renders.
 *
 * @example
 * buildSettingsPanel({entries, snapshot, fields, query: '', selectedCategory: 'all', arguments_});
 */
export const buildSettingsPanel = (request: SettingsPanelRequest): SettingsPanel => {
  const {entries, snapshot, fields, query, selectedCategory, arguments_} = request;
  const normalizedQuery = normalizeSearchText(query);
  const haystacks = entries.map((entry) => entry.haystack);
  const modifiedFlags = entries.map((entry) => snapshot !== null && Object.hasOwn(snapshot.userValues, entry.key));
  const categoryIndices = entries.map((entry) => entry.categoryIndex);
  const searchFields: SearchFields = {haystacks, modifiedFlags, categoryIndices};
  const matches = searchFieldIndices(normalizedQuery, searchFields, sectionIndexFor(entries, selectedCategory));
  return {
    sections: groupSections({entries, matches, snapshot, fields, arguments_}),
    categories: buildCategories({query: normalizedQuery, searchFields, arguments_}),
    resultCount: matches.length,
    statusMessage: formatResultCount(matches.length),
    fileStatus: snapshot?.fileStatus ?? null
  };
};
