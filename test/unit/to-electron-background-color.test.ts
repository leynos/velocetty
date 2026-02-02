/** @file Ensures Electron background colours normalize to hex values. */
import {expect, test} from 'bun:test';

import toElectronBackgroundColor from '../../app/utils/to-electron-background-color';
import {isHexColor} from '../testUtils/is-hex-color';

test(`returns a color that's in hex`, () => {
  const inputs = [
    '#BADA55',
    'rgb(0, 0, 0)',
    'rgba(0, 0, 0, 0.55)',
    'hsl(15, 100%, 50%)',
    'hsla(15, 100%, 50%, 1)',
    'pink'
  ];

  inputs.forEach((input) => {
    expect(isHexColor(toElectronBackgroundColor(input))).toBe(true);
  });
});
