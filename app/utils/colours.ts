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
