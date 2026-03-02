/** @file Unit tests for JSON5 parser and roundtrip edge-case handling. */
import {expect, test} from 'bun:test';
import JSON5 from 'json5';

import {Json5Parser} from '../../app/runtime/plugin-runtime-json5-parser';
import {applyPluginSettingsPatches} from '../../app/runtime/plugin-runtime-json5-roundtrip';

const json5LineTerminators = ['\n', '\r', '\u2028', '\u2029'] as const;

for (const terminator of json5LineTerminators) {
  const escapedTerminator = JSON.stringify(terminator).slice(1, -1);
  test(`parseObjectProperties treats ${escapedTerminator} as a line-comment terminator`, () => {
    const raw = `{a: 1, // comment${terminator} b: 2}`;
    const parser = new Json5Parser(raw);
    const rootRange = parser.findRootObjectRange();

    expect(rootRange).not.toBeNull();
    if (!rootRange) {
      return;
    }

    const properties = parser.parseObjectProperties(rootRange);
    expect(properties?.map((property) => property.key)).toEqual(['a', 'b']);
  });
}

test('parseObjectProperties fails on unmatched closing bracket in a property value', () => {
  const raw = `{a: ]}`;
  const parser = new Json5Parser(raw);
  const rootRange = parser.findRootObjectRange();

  expect(rootRange).not.toBeNull();
  if (!rootRange) {
    return;
  }

  expect(parser.parseObjectProperties(rootRange)).toBeNull();
});

test('applyPluginSettingsPatches writes Unicode identifier keys without forcing quotes', () => {
  const raw = `{
  config: {
    plugins: {},
  },
}`;

  const patched = applyPluginSettingsPatches(raw, [{pluginId: 'πPlugin', settings: {enabled: true}}]);
  expect(patched).not.toBeNull();
  if (!patched) {
    return;
  }

  expect(patched).toContain('πPlugin: {');
  expect(patched).not.toContain('"πPlugin":');
  expect(JSON5.parse(patched)).toBeDefined();
});
