/** @file Normalizes legacy and bundled colour configuration into a complete `ColorMap`. */
/*
 * `getColorMap` accepts either the modern map or the legacy positional list,
 * and `withDefaultColors` layers the bundled defaults underneath the user's
 * colours. `app/config.ts` uses both when it resolves the effective
 * configuration, and `lib/components/term.tsx` reads every slot into xterm's
 * theme, so the result must always be total.
 */
import type {ColorMap} from '@shared/types/config';

const colorList = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'lightBlack',
  'lightRed',
  'lightGreen',
  'lightYellow',
  'lightBlue',
  'lightMagenta',
  'lightCyan',
  'lightWhite',
  'colorCubes',
  'grayscale'
];

/**
 * Maps a legacy positional colour list onto the named `ColorMap` slots.
 *
 * A `ColorMap` is returned unchanged, so callers may pass either shape.
 *
 * @param colors - A colour map, or the legacy list in xterm's slot order.
 * @returns The named map; a legacy list yields only the slots it supplies.
 *
 * @example
 * ```ts
 * getColorMap(['#000', '#f00']); // {black: '#000', red: '#f00'}
 * ```
 */
export function getColorMap(colors: ColorMap): ColorMap;
export function getColorMap(colors: readonly string[]): Record<string, string>;
/**
 * Accepts either supported colour shape and normalizes it to named slots.
 *
 * @param colors - A colour map, or the legacy positional list.
 * @returns The map unchanged, or the list's named slots.
 */
export function getColorMap(colors: ColorMap | readonly string[]): ColorMap | Record<string, string> {
  if (isColorMap(colors)) {
    return colors;
  }
  const result: Record<string, string> = {};
  for (const [index, color] of colors.entries()) {
    if (index < colorList.length) {
      result[colorList[index]] = color;
    }
  }
  return result;
}

/** Narrows the union to the map shape; a legacy colour list is an array. */
const isColorMap = (colors: ColorMap | readonly string[]): colors is ColorMap => !Array.isArray(colors);

/**
 * The last-resort palette used when the bundled configuration cannot be read.
 *
 * It mirrors the `colors` section of `app/config/config-default.json`, and a
 * parity test keeps the two in step. It exists so a degraded package still
 * yields a complete `ColorMap`; xterm would otherwise receive `undefined` for
 * every slot the user did not set.
 */
const FALLBACK_COLORS: ColorMap = {
  black: '#000000',
  blue: '#0A2FC4',
  cyan: '#20C5C6',
  green: '#1DC121',
  lightBlack: '#686868',
  lightBlue: '#6A76FB',
  lightCyan: '#68FDFE',
  lightGreen: '#67F86F',
  lightMagenta: '#FD7CFC',
  lightRed: '#FD6F6B',
  lightWhite: '#FFFFFF',
  lightYellow: '#FFFA72',
  magenta: '#C839C5',
  red: '#C51E14',
  white: '#C7C7C7',
  yellow: '#C7C329'
};

/**
 * Returns a copy of the last-resort palette.
 *
 * The composition tests compare a completed colour map against the whole
 * palette, so they need the same values this module falls back to. A copy
 * keeps a caller from mutating the constant the fill relies on.
 *
 * @returns A fresh map holding every palette slot.
 *
 * @example
 * ```ts
 * fallbackColors().black; // '#000000'
 * ```
 */
export const fallbackColors = (): ColorMap => ({...FALLBACK_COLORS});

/**
 * Fills a configuration's unset colours from the bundled defaults.
 *
 * A bundled config that could not be read or parsed has no `colors` section,
 * so the last-resort palette stands in for it. The user's own colours always
 * win, and the result is always a complete map.
 *
 * @param colors - The configuration's colours, as a map or a legacy list.
 * @param defaultColors - The bundled defaults; absent or partial when the
 * bundled config could not be read.
 * @returns A new colour map with the defaults underneath the user's values.
 *
 * @example
 * ```ts
 * withDefaultColors(['#111'], {black: '#000'}).black; // '#111'
 * ```
 */
export const withDefaultColors = (
  colors: ColorMap | readonly string[],
  defaultColors?: Partial<ColorMap>
): ColorMap => ({
  ...FALLBACK_COLORS,
  ...defaultColors,
  ...(isColorMap(colors) ? colors : getColorMap(colors))
});
