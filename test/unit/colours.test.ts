/** @file Verifies colour-map normalisation and the bundled-default fallback. */
import {expect, test} from 'bun:test';

import type {ColorMap} from '@shared/types/config';

import {getColorMap, withDefaultColors} from '../../app/utils/colours';

/** A complete bundled palette, so a partial override has something to fall on. */
const bundledDefaults: ColorMap = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  green: '#00ff00',
  lightBlack: '#808080',
  lightBlue: '#8080ff',
  lightCyan: '#80ffff',
  lightGreen: '#80ff80',
  lightMagenta: '#ff80ff',
  lightRed: '#ff8080',
  lightWhite: '#ffffff',
  lightYellow: '#ffff80',
  magenta: '#ff00ff',
  red: '#ff0000',
  white: '#ffffff',
  yellow: '#ffff00'
};

const userColors: ColorMap = {...bundledDefaults, black: '#111111', red: '#ff1111'};

test('getColorMap maps a legacy colour list onto the named slots', () => {
  expect(getColorMap(['#000', '#f00'])).toEqual({black: '#000', red: '#f00'});
});

test('getColorMap returns a colour map unchanged', () => {
  expect(getColorMap(userColors)).toBe(userColors);
});

test('withDefaultColors keeps the user colours over the bundled defaults', () => {
  expect(withDefaultColors(userColors, bundledDefaults)).toEqual(userColors);
});

test('withDefaultColors keeps the user colours when the bundled defaults are unavailable', () => {
  // A bundled config that could not be read or parsed has no `colors` section,
  // so the fallback must neither throw nor drop the user's own colours.
  expect(withDefaultColors(userColors)).toEqual(userColors);
});
