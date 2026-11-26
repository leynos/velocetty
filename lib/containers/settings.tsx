/**
 * @file Connects the settings surface to Redux, translation, and the transport.
 *
 * Search state lives in Redux (so `settings.search` can drive it later); the
 * snapshot and values come from the main process through the gateway. The
 * component is a thin adapter over `useSettingsEditor` and `SettingsView`.
 */

import {useMemo} from 'react';

import {asCommandId} from '@shared/types/commands';
import {
  SETTINGS_CATEGORY_SELECT,
  SETTINGS_QUERY_SET,
  type SettingsCategorySelection
} from '@shared/constants/settings-tab';

import {buildCorePanelModel, coreKeyFromSettingId, type CoreSettingKey} from '@shared/settings/core-catalogue';

import {SettingsView, type SettingsViewStrings} from '../settings/components/settings-view';
import {createFieldStore, type FieldDefinition} from '../settings/field-store';
import {
  categoryLabel,
  settingDescription,
  settingLabel,
  settingsStrings,
  useSettingsTranslation
} from '../settings/i18n';
import {useSettingsEditor} from '../settings/hooks/use-settings-editor';
import {createTransportSettingsGateway} from '../settings/adapters/transport-settings-gateway';
import {transport} from '../transport';
import {connect} from '../utils/plugins';

import type {HyperState, HyperDispatch} from '../../typings/hyper';
import type {SettingsFileStatus} from '@shared/settings/protocol';

const bannerFor = (status: SettingsFileStatus | null, loadError: string | null): string | null => {
  if (loadError !== null) {
    return loadError;
  }
  if (status === null || status.kind === 'ok') {
    return null;
  }
  switch (status.kind) {
    case 'missing': {
      return settingsStrings.missingBanner;
    }
    case 'unparseable': {
      return settingsStrings.unparseableBanner;
    }
    case 'invalid': {
      const problems = status.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`);
      return [settingsStrings.invalidBanner, ...problems].join(' ');
    }
    case 'legacy-json': {
      return settingsStrings.legacyBanner;
    }
  }
};

const FIELD_DEFINITIONS: readonly FieldDefinition[] = buildCorePanelModel().sections.flatMap((section) =>
  section.fields.flatMap((field): FieldDefinition[] => {
    const key = coreKeyFromSettingId(field.id);
    return key === undefined ? [] : [{id: field.id, target: {scope: 'core', key}, control: field.control}];
  })
);

/**
 * Explains why a row cannot be edited in the file's current state.
 *
 * @param key - The setting key.
 * @param status - The file status, or null before the first load.
 * @returns A reason, or undefined when the row is editable.
 */
const disabledReasonFor = (key: CoreSettingKey, status: SettingsFileStatus | null): string | undefined => {
  if (status === null) {
    return undefined;
  }
  switch (status.kind) {
    case 'ok': {
      return undefined;
    }
    case 'missing': {
      return settingsStrings.missingRow;
    }
    case 'legacy-json': {
      return settingsStrings.legacyRow;
    }
    case 'unparseable': {
      return settingsStrings.unparseableRow;
    }
    case 'invalid': {
      const keyPath = `/config/${key}`;
      const ownsDiagnostic = status.diagnostics.some(
        (diagnostic) => diagnostic.path === keyPath || diagnostic.path.startsWith(`${keyPath}/`)
      );
      return ownsDiagnostic ? undefined : settingsStrings.invalidRow;
    }
  }
};

const viewStrings: SettingsViewStrings = {
  title: settingsStrings.title,
  search: settingsStrings.search,
  searchPlaceholder: settingsStrings.searchPlaceholder,
  categories: settingsStrings.categories,
  results: settingsStrings.results,
  noResults: settingsStrings.noResults,
  clearFilters: settingsStrings.clearFilters,
  openConfigFile: settingsStrings.openConfigFile,
  modified: settingsStrings.modifiedNote
};

const Settings = (props: SettingsConnectedProps) => {
  // The translation hook is called so a changed locale re-renders; the label
  // helpers themselves are stable module functions.
  useSettingsTranslation();
  const gateway = useMemo(() => createTransportSettingsGateway(transport), []);
  const fieldStore = useMemo(() => createFieldStore({gateway, fields: FIELD_DEFINITIONS}), [gateway]);
  const editor = useSettingsEditor({
    gateway,
    fieldStore,
    query: props.query,
    selectedCategory: props.selectedCategory,
    labelFor: settingLabel,
    descriptionFor: settingDescription,
    categoryLabelFor: categoryLabel,
    allSettingsLabel: settingsStrings.allSettings,
    disabledReasonFor
  });

  return (
    <SettingsView
      strings={viewStrings}
      sections={editor.sections}
      categories={editor.categories}
      query={props.query}
      selectedCategory={props.selectedCategory}
      resultCount={editor.resultCount}
      statusMessage={editor.statusMessage}
      banner={bannerFor(editor.fileStatus, editor.loadError)}
      isActive={props.isActive}
      onQueryChange={props.onQueryChange}
      onCategorySelect={props.onCategorySelect}
      onClearFilters={props.onClearFilters}
      onOpenConfigFile={props.onOpenConfigFile}
    />
  );
};

const mapStateToProps = (state: HyperState) => ({
  query: state.settingsTab.query,
  selectedCategory: state.settingsTab.selectedCategory,
  isActive: state.settingsTab.isActive
});

const mapDispatchToProps = (dispatch: HyperDispatch) => ({
  onQueryChange: (query: string) => {
    dispatch({type: SETTINGS_QUERY_SET, query});
  },
  onCategorySelect: (category: SettingsCategorySelection) => {
    dispatch({type: SETTINGS_CATEGORY_SELECT, category});
  },
  onClearFilters: () => {
    dispatch({type: SETTINGS_QUERY_SET, query: ''});
    dispatch({type: SETTINGS_CATEGORY_SELECT, category: 'all'});
  },
  onOpenConfigFile: () => {
    transport.emit('command', asCommandId('window:openConfigFile'));
  }
});

export const SettingsContainer = connect(mapStateToProps, mapDispatchToProps, null)(Settings, 'Settings');

export type SettingsConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
export default SettingsContainer;
