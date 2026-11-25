/**
 * @file Guards the load path against accidental tightening.
 *
 * The settings tab writes with stricter bounds than the load schema may use.
 * These configurations are all plausible user files and must keep loading
 * without falling back to defaults; the last case is deliberately outside the
 * UI's write bounds to prove the two are separate.
 */
import {describe, expect, test} from 'bun:test';

import {safeParseRawConfig} from '../../app/config/json5-config';

import type {JsonValue} from '@shared/types/json';

const CORPUS: readonly {readonly name: string; readonly value: JsonValue}[] = [
  {name: 'fractional font size', value: {config: {fontSize: 14.5}}},
  {name: 'line height below one', value: {config: {lineHeight: 0.95}}},
  {name: 'negative letter spacing', value: {config: {letterSpacing: -2}}},
  {name: 'minimum and maximum font sizes', value: {config: {fontSize: 6}}},
  {name: 'large scrollback', value: {config: {scrollback: 150_000}}},
  {name: 'several contexts', value: {config: {webGLRendererMaxContexts: 4}}},
  {
    name: 'default profile override',
    value: {config: {defaultProfile: 'default', profiles: [{name: 'default', config: {fontSize: 12}}]}}
  },
  {name: 'optional root keys', value: {config: {useConpty: true, uiFontFamily: 'Menlo', windowSize: [80, 24]}}},
  {
    name: 'union-typed keys',
    value: {config: {bell: false, bellSound: null, showWindowControls: 'left', showHamburgerMenu: ''}}
  },
  {name: 'plugin namespace', value: {config: {plugins: {demo: {enabled: true, message: 'hi'}}}}},
  {name: 'outside the write bounds', value: {config: {fontSize: 400, lineHeight: 0.1}}}
];

describe('load path regression corpus', () => {
  test('every plausible user config still loads', () => {
    const failures = CORPUS.flatMap((entry) => (safeParseRawConfig(entry.value).success ? [] : [entry.name]));
    expect(failures).toEqual([]);
  });

  test('the corpus includes values the settings UI would refuse', () => {
    const outside = CORPUS.find((entry) => entry.name === 'outside the write bounds');
    expect(outside).toBeDefined();
    expect(safeParseRawConfig(outside?.value).success).toBe(true);
  });
});
