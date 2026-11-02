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

export function getColorMap(colors: ColorMap): ColorMap;
export function getColorMap(colors: readonly string[]): Record<string, string>;
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

const isColorMap = (colors: ColorMap | readonly string[]): colors is ColorMap => !Array.isArray(colors);

/**
 * Fills a configuration's unset colours from the bundled defaults.
 *
 * A bundled config that could not be read or parsed has no `colors` section,
 * so the user's own colours are kept rather than dereferencing `undefined`.
 *
 * @param colors - The configuration's colours, as a map or a legacy list.
 * @param defaultColors - The bundled defaults; absent or partial when the
 * bundled config could not be read.
 * @returns A new colour map with the defaults underneath the user's values.
 *
 * @example
 * ```ts
 * withDefaultColors(['#111'], {black: '#000'}); // {black: '#111'}
 * ```
 */
export const withDefaultColors = (colors: ColorMap | readonly string[], defaultColors?: Partial<ColorMap>): ColorMap =>
  // Spreading `undefined` is a no-op, so an unavailable bundled config needs no
  // placeholder object. SAFETY: `ColorMap` is total, but a bundled config that
  // never loaded has no colours at all. The cast records that degraded
  // packaging state instead of inventing values; every colour the user set is
  // still present.
  ({...defaultColors, ...(isColorMap(colors) ? colors : getColorMap(colors))}) as ColorMap;
