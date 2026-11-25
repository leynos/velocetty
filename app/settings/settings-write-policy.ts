/**
 * @file The main process's write-time policy for core settings.
 *
 * This is the authority the renderer cannot bypass: a write is refused unless
 * the key is on this list and the value satisfies the rule for it. The rules
 * are deliberately stricter than the load schema, which must keep accepting
 * every file that loads today, so no existing config starts falling back to
 * defaults because of the settings tab.
 *
 * The list is written out rather than derived from the catalogue so a
 * catalogue change that is not mirrored here fails the parity suite.
 */

import type {CoreSettingKey} from '@shared/settings/core-catalogue';
import {isBoolean, isNumber, isString} from '../utils/runtime-guards';
import type {configValidationDiagnostic} from '@shared/types/config';
import type {JsonValue} from '@shared/types/json';

// The main process is compiled to CommonJS without the `@shared` alias, so it
// may import only types from `shared/`. This mirrors `isColourValue` in
// `shared/src/settings/coerce.ts`; the parity suite cross-checks the two.
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOUR = /^rgba?\(\s*[0-9.%\s,/+-]+\)$/i;

const isColourValue = (text: string): boolean => HEX_COLOUR.test(text) || FUNCTIONAL_COLOUR.test(text);

/** The bounds a numeric write must satisfy. */
export type NumericWriteRule = {
  readonly kind: 'number';
  readonly minimum: number;
  readonly maximum: number;
  readonly isInteger: boolean;
};

/** The values a select write must choose from. */
export type SelectWriteRule = {
  readonly kind: 'select';
  readonly options: readonly string[];
};

/** A rule that only checks the value's runtime type. */
export type SimpleWriteRule = {readonly kind: 'boolean' | 'text' | 'colour'};

/** One key's write rule. */
export type WriteRule = NumericWriteRule | SelectWriteRule | SimpleWriteRule;

const CURSOR_STYLE_SETTING_KEY = 'cursorShape' as const;

const number = (minimum: number, maximum: number, isInteger: boolean): NumericWriteRule => ({
  kind: 'number',
  minimum,
  maximum,
  isInteger
});

const select = (options: readonly string[]): SelectWriteRule => ({kind: 'select', options});

/**
 * Every executable write rule, keyed by the core setting it governs.
 *
 * The numbers mirror the catalogue's controls; the parity suite compares them.
 */
export const SETTINGS_WRITE_POLICY: Readonly<Record<CoreSettingKey, WriteRule>> = {
  backgroundColor: {kind: 'colour'},
  borderColor: {kind: 'colour'},
  copyOnSelect: {kind: 'boolean'},
  cursorAccentColor: {kind: 'colour'},
  cursorBlink: {kind: 'boolean'},
  cursorColor: {kind: 'colour'},
  [CURSOR_STYLE_SETTING_KEY]: select(['BEAM', 'BLOCK', 'UNDERLINE']),
  defaultSSHApp: {kind: 'boolean'},
  disableAutoUpdates: {kind: 'boolean'},
  disableLigatures: {kind: 'boolean'},
  fontFamily: {kind: 'text'},
  fontSize: number(6, 100, false),
  foregroundColor: {kind: 'colour'},
  imageSupport: {kind: 'boolean'},
  letterSpacing: number(-20, 50, false),
  lineHeight: number(0.5, 5, false),
  macOptionSelectionMode: {kind: 'text'},
  padding: {kind: 'text'},
  preserveCWD: {kind: 'boolean'},
  quickEdit: {kind: 'boolean'},
  screenReaderMode: {kind: 'boolean'},
  scrollback: number(0, 100_000, false),
  selectionColor: {kind: 'colour'},
  shell: {kind: 'text'},
  uiFontFamily: {kind: 'text'},
  updateChannel: select(['canary', 'stable']),
  useConpty: {kind: 'boolean'},
  webGLRenderer: {kind: 'boolean'},
  webGLRendererMaxContexts: number(1, 32, true),
  webLinksActivationKey: select(['', 'alt', 'ctrl', 'meta', 'shift']),
  workingDirectory: {kind: 'text'}
};

const WRITABLE_KEYS: ReadonlySet<string> = new Set<string>(Object.keys(SETTINGS_WRITE_POLICY));

/**
 * Reports whether the settings tab may write a key.
 *
 * @param key - A config key.
 * @returns True when the key is on the write allow-list.
 *
 * @example
 * isWritableSettingKey('fontSize'); // true
 * isWritableSettingKey('colors'); // false
 */
export const isWritableSettingKey = (key: string): key is CoreSettingKey => WRITABLE_KEYS.has(key);

const diagnostic = (key: string, message: string, suggestedFix: string): configValidationDiagnostic => ({
  path: `/config/${key}`,
  message,
  suggestedFix
});

const checkNumber = (key: string, rule: NumericWriteRule, value: JsonValue): configValidationDiagnostic[] => {
  if (!isNumber(value) || !Number.isFinite(value)) {
    return [diagnostic(key, 'Expected a number.', `Set \`${key}\` to a number.`)];
  }
  if (rule.isInteger && !Number.isInteger(value)) {
    return [diagnostic(key, 'Expected a whole number.', `Set \`${key}\` to a whole number.`)];
  }
  if (value < rule.minimum) {
    return [diagnostic(key, `Expected at least ${rule.minimum}.`, `Set \`${key}\` to ${rule.minimum} or more.`)];
  }
  if (value > rule.maximum) {
    return [diagnostic(key, `Expected at most ${rule.maximum}.`, `Set \`${key}\` to ${rule.maximum} or less.`)];
  }
  return [];
};

const checkValue = (key: string, rule: WriteRule, value: JsonValue): configValidationDiagnostic[] => {
  switch (rule.kind) {
    case 'boolean': {
      return isBoolean(value) ? [] : [diagnostic(key, 'Expected true or false.', `Set \`${key}\` to true or false.`)];
    }
    case 'select': {
      return isString(value) && rule.options.includes(value)
        ? []
        : [
            diagnostic(
              key,
              `Expected one of: ${rule.options.map((option) => (option === '' ? '(none)' : option)).join(', ')}.`,
              `Choose a supported value for \`${key}\`.`
            )
          ];
    }
    case 'number': {
      return checkNumber(key, rule, value);
    }
    case 'colour': {
      return isString(value) && isColourValue(value)
        ? []
        : [diagnostic(key, 'Expected a colour value.', `Set \`${key}\` to a colour such as #1a2b3c.`)];
    }
    case 'text': {
      return isString(value) && value.trim().length > 0
        ? []
        : [diagnostic(key, 'Expected non-empty text.', `Set \`${key}\` to a non-empty string.`)];
    }
  }
};

/**
 * Checks one write against the policy.
 *
 * @param key - The key the write targets.
 * @param value - The value the renderer asked to write.
 * @returns Diagnostics when the write is refused; empty when it is allowed.
 *
 * @example
 * checkWritePolicy('fontSize', 16); // []
 * checkWritePolicy('fontSize', -3)[0].path; // '/config/fontSize'
 */
export const checkWritePolicy = (key: string, value: JsonValue): configValidationDiagnostic[] => {
  if (!isWritableSettingKey(key)) {
    return [diagnostic(key, 'This setting is not editable here.', 'Edit it in the config file instead.')];
  }
  return checkValue(key, SETTINGS_WRITE_POLICY[key], value);
};
