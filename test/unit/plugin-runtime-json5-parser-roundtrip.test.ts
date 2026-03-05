/** @file Unit tests for JSON5 parser and roundtrip edge-case handling. */
import {expect, test} from 'bun:test';
import JSON5 from 'json5';

import {type Json5ObjectRange, Json5Parser} from '../../app/runtime/plugin-runtime-json5-parser';
import {applyPluginSettingsPatches, json5Document, pluginId} from '../../app/runtime/plugin-runtime-json5-roundtrip';

const rootOf = (raw: string): {parser: Json5Parser; root: Json5ObjectRange} => {
  const parser = new Json5Parser(raw);
  const root = parser.findRootObjectRange();

  expect(root).not.toBeNull();
  if (!root) {
    throw new Error('Expected root object range to be present.');
  }

  return {parser, root};
};

const expectPropsToFail = (raw: string): void => {
  const {parser, root} = rootOf(raw);
  expect(parser.parseObjectProperties(root)).toBeNull();
};

const expectParsedKeys = (raw: string, expectedKeys: string[]): void => {
  const {parser, root} = rootOf(raw);
  const properties = parser.parseObjectProperties(root);

  expect(properties).not.toBeNull();
  if (!properties) {
    throw new Error('Expected properties to parse successfully.');
  }

  expect(properties.map((property) => property.key)).toEqual(expectedKeys);
};

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

test('getLineStartIndex handles JSON5 line terminators and CRLF', () => {
  const terminators = [...json5LineTerminators, '\r\n'] as const;

  for (const terminator of terminators) {
    const raw = `first${terminator}  second`;
    const parser = new Json5Parser(raw);
    const expectedStartIndex = `first${terminator}`.length;

    expect(parser.getLineStartIndex({index: raw.length - 1})).toBe(expectedStartIndex);
  }
});

const failureCases = [
  {name: 'fails on unmatched closing bracket in a property value', raw: `{a: ]}`},
  {name: 'fails when a property value is missing before the next key', raw: `{a: , b: 1}`},
  {name: 'fails when a property value is missing before a trailing comma', raw: `{a: ,}`}
] as const;

failureCases.forEach(({name, raw}) => {
  test(`parseObjectProperties ${name}`, () => {
    expectPropsToFail(raw);
  });
});

const successCases = [
  {
    name: 'decodes unicode escapes in unquoted keys',
    raw: `{\\u0061: 1, \\u03c0Plugin: 2}`,
    expectedKeys: ['a', 'πPlugin']
  },
  {
    name: 'decodes bracketed unicode escapes in unquoted keys',
    raw: `{\\u{0061}: 1, \\u{03c0}Plugin: 2}`,
    expectedKeys: ['a', 'πPlugin']
  }
] as const;

successCases.forEach(({name, raw, expectedKeys}) => {
  test(`parseObjectProperties ${name}`, () => {
    expectParsedKeys(raw, [...expectedKeys]);
  });
});

test('applyPluginSettingsPatches writes Unicode identifier keys without forcing quotes', () => {
  const raw = `{
  config: {
    plugins: {},
  },
}`;

  const patched = applyPluginSettingsPatches(json5Document(raw), [
    {pluginId: pluginId('πPlugin'), settings: {enabled: true}}
  ]);
  expect(patched).not.toBeNull();
  if (!patched) {
    return;
  }

  expect(patched).toContain('πPlugin: {');
  expect(patched).not.toContain('"πPlugin":');
  expect(JSON5.parse(patched)).toBeDefined();
});
