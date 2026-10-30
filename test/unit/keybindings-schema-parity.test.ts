/** @file KB-COD-3: the committed schema matches the codec and Ajv agrees with it. */
import {describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import Ajv from 'ajv';
import JSON5 from 'json5';

import {isJsonValue, type JsonValue} from '@shared/types/json';
import {keybindingsJsonSchema, parseKeybindingsText} from '../../app/config/keybindings-codec';

const WORKSPACE = path.join(import.meta.dirname, '../..');
const SCHEMA_PATH = path.join(WORKSPACE, 'shared/schemas/keybindings.schema.json');
const FIXTURE_DIRECTORY = path.join(WORKSPACE, 'test/fixtures/keybindings');

type ExpectedOutcome = 'accepted' | 'rejected';
type FixtureExpectation = {readonly outcome: ExpectedOutcome; readonly class: string};

/**
 * The corpus, with the KB-COD-2 class each document witnesses.
 *
 * The exact key set is asserted, so removing a class or adding an unclassified
 * document fails the suite rather than silently weakening the corpus.
 */
const FIXTURES = {
  'blank-shortcut.json5': {outcome: 'rejected', class: 'whitespace-only shortcut'},
  'empty-command-id.json5': {outcome: 'rejected', class: 'empty command identifier'},
  'nested-object.json5': {outcome: 'rejected', class: 'nested object'},
  'non-object-root.json5': {outcome: 'rejected', class: 'non-object root'},
  'non-string-array-element.json5': {outcome: 'rejected', class: 'non-string array element'},
  'number-value.json5': {outcome: 'rejected', class: 'number value'},
  'padded-command-id.json5': {outcome: 'rejected', class: 'padded command identifier'},
  'prototype-named-invalid.json5': {outcome: 'rejected', class: 'prototype-named invalid binding'},
  'prototype-named-keys.json5': {outcome: 'accepted', class: 'prototype-named command ids'},
  'schema-key.json5': {outcome: 'accepted', class: 'ignored $schema key'},
  'syntax-error.json5': {outcome: 'rejected', class: 'syntax error'},
  'valid-map.json5': {outcome: 'accepted', class: 'valid map'}
} satisfies Record<string, FixtureExpectation>;

const readSchema = (): JsonValue => {
  const parsed: unknown = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  if (!isJsonValue(parsed)) {
    throw new Error(`${SCHEMA_PATH} is not a JSON value.`);
  }
  return parsed;
};

const fixtureNames = (): readonly string[] =>
  fs
    .readdirSync(FIXTURE_DIRECTORY)
    .filter((name) => name.endsWith('.json5'))
    .toSorted();

const parseFixture = (text: string): {readonly ok: true; readonly value: unknown} | {readonly ok: false} => {
  try {
    return {ok: true, value: JSON5.parse(text)};
  } catch {
    return {ok: false};
  }
};

describe('KB-COD-3 generated schema', () => {
  test('the committed schema equals the codec schema as draft-07', () => {
    // Zod's payload type is a schema interface, not `JsonValue`; widening the
    // expectation keeps the structural comparison in play.
    expect<unknown>(readSchema()).toEqual(keybindingsJsonSchema());
  });

  test('the committed schema is written as canonical two-space JSON', () => {
    const text = fs.readFileSync(SCHEMA_PATH, 'utf8');

    expect(text).toBe(`${JSON.stringify(keybindingsJsonSchema(), null, 2)}\n`);
  });
});

describe('KB-COD-3 fixture corpus', () => {
  const validate = new Ajv({allErrors: true}).compile(keybindingsJsonSchema());

  test('the corpus classifies every document and covers each KB-COD-2 rejection class', () => {
    expect(fixtureNames()).toEqual(Object.keys(FIXTURES).toSorted());

    const rejectionClasses = Object.values(FIXTURES).filter(({outcome}) => outcome === 'rejected');
    expect(rejectionClasses.length).toBeGreaterThanOrEqual(8);
    expect(Object.values(FIXTURES).some(({outcome}) => outcome === 'accepted')).toBe(true);
  });

  test.each(Object.entries(FIXTURES))('%s agrees between the codec and Ajv', (name, expected) => {
    const text = fs.readFileSync(path.join(FIXTURE_DIRECTORY, name), 'utf8');
    const outcome = parseKeybindingsText(text, name);
    const parsed = parseFixture(text);

    expect(outcome.kind).toBe(expected.outcome === 'accepted' ? 'ok' : 'invalid');
    if (parsed.ok) {
      expect(validate(parsed.value)).toBe(expected.outcome === 'accepted');
    } else {
      // Ajv cannot judge text its parser rejects; the codec must reject it at
      // the parse layer, which the expectation above already asserts.
      expect(expected.class).toBe('syntax error');
    }
  });
});
