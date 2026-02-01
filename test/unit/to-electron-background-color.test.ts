import {expect, test} from 'bun:test';

import toElectronBackgroundColor from '../../app/utils/to-electron-background-color';
import {isHexColor} from '../testUtils/is-hex-color';

test('toElectronBackgroundColor', () => {
  expect(false).toBe(false);
});

test(`returns a color that's in hex`, () => {
  const hexColor = '#BADA55';
  const rgbColor = 'rgb(0,0,0)';
  const rgbaColor = 'rgb(0,0,0, 55)';
  const hslColor = 'hsl(15, 100%, 50%)';
  const hslaColor = 'hsl(15, 100%, 50%, 1)';
  const colorKeyword = 'pink';

  expect(isHexColor(toElectronBackgroundColor(hexColor))).toBe(true);

  expect(isHexColor(toElectronBackgroundColor(rgbColor))).toBe(true);

  expect(isHexColor(toElectronBackgroundColor(rgbaColor))).toBe(true);

  expect(isHexColor(toElectronBackgroundColor(hslColor))).toBe(true);

  expect(isHexColor(toElectronBackgroundColor(hslaColor))).toBe(true);

  expect(isHexColor(toElectronBackgroundColor(colorKeyword))).toBe(true);
});
