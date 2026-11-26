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

import {buildCorePanelModel, coreKeyFromSettingId} from '@shared/settings/core-catalogue';

import {SettingsView, type SettingsViewStrings} from '../settings/components/settings-view';
import {bannerFor, disabledReasonFor} from '../settings/file-state-messages';
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

const FIELD_DEFINITIONS: readonly FieldDefinition[] = buildCorePanelModel().sections.flatMap((section) =>
  section.fields.flatMap((field): FieldDefinition[] => {
    const key = coreKeyFromSettingId(field.id);
    return key === undefined ? [] : [{id: field.id, target: {scope: 'core', key}, control: field.control}];
  })
);

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
