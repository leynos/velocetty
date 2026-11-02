/** @file Verifies colour-map normalisation and the bundled-default fallback. */
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';

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

test('the last-resort palette matches the bundled defaults', () => {
  // SAFETY: `config-default.json` is repository-owned and this test reads only
  // its `colors` object, so the asserted shape is the part under test.
  const bundled = JSON.parse(
    readFileSync(new URL('../../app/config/config-default.json', import.meta.url), 'utf8')
  ) as {config: {colors: Record<string, string>}};

  // An empty legacy list leaves only the last-resort palette, so this compares
  // the degraded-package fallback with the file it stands in for.
  const fallback = withDefaultColors([]);
  expect(Object.keys(fallback)).toHaveLength(16);
  const expected = Object.fromEntries(Object.keys(fallback).map((slot) => [slot, bundled.config.colors[slot]]));
  // SAFETY: `expected` is keyed by `Object.keys(fallback)`, so it carries every
  // `ColorMap` slot; `Object.fromEntries` merely widens the key type.
  expect(fallback).toEqual(expected as ColorMap);
});
