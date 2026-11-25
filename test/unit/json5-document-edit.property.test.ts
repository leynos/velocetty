/**
 * @file Properties for comment-preserving JSON5 edits.
 *
 * `JSON5.parse` is the oracle: a set must produce exactly the value it was
 * asked for, a remove must produce exactly the value without that key, and
 * neither may disturb a comment or a line ending outside the edited span.
 */
import {describe, expect, test} from 'bun:test';
import JSON5 from 'json5';
import fc from 'fast-check';

import {
  Json5Parser,
  json5Document,
  propertyKey,
  removePropertyAtPath,
  setPropertyAtPath,
  type DocumentEditResult
} from '../../app/config/json5';
import {valueTextEnd} from '../../app/config/json5/document-scan';
import {
  defaultStyle,
  json5DocumentArbitrary,
  json5EditArbitrary,
  json5FixtureCases,
  printDocument
} from '../testUtils/json5-document-arbitrary';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

import {isJsonObject, type JsonValue} from '@shared/types/json';

const CONFIG = propertyKey('config');
const pathTo = (key: string) => [CONFIG, propertyKey(key)];

const setIn = (root: JsonValue, key: string, value: JsonValue): JsonValue => {
  const existing = isJsonObject(root) ? root : {};
  const config = isJsonObject(existing.config) ? existing.config : {};
  return {...existing, config: {...config, [key]: value}};
};

const deleteIn = (root: JsonValue, key: string): JsonValue => {
  if (!isJsonObject(root) || !isJsonObject(root.config)) {
    return root;
  }
  const config = {...root.config};
  delete config[key];
  return {...root, config};
};

const commentsOf = (text: string): string[] => {
  const comments: string[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < text.length && text[index] !== quote) {
        index += text[index] === '\\' ? 2 : 1;
      }
      index += 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(index, stop));
      index = stop;
      continue;
    }
    if (character === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      const stop = close === -1 ? text.length : close + 2;
      comments.push(text.slice(index, stop));
      index = stop;
      continue;
    }
    index += 1;
  }
  return comments.toSorted();
};

const hasLoneLf = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && (index === 0 || text[index - 1] !== '\r')) {
      return true;
    }
  }
  return false;
};

const editedDoc = (result: DocumentEditResult): string => {
  if (result.kind !== 'edited') {
    throw new Error(`expected an edit, got ${result.reason}`);
  }
  return result.doc;
};

describe('JSON5 document edit properties', () => {
  test('a set produces exactly the intended value', () => {
    let replaced = 0;
    let inserted = 0;
    let runs = 0;
    fc.assert(
      fc.property(json5EditArbitrary, ({text, key, nextValue}) => {
        runs += 1;
        // SAFETY: the generated document is a JSON object tree.
        const before = JSON5.parse(text) as JsonValue;
        const existed = isJsonObject(before) && isJsonObject(before.config) && Object.hasOwn(before.config, key);
        const after = editedDoc(setPropertyAtPath(json5Document(text), pathTo(key), nextValue));
        expect(JSON5.parse(after)).toEqual(setIn(before, key, nextValue));
        if (existed) {
          replaced += 1;
        } else {
          inserted += 1;
        }
      }),
      {numRuns: fastCheckRunCount()}
    );
    expect(replaced / runs).toBeGreaterThan(0.1);
    expect(inserted / runs).toBeGreaterThan(0.1);
  });

  test('a set never disturbs text outside the replaced value', () => {
    fc.assert(
      fc.property(json5EditArbitrary, ({text, key, nextValue}) => {
        const parser = new Json5Parser(text);
        const root = parser.findRootObjectRange();
        const config = root ? parser.getObjectProperty(root, 'config') : null;
        const configRange = config ? parser.getObjectRangeForProperty(config) : null;
        const property = configRange ? parser.getObjectProperty(configRange, key) : null;
        const doc = editedDoc(setPropertyAtPath(json5Document(text), pathTo(key), nextValue));
        if (property) {
          const valueEnd = valueTextEnd(text, property);
          expect(doc.startsWith(text.slice(0, property.valueStartIndex))).toBe(true);
          expect(doc.endsWith(text.slice(valueEnd))).toBe(true);
        } else {
          // A new property loses no comment and appears before the close brace.
          const original = commentsOf(text);
          expect(original.every((comment) => commentsOf(doc).includes(comment))).toBe(true);
        }
        if (!hasLoneLf(text)) {
          expect(hasLoneLf(doc)).toBe(false);
        }
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('a remove produces exactly the value without that key', () => {
    const cases = fc
      .tuple(json5DocumentArbitrary, fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'))
      .map(([document, key]) => ({...document, key}));
    fc.assert(
      fc.property(cases, ({text, key}) => {
        // SAFETY: the generated document is a JSON object tree.
        // SAFETY: the generated document is a JSON object tree.
        const before = JSON5.parse(text) as JsonValue;
        const config = isJsonObject(before) && isJsonObject(before.config) ? before.config : {};
        const result = removePropertyAtPath(json5Document(text), pathTo(key));
        if (!Object.hasOwn(config, key)) {
          expect(result).toEqual({kind: 'refused', reason: 'path-not-found'});
          return;
        }
        const after = editedDoc(result);
        expect(JSON5.parse(after)).toEqual(deleteIn(before, key));
        // Text before the removed property's line and after the config object is
        // untouched; no comment is invented, and no comment outside the removed
        // span disappears.
        const parser = new Json5Parser(text);
        const root = parser.findRootObjectRange();
        const configProperty = root ? parser.getObjectProperty(root, 'config') : null;
        const configRange = configProperty ? parser.getObjectRangeForProperty(configProperty) : null;
        const property = configRange ? parser.getObjectProperty(configRange, key) : null;
        if (configRange && property) {
          // Everything before the config object and after its close brace is
          // untouched, and no comment outside the removed property's own span
          // disappears (checked below).
          expect(after.startsWith(text.slice(0, configRange.openBraceIndex + 1))).toBe(true);
          expect(after.endsWith(text.slice(configRange.closeBraceIndex + 1))).toBe(true);
        }
        const remaining = commentsOf(after);
        const original = commentsOf(text);
        expect(remaining.every((comment) => original.includes(comment))).toBe(true);
      }),
      {numRuns: fastCheckRunCount()}
    );
  });

  test('a remove keeps the document line-ending style', () => {
    const crlf = printDocument({alpha: 1, beta: 2, gamma: 3}, defaultStyle({newline: '\r\n', commentBefore: true}));
    const after = editedDoc(removePropertyAtPath(json5Document(crlf.text), pathTo('beta')));
    expect(hasLoneLf(after)).toBe(false);
    expect(JSON5.parse(after)).toEqual({config: {alpha: 1, gamma: 3}});
  });

  test('the fixtures are refused or edited for the documented reason', () => {
    const expectations = {
      commented: 'edited',
      crlf: 'edited',
      'duplicate-key': 'duplicate-key',
      'empty-object': 'edited',
      'no-config': 'path-not-found',
      'non-object-config': 'config-not-object'
    } satisfies Record<string, string>;
    const observed = json5FixtureCases().map(({name, text}) => {
      const key = name === 'duplicate-key' ? 'fontSize' : 'alpha';
      const result = setPropertyAtPath(json5Document(text), pathTo(key), 7);
      return [name, result.kind === 'edited' ? 'edited' : result.reason];
    });
    expect(Object.fromEntries(observed)).toEqual(expectations);
  });

  test('a fixture edit leaves every foreign comment in place', () => {
    const fixture = json5FixtureCases().find(({name}) => name === 'commented');
    expect(fixture).toBeDefined();
    if (!fixture) {
      return;
    }
    const doc = editedDoc(setPropertyAtPath(json5Document(fixture.text), pathTo('fontSize'), 18));
    expect(commentsOf(doc)).toEqual(commentsOf(fixture.text));
    expect(JSON5.parse(doc).config.fontSize).toBe(18);
  });
});
