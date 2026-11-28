/**
 * @file Named examples for comment-preserving JSON5 edits.
 *
 * Each case is a formatting situation the property generator deliberately does
 * not emit: a comment between key and colon, a trailing same-line comment, a
 * property sharing a line, and CRLF documents.
 */
import {describe, expect, test} from 'bun:test';
import JSON5 from 'json5';

import {json5Document, propertyKey, removePropertyAtPath, setPropertyAtPath} from '../../app/config/json5';

import type {JsonValue} from '@shared/types/json';

const CONFIG = propertyKey('config');
const pathTo = (...segments: string[]) => [CONFIG, ...segments.map((segment) => propertyKey(segment))];

const unicodeTerminators = [
  {name: 'U+2028', terminator: '\u2028'},
  {name: 'U+2029', terminator: '\u2029'}
] as const;

const set = (text: string, path: readonly ReturnType<typeof propertyKey>[], value: JsonValue) =>
  setPropertyAtPath(json5Document(text), path, value);

const remove = (text: string, path: readonly ReturnType<typeof propertyKey>[]) =>
  removePropertyAtPath(json5Document(text), path);

const editedText = (result: ReturnType<typeof set>): string => {
  if (result.kind !== 'edited') {
    throw new Error(`expected an edit, got refusal ${result.reason}`);
  }
  return result.doc;
};

const DOC = `{
  // Appearance
  config: {
    fontSize: 14, // the user's size
    fontFamily: "Menlo", cursorBlink: true,
    scrollback: 1000
  },
  plugins: []
}
`;

describe('setPropertyAtPath', () => {
  test('replaces a value and keeps the trailing comment', () => {
    const text = editedText(set(DOC, pathTo('fontSize'), 16));
    expect(text).toContain("fontSize: 16, // the user's size");
    expect(text).toContain('// Appearance');
    expect(JSON5.parse(text)).toEqual({...JSON5.parse(DOC), config: {...JSON5.parse(DOC).config, fontSize: 16}});
  });

  test('appends a new property at the member indent', () => {
    const text = editedText(set(DOC, pathTo('shell'), 'bash'));
    expect(text).toContain("    shell: 'bash'\n  },");
    expect(JSON5.parse(text).config.shell).toBe('bash');
    expect(text).toContain('// Appearance');
    expect(text).toContain('scrollback: 1000');
  });

  test('creates missing intermediate objects', () => {
    const text = editedText(set(DOC, pathTo('colors', 'black'), '#000000'));
    expect(JSON5.parse(text).config.colors).toEqual({black: '#000000'});
    expect(text).toContain('// Appearance');
  });

  test('inserts into an empty object', () => {
    const text = editedText(set('{\n  config: {}\n}\n', pathTo('fontSize'), 12));
    expect(JSON5.parse(text)).toEqual({config: {fontSize: 12}});
  });

  test('keeps CRLF line endings when appending', () => {
    const doc = '{\r\n  config: {\r\n    fontSize: 12\r\n  }\r\n}\r\n';
    const text = editedText(set(doc, pathTo('shell'), 'bash'));
    expect(text).not.toMatch(/[^\r]\n/);
    expect(JSON5.parse(text).config).toEqual({fontSize: 12, shell: 'bash'});
  });

  test('refuses a file without config', () => {
    const result = set('{\n  plugins: []\n}\n', pathTo('fontSize'), 12);
    expect(result).toEqual({kind: 'refused', reason: 'path-not-found'});
  });

  test('refuses a non-object config', () => {
    const result = set('{\n  config: 5\n}\n', pathTo('fontSize'), 12);
    expect(result).toEqual({kind: 'refused', reason: 'config-not-object'});
  });

  test('refuses a duplicate key on the path', () => {
    const result = set('{\n  config: {\n    fontSize: 12,\n    fontSize: 14\n  }\n}\n', pathTo('fontSize'), 16);
    expect(result).toEqual({kind: 'refused', reason: 'duplicate-key'});
  });

  test('refuses a duplicate config key at the root', () => {
    const doc = '{\n  config: {fontSize: 12},\n  config: {fontSize: 14}\n}\n';
    expect(set(doc, pathTo('fontSize'), 16)).toEqual({kind: 'refused', reason: 'duplicate-key'});
  });

  for (const {name, terminator} of unicodeTerminators) {
    test(`appends a property after a comment ending at ${name}`, () => {
      const text = editedText(set(`{config: {fontSize: 14 // size${terminator}}}`, pathTo('shell'), 'bash'));
      expect(text).toContain('// size');
      expect(JSON5.parse(text).config).toEqual({fontSize: 14, shell: 'bash'});
    });
  }

  test('refuses a path that does not start at config', () => {
    expect(set(DOC, [propertyKey('plugins')], 1)).toEqual({kind: 'refused', reason: 'path-not-found'});
  });
});

describe('removePropertyAtPath', () => {
  test('removes a middle property and its trailing comment', () => {
    const text = editedText(remove(DOC, pathTo('fontFamily')));
    expect(text).not.toContain('fontFamily');
    expect(text).not.toContain('Menlo');
    expect(text).toContain('cursorBlink: true');
    expect(text).toContain('// Appearance');
    expect(text).toContain('scrollback: 1000');
    expect(JSON5.parse(text).config).toEqual({fontSize: 14, cursorBlink: true, scrollback: 1000});
  });

  test('removes a property that shares a line', () => {
    const text = editedText(remove(DOC, pathTo('cursorBlink')));
    expect(JSON5.parse(text).config).toEqual({fontSize: 14, fontFamily: 'Menlo', scrollback: 1000});
    expect(text).toContain('fontFamily: "Menlo"');
  });

  test('removes the last property without leaving a dangling comma', () => {
    const text = editedText(remove(DOC, pathTo('scrollback')));
    expect(JSON5.parse(text).config).toEqual({fontSize: 14, fontFamily: 'Menlo', cursorBlink: true});
    expect(text).not.toContain('scrollback');
  });

  test('removes the only property of an object', () => {
    const doc = '{\n  config: {\n    fontSize: 14\n  }\n}\n';
    const text = editedText(remove(doc, pathTo('fontSize')));
    expect(JSON5.parse(text)).toEqual({config: {}});
  });

  test('keeps CRLF line endings', () => {
    const doc = '{\r\n  // note\r\n  config: {\r\n    fontSize: 12,\r\n    shell: "bash" // chosen\r\n  }\r\n}\r\n';
    const text = editedText(remove(doc, pathTo('shell')));
    expect(text).not.toMatch(/[^\r]\n/);
    expect(JSON5.parse(text)).toEqual({config: {fontSize: 12}});
    expect(text).toContain('// note');
  });

  test('keeps a line comment between the preceding comma and the removed property', () => {
    const text = editedText(remove(`{config:{fontSize:14, // font size\n shell:'bash'}}`, pathTo('shell')));
    expect(text).toBe(`{config:{fontSize:14 // font size\n }}`);
    expect(JSON5.parse(text)).toEqual({config: {fontSize: 14}});
  });

  test('keeps a block comment between the preceding comma and the removed property', () => {
    const text = editedText(remove(`{config:{fontSize:14, /* font size */ shell:'bash'}}`, pathTo('shell')));
    expect(text).toBe(`{config:{fontSize:14 /* font size */ }}`);
    expect(JSON5.parse(text)).toEqual({config: {fontSize: 14}});
  });

  for (const {name, terminator} of unicodeTerminators) {
    test(`removes a property whose trailing comment ends at ${name}`, () => {
      const text = editedText(remove(`{config: {fontSize: 14 // size${terminator}}}`, pathTo('fontSize')));
      expect(text).not.toContain('// size');
      expect(JSON5.parse(text)).toEqual({config: {}});
    });

    test(`keeps a comment ending at ${name} before the removed property`, () => {
      const doc = `{config: {fontSize: 14, // size${terminator}\n  shell: 'bash'}}`;
      const text = editedText(remove(doc, pathTo('shell')));
      expect(text).toContain(`// size${terminator}`);
      expect(JSON5.parse(text)).toEqual({config: {fontSize: 14}});
    });
  }

  test('keeps a comment between the removed value and its following comma', () => {
    // The comma is on the next line, after a comment on its own line. Removing
    // the property must delete that comma on its own rather than swallowing
    // the comment on the way to it.
    const doc = "{config:{fontSize:14\n/* keep */ , shell:'bash'}}";
    const text = editedText(remove(doc, pathTo('fontSize')));
    expect(text).toContain('/* keep */');
    expect(JSON5.parse(text)).toEqual({config: {shell: 'bash'}});
  });

  test('refuses a missing property', () => {
    expect(remove(DOC, pathTo('shell'))).toEqual({kind: 'refused', reason: 'path-not-found'});
  });

  test('refuses a duplicate key', () => {
    const doc = '{\n  config: {\n    fontSize: 12,\n    fontSize: 14\n  }\n}\n';
    expect(remove(doc, pathTo('fontSize'))).toEqual({kind: 'refused', reason: 'duplicate-key'});
  });

  test('refuses a duplicate config key at the root', () => {
    const doc = '{\n  config: {fontSize: 12},\n  config: {fontSize: 14}\n}\n';
    expect(remove(doc, pathTo('fontSize'))).toEqual({kind: 'refused', reason: 'duplicate-key'});
  });

  test('refuses a duplicate intermediate key', () => {
    const doc = '{\n  config: {\n    colors: {black: "#000"},\n    colors: {black: "#fff"}\n  }\n}\n';
    expect(remove(doc, pathTo('colors', 'black'))).toEqual({kind: 'refused', reason: 'duplicate-key'});
  });

  test('refuses a missing intermediate object', () => {
    expect(remove(DOC, pathTo('colors', 'black'))).toEqual({kind: 'refused', reason: 'path-not-found'});
  });
});
