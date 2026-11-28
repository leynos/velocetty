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
  type DocumentEditResult,
  type Json5ObjectProperty
} from '../../app/config/json5';
import {scanTrailingCommentEnd, valueTextEnd} from '../../app/config/json5/document-scan';
import {
  defaultStyle,
  json5DocumentArbitrary,
  json5EditArbitrary,
  json5FixtureCases,
  printDocument
} from '../testUtils/json5-document-arbitrary';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';

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

type CommentScan = {readonly text: string; readonly endIndex: number};

type CommentRecord = CommentScan & {readonly startIndex: number};

type ScanPosition = {readonly text: string; readonly index: number};

const skipQuotedText = ({text, index: startIndex}: ScanPosition): number => {
  const quote = text[startIndex];
  let index = startIndex + 1;
  while (index < text.length && text[index] !== quote) {
    index += text[index] === '\\' ? 2 : 1;
  }
  return index + 1;
};

const scanLineComment = ({text, index}: ScanPosition): CommentScan => {
  const newline = text.indexOf('\n', index);
  const endIndex = newline === -1 ? text.length : newline;
  return {text: text.slice(index, endIndex), endIndex};
};

const scanBlockComment = ({text, index}: ScanPosition): CommentScan => {
  const closing = text.indexOf('*/', index + 2);
  const endIndex = closing === -1 ? text.length : closing + 2;
  return {text: text.slice(index, endIndex), endIndex};
};

const commentAt = ({text, index}: ScanPosition): CommentScan | undefined => {
  if (text[index] !== '/') {
    return undefined;
  }
  const marker = text[index + 1];
  if (marker === '/') {
    return scanLineComment({text, index});
  }
  if (marker === '*') {
    return scanBlockComment({text, index});
  }
  return undefined;
};

const commentRecordsOf = (text: string): readonly CommentRecord[] => {
  const records: CommentRecord[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === "'") {
      index = skipQuotedText({text, index});
      continue;
    }
    const comment = commentAt({text, index});
    if (comment === undefined) {
      index += 1;
      continue;
    }
    records.push({...comment, startIndex: index});
    index = comment.endIndex;
  }
  return records;
};

const commentsOf = (text: string): string[] =>
  commentRecordsOf(text)
    .map(({text: comment}) => comment)
    .toSorted();

// A newline is lone unless the segment before it ends with a carriage return.
const hasLoneLf = (text: string): boolean =>
  text
    .split('\n')
    .slice(0, -1)
    .some((lineBefore) => !lineBefore.endsWith('\r'));

const configOf = (root: JsonValue): JsonObject => (isJsonObject(root) && isJsonObject(root.config) ? root.config : {});

const editedDoc = (result: DocumentEditResult): string => {
  if (result.kind !== 'edited') {
    throw new Error(`expected an edit, got ${result.reason}`);
  }
  return result.doc;
};

type RemovalSpan = {readonly before: string; readonly after: string; readonly key: string};

/**
 * Every comment a removal must leave alone, with its multiplicity.
 *
 * A removal deletes the property's key, its value, and the trailing comment
 * that shares the value's last line. A comment before the key, or one that
 * starts after that trailing comment ends, belongs to the document and must
 * survive. This is computed from the value's text end alone, not from wherever
 * a comma happens to sit, so an implementation that swallows a comment while
 * hunting for the separator fails here.
 */
const survivingComments = (text: string, property: Json5ObjectProperty): string[] => {
  const valueEnd = valueTextEnd(text, property);
  const trailingEnd = scanTrailingCommentEnd({doc: text, index: valueEnd});
  return commentRecordsOf(text)
    .filter((record) => record.endIndex <= property.keyStartIndex || record.startIndex >= trailingEnd)
    .map(({text: comment}) => comment)
    .toSorted();
};

const expectRemovalConfinedToConfig = ({before, after, key}: RemovalSpan): void => {
  const parser = new Json5Parser(before);
  const root = parser.findRootObjectRange();
  const configProperty = root ? parser.getObjectProperty(root, 'config') : null;
  const configRange = configProperty ? parser.getObjectRangeForProperty(configProperty) : null;
  const property = configRange ? parser.getObjectProperty(configRange, key) : null;
  if (!configRange || !property) {
    return;
  }
  // Everything before the config object and after its close brace is
  // untouched.
  expect(after.startsWith(before.slice(0, configRange.openBraceIndex + 1))).toBe(true);
  expect(after.endsWith(before.slice(configRange.closeBraceIndex + 1))).toBe(true);
  // Every comment survives except the removed property's own trailing comment.
  expect(commentsOf(after)).toEqual(survivingComments(before, property));
};

const removeCases = fc
  .tuple(json5DocumentArbitrary, fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'))
  .map(([document, key]) => ({...document, key}));

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
    fc.assert(
      fc.property(removeCases, ({text, key}) => {
        // SAFETY: the generated document is a JSON object tree.
        const before = JSON5.parse(text) as JsonValue;
        const result = removePropertyAtPath(json5Document(text), pathTo(key));
        if (!Object.hasOwn(configOf(before), key)) {
          expect(result).toEqual({kind: 'refused', reason: 'path-not-found'});
          return;
        }
        const after = editedDoc(result);
        expect(JSON5.parse(after)).toEqual(deleteIn(before, key));
        // Text before the removed property's line and after the config object is
        // untouched; no comment is invented, and no comment outside the removed
        // span disappears.
        expectRemovalConfinedToConfig({before: text, after, key});
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

  test('a remove keeps the comments attached to the surviving properties', () => {
    // `beta` shares the closing-brace line, so the removal takes the inline
    // path where the separating comma sits next to gamma's trailing comment.
    const doc = `{
  // config note
  config: {
    // alpha note
    alpha: 1, // alpha tail
    // gamma note
    gamma: 2, // gamma tail
    beta: 3}}
`;
    const after = editedDoc(removePropertyAtPath(json5Document(doc), pathTo('beta')));
    expect(JSON5.parse(after)).toEqual({config: {alpha: 1, gamma: 2}});
    expect(commentsOf(after)).toEqual([
      '// alpha note',
      '// alpha tail',
      '// config note',
      '// gamma note',
      '// gamma tail'
    ]);
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
