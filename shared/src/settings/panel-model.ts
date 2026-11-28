/**
 * @file Presentation model for the settings panel.
 *
 * The model is the single shape the settings view renders. The core catalogue
 * is one producer of it; roadmap 5.2.1 adds plugin schemas as a second
 * producer, so nothing here may mention a specific config key or a transport.
 */

/** Opaque identity for one setting, independent of its storage key. */
export type SettingId = string & {readonly brand: 'SettingId'};

/**
 * Brands a raw string as a setting id.
 *
 * @param value - The raw id text.
 * @returns The branded id.
 *
 * @example
 * settingId('core:fontSize'); // 'core:fontSize'
 */
export const settingId = (value: string): SettingId =>
  // SAFETY: the brand exists only in the type system; the runtime value is the
  // same string the caller supplied, and every producer builds ids from a
  // fixed prefix plus a validated key.
  value as SettingId;

/** Categories shown in the settings navigation, in display order. */
export const SETTING_CATEGORY_IDS = ['appearance', 'cursor', 'colours', 'terminal', 'rendering', 'updates'] as const;

/** One settings category. */
export type SettingCategoryId = (typeof SETTING_CATEGORY_IDS)[number];

/** The input control a field renders. */
export type ControlDescriptor =
  | {readonly kind: 'toggle'}
  | {readonly kind: 'select'; readonly options: readonly string[]}
  | {
      readonly kind: 'number';
      readonly minimum: number;
      readonly maximum: number;
      readonly step: number;
      readonly isInteger: boolean;
    }
  | {readonly kind: 'text'}
  | {readonly kind: 'colour'};

/** How a field's label is obtained. */
export type FieldLabel =
  | {readonly kind: 'key'; readonly key: string}
  | {readonly kind: 'literal'; readonly text: string};

/** One editable setting in the panel. */
export type PanelField = {
  readonly id: SettingId;
  readonly category: SettingCategoryId;
  readonly control: ControlDescriptor;
  readonly label: FieldLabel;
};

/** A group of fields under one category heading. */
export type PanelSection = {
  readonly category: SettingCategoryId;
  readonly label: FieldLabel;
  readonly fields: readonly PanelField[];
};

/** The whole panel: ordered sections, each with ordered fields. */
export type SettingsPanelModel = {
  readonly sections: readonly PanelSection[];
};
