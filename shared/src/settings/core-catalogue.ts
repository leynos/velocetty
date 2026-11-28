/**
 * @file The catalogue of core settings the settings tab can edit.
 *
 * Every property of the generated `configOptions` schema must appear exactly
 * once here or in `EXCLUDED_CONFIG_KEYS`, with a reason. A parity test
 * (`test/unit/settings-catalogue-parity.test.ts`) enforces that, so adding a
 * config option without deciding how it is presented is a test failure rather
 * than a silently unreachable setting.
 *
 * Bounds in this file are UI and write-time bounds. They are deliberately
 * stricter than the load schema, which must keep accepting every file that
 * loads today.
 */

import {
  type ControlDescriptor,
  type PanelField,
  type PanelSection,
  type SettingsPanelModel,
  type SettingCategoryId,
  SETTING_CATEGORY_IDS,
  settingId
} from './panel-model';

/** Every core setting the panel can edit. */
export type CoreSettingKey =
  | 'backgroundColor'
  | 'borderColor'
  | 'copyOnSelect'
  | 'cursorAccentColor'
  | 'cursorBlink'
  | 'cursorColor'
  | 'cursorShape'
  | 'defaultSSHApp'
  | 'disableAutoUpdates'
  | 'disableLigatures'
  | 'fontFamily'
  | 'fontSize'
  | 'foregroundColor'
  | 'imageSupport'
  | 'letterSpacing'
  | 'lineHeight'
  | 'macOptionSelectionMode'
  | 'padding'
  | 'preserveCWD'
  | 'quickEdit'
  | 'screenReaderMode'
  | 'scrollback'
  | 'selectionColor'
  | 'shell'
  | 'uiFontFamily'
  | 'updateChannel'
  | 'useConpty'
  | 'webGLRenderer'
  | 'webGLRendererMaxContexts'
  | 'webLinksActivationKey'
  | 'workingDirectory';

/** One catalogue entry: the key, its navigation category, and its control. */
export type CoreCatalogueEntry = {
  readonly key: CoreSettingKey;
  readonly category: SettingCategoryId;
  readonly control: ControlDescriptor;
};

const toggle: ControlDescriptor = {kind: 'toggle'};
const text: ControlDescriptor = {kind: 'text'};
const colour: ControlDescriptor = {kind: 'colour'};

const number = (minimum: number, maximum: number, step: number, isInteger: boolean): ControlDescriptor => ({
  kind: 'number',
  minimum,
  maximum,
  step,
  isInteger
});

const select = (options: readonly string[]): ControlDescriptor => ({kind: 'select', options});

/**
 * Core settings in display order.
 *
 * The order is the order the panel renders within each category, so it is
 * chosen for reading rather than alphabetically.
 */
export const CORE_SETTINGS_CATALOGUE: readonly CoreCatalogueEntry[] = [
  {key: 'fontFamily', category: 'appearance', control: text},
  {key: 'fontSize', category: 'appearance', control: number(6, 100, 1, false)},
  {key: 'letterSpacing', category: 'appearance', control: number(-20, 50, 0.5, false)},
  {key: 'lineHeight', category: 'appearance', control: number(0.5, 5, 0.1, false)},
  {key: 'padding', category: 'appearance', control: text},
  {key: 'uiFontFamily', category: 'appearance', control: text},
  {key: 'cursorBlink', category: 'cursor', control: toggle},
  {key: 'cursorShape', category: 'cursor', control: select(['BEAM', 'BLOCK', 'UNDERLINE'])},
  {key: 'cursorColor', category: 'cursor', control: colour},
  {key: 'cursorAccentColor', category: 'cursor', control: colour},
  {key: 'backgroundColor', category: 'colours', control: colour},
  {key: 'foregroundColor', category: 'colours', control: colour},
  {key: 'borderColor', category: 'colours', control: colour},
  {key: 'selectionColor', category: 'colours', control: colour},
  {key: 'copyOnSelect', category: 'terminal', control: toggle},
  {key: 'preserveCWD', category: 'terminal', control: toggle},
  {key: 'quickEdit', category: 'terminal', control: toggle},
  {key: 'screenReaderMode', category: 'terminal', control: toggle},
  {key: 'scrollback', category: 'terminal', control: number(0, 100_000, 100, false)},
  {key: 'shell', category: 'terminal', control: text},
  {key: 'workingDirectory', category: 'terminal', control: text},
  {key: 'defaultSSHApp', category: 'terminal', control: toggle},
  {key: 'useConpty', category: 'terminal', control: toggle},
  {key: 'macOptionSelectionMode', category: 'terminal', control: text},
  {key: 'webLinksActivationKey', category: 'terminal', control: select(['', 'alt', 'ctrl', 'meta', 'shift'])},
  {key: 'disableLigatures', category: 'rendering', control: toggle},
  {key: 'imageSupport', category: 'rendering', control: toggle},
  {key: 'webGLRenderer', category: 'rendering', control: toggle},
  {key: 'webGLRendererMaxContexts', category: 'rendering', control: number(1, 32, 1, true)},
  {key: 'updateChannel', category: 'updates', control: select(['canary', 'stable'])},
  {key: 'disableAutoUpdates', category: 'updates', control: toggle}
];

/**
 * Config keys the panel does not edit, each with the reason.
 *
 * These are structured values (objects, arrays, maps), unions that need a
 * bespoke control, or free-form code and CSS. Users edit them in the config
 * file; the settings tab offers an "Open config file" action for them.
 */
export const EXCLUDED_CONFIG_KEYS = {
  autoUpdatePlugins: 'boolean-or-duration union needs a bespoke control',
  bell: 'string-literal-or-false union needs a bespoke control',
  bellSound: 'nullable base64 payload; not a text field',
  bellSoundURL: 'nullable URL; not a text field',
  colors: 'structured colour map',
  css: 'free-form custom CSS',
  defaultProfile: 'profile names are a dynamic list',
  env: 'structured environment map',
  fontWeight: 'keyword-or-numeric union needs a bespoke control',
  fontWeightBold: 'keyword-or-numeric union needs a bespoke control',
  modifierKeys: 'structured modifier map',
  plugins: 'plugin namespaces are owned by the plugin runtime',
  profiles: 'structured profile list',
  shellArgs: 'string array',
  showHamburgerMenu: 'boolean-or-empty-string union',
  showWindowControls: 'boolean-or-string union',
  termCSS: 'free-form custom CSS',
  windowSize: 'fixed-length number tuple'
} satisfies Record<string, string>;

/** Every key the catalogue edits, in catalogue order. */
export const CORE_SETTING_KEYS: readonly CoreSettingKey[] = CORE_SETTINGS_CATALOGUE.map((entry) => entry.key);

const CORE_SETTING_KEY_SET: ReadonlySet<string> = new Set<string>(CORE_SETTING_KEYS);

const SETTING_ID_PREFIX = 'core:';

/**
 * Resolves a panel field id back to the config key it edits.
 *
 * @param id - A setting id produced by `buildCorePanelModel`.
 * @returns The core key, or undefined for an id from another producer.
 *
 * @example
 * coreKeyFromSettingId(settingId('core:fontSize')); // 'fontSize'
 */
export const coreKeyFromSettingId = (id: string): CoreSettingKey | undefined => {
  if (!id.startsWith(SETTING_ID_PREFIX)) {
    return undefined;
  }
  const key = id.slice(SETTING_ID_PREFIX.length);
  if (!CORE_SETTING_KEY_SET.has(key)) {
    return undefined;
  }
  // SAFETY: the set is built from `CORE_SETTINGS_CATALOGUE`, so membership
  // proves the string is one of the `CoreSettingKey` literals.
  return key as CoreSettingKey;
};

const toPanelField = (entry: CoreCatalogueEntry): PanelField => ({
  id: settingId(`${SETTING_ID_PREFIX}${entry.key}`),
  category: entry.category,
  control: entry.control,
  label: {kind: 'key', key: entry.key}
});

const PANEL_FIELDS_BY_CATEGORY: ReadonlyMap<SettingCategoryId, readonly PanelField[]> = new Map(
  SETTING_CATEGORY_IDS.map((category) => [
    category,
    CORE_SETTINGS_CATALOGUE.flatMap((entry) => (entry.category === category ? [toPanelField(entry)] : []))
  ])
);

const buildSection = (category: SettingCategoryId): PanelSection => ({
  category,
  label: {kind: 'key', key: `settings.category.${category}`},
  fields: PANEL_FIELDS_BY_CATEGORY.get(category) ?? []
});

/**
 * Builds the core settings panel model in display order.
 *
 * @returns Sections in `SETTING_CATEGORY_IDS` order, each with its fields in
 * catalogue order.
 *
 * @example
 * buildCorePanelModel().sections[0].category; // 'appearance'
 */
export const buildCorePanelModel = (): SettingsPanelModel => ({
  sections: SETTING_CATEGORY_IDS.map((category) => buildSection(category)).filter(
    (section) => section.fields.length > 0
  )
});
