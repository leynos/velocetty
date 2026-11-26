/**
 * @file English strings for the settings tab.
 *
 * Labels are typed against `CoreSettingKey`, so adding a catalogue entry
 * without a label is a compile error rather than a blank row. Descriptions are
 * written here rather than read from the schema, whose JSDoc is aimed at
 * developers.
 */

import {createTranslator} from '../../i18n/create-translator';

import type {FieldError, FieldErrorCode} from '../field-store';

import type {CoreSettingKey} from '@shared/settings/core-catalogue';
import type {SettingCategoryId} from '@shared/settings/panel-model';

const CURSOR_STYLE_LABEL_KEY = 'cursorShape' as const;

/** One human-readable label per editable setting. */
export const settingLabels: Readonly<Record<CoreSettingKey, string>> = {
  backgroundColor: 'Background colour',
  borderColor: 'Border colour',
  copyOnSelect: 'Copy on select',
  cursorAccentColor: 'Cursor accent colour',
  cursorBlink: 'Blink cursor',
  cursorColor: 'Cursor colour',
  [CURSOR_STYLE_LABEL_KEY]: 'Cursor shape',
  defaultSSHApp: 'Open SSH links in the default app',
  disableAutoUpdates: 'Disable automatic updates',
  disableLigatures: 'Disable ligatures',
  fontFamily: 'Font family',
  fontSize: 'Font size',
  foregroundColor: 'Text colour',
  imageSupport: 'Image support',
  letterSpacing: 'Letter spacing',
  lineHeight: 'Line height',
  macOptionSelectionMode: 'Option key selection mode',
  padding: 'Padding',
  preserveCWD: 'Preserve working directory',
  quickEdit: 'Quick edit',
  screenReaderMode: 'Screen reader mode',
  scrollback: 'Scrollback',
  selectionColor: 'Selection colour',
  shell: 'Shell',
  uiFontFamily: 'UI font family',
  updateChannel: 'Update channel',
  useConpty: 'Use ConPTY',
  webGLRenderer: 'WebGL renderer',
  webGLRendererMaxContexts: 'WebGL contexts',
  webLinksActivationKey: 'Link activation key',
  workingDirectory: 'Working directory'
};

/** A short explanation per setting, used in search and shown under the label. */
export const settingDescriptions: Partial<Record<CoreSettingKey, string>> = {
  fontFamily: 'The font used for terminal text.',
  fontSize: 'Text size in pixels.',
  letterSpacing: 'Extra space between characters, in pixels.',
  lineHeight: 'Line height as a multiple of the font size.',
  padding: 'Space around the terminal text.',
  scrollback: 'How many lines of history the terminal keeps.',
  shell: 'The program started in a new terminal.',
  updateChannel: 'Stable receives polished releases; canary is more frequent.',
  workingDirectory: 'The directory a new terminal starts in.',
  webGLRenderer: 'Use the GPU renderer; turn it off if rendering glitches.',
  webGLRendererMaxContexts: 'How many terminals may share WebGL contexts.'
};

/** One label per navigation category. */
export const categoryLabels: Readonly<Record<SettingCategoryId, string>> = {
  appearance: 'Appearance',
  colours: 'Colours',
  cursor: 'Cursor',
  rendering: 'Rendering',
  terminal: 'Terminal',
  updates: 'Updates'
};

/** Reads a setting label. Stable, so hooks can depend on it. */
export const settingLabel = (key: CoreSettingKey): string => settingLabels[key];

/** Reads a setting description, if one is written. */
export const settingDescription = (key: CoreSettingKey): string | undefined => settingDescriptions[key];

/** Reads a category label. Stable, so hooks can depend on it. */
export const categoryLabel = (id: SettingCategoryId): string => categoryLabels[id];

/** Fixed interface strings for the settings tab. */
export const settingsStrings = {
  title: 'Settings',
  search: 'Search settings',
  searchPlaceholder: 'Search settings, or type @modified',
  categories: 'Settings categories',
  results: 'Settings results',
  allSettings: 'All settings',
  noResults: 'No settings match',
  clearFilters: 'Clear search and category',
  openConfigFile: 'Open config file',
  unparseableBanner: 'The config file has a syntax error, so settings cannot be saved until it is fixed.',
  legacyRow: 'The legacy hyper.json file is read-only here.',
  unparseableRow: 'Fix the config file syntax before saving.',
  invalidRow: 'Fix the other invalid settings first.',
  missingRow: 'No config file exists yet, so this setting cannot be saved.',
  invalidBanner: 'The config file has invalid values. Fix the highlighted settings, or open the file.',
  legacyBanner: 'This configuration uses the legacy hyper.json file, which the settings tab cannot change.',
  missingBanner:
    'No config file exists yet, so settings cannot be saved from this tab. Open the file to create it, or restart Velocetty.',
  modifiedNote: 'Changed from the default.'
} as const;

/**
 * Formats a result count for the live region.
 *
 * @param count - The number of matching settings.
 * @returns A short sentence fragment.
 *
 * @example
 * formatResultCount(1); // '1 setting'
 */
export const formatResultCount = (count: number): string => (count === 1 ? '1 setting' : `${count} settings`);

/** The bundle a settings component needs. */
export type SettingsTranslation = {
  readonly t: (key: string) => string;
  readonly label: (key: CoreSettingKey) => string;
  readonly description: (key: CoreSettingKey) => string | undefined;
  readonly category: (id: SettingCategoryId) => string;
};

/**
 * Builds the settings translation bundle.
 *
 * @returns The translator, label, description, and category helpers.
 *
 * @example
 * useSettingsTranslation().label('fontSize'); // 'Font size'
 */
export const useSettingsTranslation = (): SettingsTranslation => {
  const t = createTranslator(settingsStrings);
  return {
    t,
    label: (key) => settingLabels[key],
    description: (key) => settingDescriptions[key],
    category: (id) => categoryLabels[id]
  };
};

type ErrorDescriber = (error: FieldError) => string;

const describeMinimum = (error: FieldError): string =>
  error.minimum === undefined ? 'Enter a larger number' : `Enter ${error.minimum} or more`;

const describeMaximum = (error: FieldError): string =>
  error.maximum === undefined ? 'Enter a smaller number' : `Enter ${error.maximum} or less`;

/** The fallback text for each reason, used when no message came with the error. */
const errorDescribers: Readonly<Record<FieldErrorCode, ErrorDescriber>> = {
  empty: () => 'Enter a value',
  'not-a-number': () => 'Enter a number',
  'not-an-integer': () => 'Enter a whole number',
  'below-minimum': describeMinimum,
  'above-maximum': describeMaximum,
  'not-an-option': () => 'Choose a supported value',
  'not-a-colour': () => 'Enter a colour such as #1a2b3c',
  rejected: () => 'The config change was rejected',
  failed: () => 'The config file could not be written'
};

/**
 * Turns a field error into a message a user can act on.
 *
 * A main-process diagnostic carries its own message and fix, so those win; a
 * local coercion failure is named by its reason code.
 *
 * @param error - The field error to describe.
 * @returns The message for the row.
 *
 * @example
 * describeFieldError({code: 'not-a-number'}); // 'Enter a number'
 */
export const describeFieldError = (error: FieldError): string => {
  const message = error.message;
  if (message !== undefined && message.trim().length > 0) {
    return error.suggestedFix === undefined ? message : `${message} ${error.suggestedFix}`;
  }
  return errorDescribers[error.code](error);
};
