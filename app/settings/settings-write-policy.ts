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
// The terminal parses a colour with `color-string`, which accepts a lowercase
// `rgb`/`rgba` function whose three channels share one unit: all integers or
// all percentages. It rejects a decimal integer channel, mixed units, and an
// uppercase function name, and the alpha may be a decimal or a percentage. Both
// validators use this grammar, so a value they accept cannot later throw in
// `getTermOptions`. Anything else — `rgb(+)`, `rgba(,,,)`, a missing channel —
// is not a colour the terminal can show.
const COLOUR_INTEGER = String.raw`[+-]?\d+`;
const COLOUR_PERCENTAGE = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)%`;
const COLOUR_ALPHA = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?`;
const COMMA_CHANNELS = String.raw`(?:${COLOUR_INTEGER}(?:\s*,\s*${COLOUR_INTEGER}){2}|${COLOUR_PERCENTAGE}(?:\s*,\s*${COLOUR_PERCENTAGE}){2})`;
const SPACE_CHANNELS = String.raw`(?:${COLOUR_INTEGER}(?:\s+${COLOUR_INTEGER}){2}|${COLOUR_PERCENTAGE}(?:\s+${COLOUR_PERCENTAGE}){2})`;
const FUNCTIONAL_COLOUR = new RegExp(
  String.raw`^rgba?\(\s*(?:${COMMA_CHANNELS}|${SPACE_CHANNELS})(?:\s*[,/]\s*${COLOUR_ALPHA})?\s*\)$`
);

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

/** The bounds a numeric rule carries, before it is tagged with its kind. */
type NumericRuleBounds = Omit<NumericWriteRule, 'kind'>;

const CURSOR_STYLE_SETTING_KEY = 'cursorShape' as const;

const number = ({minimum, maximum, isInteger}: NumericRuleBounds): NumericWriteRule => ({
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
  fontSize: number({minimum: 6, maximum: 100, isInteger: false}),
  foregroundColor: {kind: 'colour'},
  imageSupport: {kind: 'boolean'},
  letterSpacing: number({minimum: -20, maximum: 50, isInteger: false}),
  lineHeight: number({minimum: 0.5, maximum: 5, isInteger: false}),
  macOptionSelectionMode: {kind: 'text'},
  padding: {kind: 'text'},
  preserveCWD: {kind: 'boolean'},
  quickEdit: {kind: 'boolean'},
  screenReaderMode: {kind: 'boolean'},
  scrollback: number({minimum: 0, maximum: 100_000, isInteger: false}),
  selectionColor: {kind: 'colour'},
  shell: {kind: 'text'},
  uiFontFamily: {kind: 'text'},
  updateChannel: select(['canary', 'stable']),
  useConpty: {kind: 'boolean'},
  webGLRenderer: {kind: 'boolean'},
  webGLRendererMaxContexts: number({minimum: 1, maximum: 32, isInteger: true}),
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

/** One proposed write: the key, the rule it must satisfy, and the offered value. */
type WriteCheck<Rule extends WriteRule = WriteRule> = {
  readonly key: string;
  readonly rule: Rule;
  readonly value: JsonValue;
};

/** The refusal wording attached to a diagnostic. */
type WriteRefusal = {
  readonly message: string;
  readonly suggestedFix: string;
};

const refuse = (check: WriteCheck, refusal: WriteRefusal): configValidationDiagnostic[] => [
  {path: `/config/${check.key}`, ...refusal}
];

const checkBoolean = (check: WriteCheck<SimpleWriteRule>): configValidationDiagnostic[] => {
  const {key, value} = check;
  return isBoolean(value)
    ? []
    : refuse(check, {message: 'Expected true or false.', suggestedFix: `Set \`${key}\` to true or false.`});
};

const checkSelect = (check: WriteCheck<SelectWriteRule>): configValidationDiagnostic[] => {
  const {key, rule, value} = check;
  if (isString(value) && rule.options.includes(value)) {
    return [];
  }
  const labels = rule.options.map((option) => (option === '' ? '(none)' : option)).join(', ');
  return refuse(check, {
    message: `Expected one of: ${labels}.`,
    suggestedFix: `Choose a supported value for \`${key}\`.`
  });
};

const checkNumber = (check: WriteCheck<NumericWriteRule>): configValidationDiagnostic[] => {
  const {key, rule, value} = check;
  if (!isNumber(value) || !Number.isFinite(value)) {
    return refuse(check, {message: 'Expected a number.', suggestedFix: `Set \`${key}\` to a number.`});
  }
  if (rule.isInteger && !Number.isInteger(value)) {
    return refuse(check, {message: 'Expected a whole number.', suggestedFix: `Set \`${key}\` to a whole number.`});
  }
  if (value < rule.minimum) {
    return refuse(check, {
      message: `Expected at least ${rule.minimum}.`,
      suggestedFix: `Set \`${key}\` to ${rule.minimum} or more.`
    });
  }
  if (value > rule.maximum) {
    return refuse(check, {
      message: `Expected at most ${rule.maximum}.`,
      suggestedFix: `Set \`${key}\` to ${rule.maximum} or less.`
    });
  }
  return [];
};

const checkColour = (check: WriteCheck<SimpleWriteRule>): configValidationDiagnostic[] => {
  const {key, value} = check;
  return isString(value) && isColourValue(value)
    ? []
    : refuse(check, {message: 'Expected a colour value.', suggestedFix: `Set \`${key}\` to a colour such as #1a2b3c.`});
};

const checkText = (check: WriteCheck<SimpleWriteRule>): configValidationDiagnostic[] => {
  const {key, value} = check;
  return isString(value) && value.trim().length > 0
    ? []
    : refuse(check, {message: 'Expected non-empty text.', suggestedFix: `Set \`${key}\` to a non-empty string.`});
};

const checkValue = ({key, rule, value}: WriteCheck): configValidationDiagnostic[] => {
  switch (rule.kind) {
    case 'boolean': {
      return checkBoolean({key, rule, value});
    }
    case 'select': {
      return checkSelect({key, rule, value});
    }
    case 'number': {
      return checkNumber({key, rule, value});
    }
    case 'colour': {
      return checkColour({key, rule, value});
    }
    case 'text': {
      return checkText({key, rule, value});
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
    return [
      {
        path: `/config/${key}`,
        message: 'This setting is not editable here.',
        suggestedFix: 'Edit it in the config file instead.'
      }
    ];
  }
  return checkValue({key, rule: SETTINGS_WRITE_POLICY[key], value});
};
