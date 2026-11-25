/**
 * @file Turns raw control text into a typed setting value.
 *
 * The renderer uses this to reject malformed input before asking the main
 * process to write. It is a usability check, not the authority: the main
 * process validates every write again, so a coercion bug cannot corrupt the
 * config file on its own.
 */

import type {ControlDescriptor} from './panel-model';

/** A value the settings UI can hold for a core setting. */
export type SettingValue = string | number | boolean;

/** Why a raw input was rejected. */
export type CoercionFailureReason =
  | 'empty'
  | 'not-a-number'
  | 'not-an-integer'
  | 'below-minimum'
  | 'above-maximum'
  | 'not-an-option'
  | 'not-a-colour';

/** A rejection, carrying the bounds a message may want to name. */
export type CoercionFailure = {
  readonly reason: CoercionFailureReason;
  readonly minimum?: number;
  readonly maximum?: number;
};

/** The result of coercing one raw input. */
export type CoercionResult =
  | {readonly ok: true; readonly value: SettingValue}
  | {readonly ok: false; readonly failure: CoercionFailure};

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOUR = /^rgba?\(\s*[0-9.%\s,/+-]+\)$/i;
// `Number` also accepts `0x10`, `Infinity`, and `1_000`. A setting value is a
// decimal number, so accept decimal syntax only; `Number.parseFloat` is worse
// still because it accepts a numeric prefix (`"12abc"` becomes 12).
const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Reports whether text is a colour the renderer accepts.
 *
 * @param text - Candidate colour text.
 * @returns True for `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, or
 * `rgba(...)` forms.
 *
 * @example
 * isColourValue('#1a2b3c'); // true
 * isColourValue('rgba(0, 0, 0, 0.5)'); // true
 * isColourValue('tomato'); // false
 */
export const isColourValue = (text: string): boolean => HEX_COLOUR.test(text) || FUNCTIONAL_COLOUR.test(text);

const rejected = (reason: CoercionFailureReason, minimum?: number, maximum?: number): CoercionResult => {
  if (minimum !== undefined && maximum !== undefined) {
    return {ok: false, failure: {reason, minimum, maximum}};
  }
  if (minimum !== undefined) {
    return {ok: false, failure: {reason, minimum}};
  }
  if (maximum !== undefined) {
    return {ok: false, failure: {reason, maximum}};
  }
  return {ok: false, failure: {reason}};
};

const coerceNumber = (control: Extract<ControlDescriptor, {kind: 'number'}>, trimmed: string): CoercionResult => {
  if (trimmed.length === 0) {
    return rejected('empty');
  }
  if (!DECIMAL_NUMBER.test(trimmed)) {
    return rejected('not-a-number');
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return rejected('not-a-number');
  }
  if (control.isInteger && !Number.isInteger(value)) {
    return rejected('not-an-integer');
  }
  if (value < control.minimum) {
    return rejected('below-minimum', control.minimum, control.maximum);
  }
  if (value > control.maximum) {
    return rejected('above-maximum', control.minimum, control.maximum);
  }
  return {ok: true, value};
};

const coerceSelect = (control: Extract<ControlDescriptor, {kind: 'select'}>, raw: string): CoercionResult => {
  if (control.options.includes(raw)) {
    return {ok: true, value: raw};
  }
  return rejected(raw.length === 0 ? 'empty' : 'not-an-option');
};

/**
 * Coerces raw control text into a typed value.
 *
 * @param control - The control the text came from.
 * @param raw - The raw input text.
 * @returns The typed value, or the reason it was rejected.
 *
 * @example
 * coerceInput({kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false}, '16');
 * // {ok: true, value: 16}
 * coerceInput({kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false}, 'abc');
 * // {ok: false, failure: {reason: 'not-a-number'}}
 */
export const coerceInput = (control: ControlDescriptor, raw: string): CoercionResult => {
  const trimmed = raw.trim();
  switch (control.kind) {
    case 'toggle': {
      if (raw === 'true') {
        return {ok: true, value: true};
      }
      if (raw === 'false') {
        return {ok: true, value: false};
      }
      return rejected('not-an-option');
    }
    case 'select': {
      return coerceSelect(control, raw);
    }
    case 'number': {
      return coerceNumber(control, trimmed);
    }
    case 'colour': {
      if (trimmed.length === 0) {
        return rejected('empty');
      }
      return isColourValue(trimmed) ? {ok: true, value: trimmed} : rejected('not-a-colour');
    }
    case 'text': {
      return trimmed.length === 0 ? rejected('empty') : {ok: true, value: raw};
    }
  }
};

/**
 * Formats a value for display in its control.
 *
 * @param control - The control that will show the value.
 * @param value - The stored value; absent values are shown as empty text.
 * @returns The display text.
 *
 * @example
 * formatValue({kind: 'toggle'}, true); // 'true'
 * formatValue({kind: 'number', minimum: 6, maximum: 100, step: 1, isInteger: false}, 14); // '14'
 */
export const formatValue = (control: ControlDescriptor, value: SettingValue | undefined): string => {
  if (value === undefined) {
    return '';
  }
  if (control.kind === 'toggle') {
    return value === true ? 'true' : 'false';
  }
  return String(value);
};
