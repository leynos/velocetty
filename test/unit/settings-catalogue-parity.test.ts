/**
 * @file Exhaustive parity between the generated config schema and the
 * settings catalogue.
 *
 * The schema is finite, so every property can be checked. A config option
 * with no catalogue entry and no recorded exclusion is a setting users cannot
 * find, which is exactly the failure this suite exists to prevent.
 */
import {describe, expect, test} from 'bun:test';
import Color from 'color';
import fs from 'node:fs';
import path from 'node:path';

import {
  CORE_SETTINGS_CATALOGUE,
  CORE_SETTING_KEYS,
  EXCLUDED_CONFIG_KEYS,
  buildCorePanelModel,
  coreKeyFromSettingId,
  type CoreCatalogueEntry
} from '@shared/settings/core-catalogue';
import type {ControlDescriptor} from '@shared/settings/panel-model';
import {isColourValue} from '@shared/settings/coerce';
import {
  SETTINGS_WRITE_POLICY,
  checkWritePolicy,
  type NumericWriteRule,
  type SelectWriteRule,
  type WriteRule
} from '../../app/settings/settings-write-policy';
import {isString} from '@shared/types/guards';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';

const SCHEMA_PATH = 'shared/schemas/schema.json';

const readSchemaProperties = (): JsonObject => {
  const raw = fs.readFileSync(path.join(process.cwd(), SCHEMA_PATH), 'utf8');
  const schema: unknown = JSON.parse(raw);
  if (!isJsonObject(schema) || !isJsonObject(schema.definitions)) {
    throw new Error('schema.json has no definitions object');
  }
  const section = schema.definitions['Partial<configOptions>'];
  if (!isJsonObject(section) || !isJsonObject(section.properties)) {
    throw new Error('schema.json has no Partial<configOptions> properties');
  }
  return section.properties;
};

const schemaEnumOptions = (property: JsonObject): readonly string[] | undefined => {
  const members = property.enum;
  if (!Array.isArray(members) || !members.every((member) => isString(member))) {
    return undefined;
  }
  return members;
};

const controlKindFor = (property: JsonObject): string => {
  const type = property.type;
  if (type === undefined && property.enum !== undefined) {
    return schemaEnumOptions(property) === undefined ? 'mixed-enum' : 'enum';
  }
  if (isString(type)) {
    return type;
  }
  if (Array.isArray(type)) {
    return 'union';
  }
  if (property.$ref !== undefined) {
    return 'ref';
  }
  return 'unknown';
};

const isNumberControl = (control: ControlDescriptor): control is Extract<ControlDescriptor, {kind: 'number'}> =>
  control.kind === 'number';

const isSelectControl = (control: ControlDescriptor): control is Extract<ControlDescriptor, {kind: 'select'}> =>
  control.kind === 'select';

const catalogueByKey = new Map<string, CoreCatalogueEntry>(CORE_SETTINGS_CATALOGUE.map((entry) => [entry.key, entry]));

type SchemaKindMatcher = (control: ControlDescriptor, enumOptions: readonly string[] | undefined) => boolean;

const TEXTUAL_CONTROL_KINDS: ReadonlySet<ControlDescriptor['kind']> = new Set<ControlDescriptor['kind']>([
  'text',
  'colour',
  'select'
]);

const hasSameOptions = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((option) => right.has(option));

const matchesEnumControl = (control: ControlDescriptor, enumOptions: readonly string[] | undefined): boolean => {
  if (!isSelectControl(control) || enumOptions === undefined) {
    return false;
  }
  return hasSameOptions(new Set(enumOptions), new Set(control.options));
};

const matchesNumberControl = (control: ControlDescriptor): boolean => isNumberControl(control) && !control.isInteger;

const matchesIntegerControl = (control: ControlDescriptor): boolean => isNumberControl(control) && control.isInteger;

const SCHEMA_KIND_MATCHERS: ReadonlyMap<string, SchemaKindMatcher> = new Map<string, SchemaKindMatcher>([
  ['boolean', (control) => control.kind === 'toggle'],
  ['string', (control) => TEXTUAL_CONTROL_KINDS.has(control.kind)],
  ['number', (control) => matchesNumberControl(control)],
  ['integer', (control) => matchesIntegerControl(control)],
  ['enum', (control, enumOptions) => matchesEnumControl(control, enumOptions)]
]);

export const matchesSchemaType = (
  kind: string,
  control: ControlDescriptor,
  enumOptions: readonly string[] | undefined
): boolean => {
  // A declared enum constrains the control whatever base `type` sits beside
  // it. Checking the type first would let `type: 'string'` accept any textual
  // widget, including one offering options the schema rejects.
  if (enumOptions !== undefined) {
    return matchesEnumControl(control, enumOptions);
  }
  return SCHEMA_KIND_MATCHERS.get(kind)?.(control, enumOptions) ?? false;
};

type NumberControl = Extract<ControlDescriptor, {kind: 'number'}>;
type SelectControl = Extract<ControlDescriptor, {kind: 'select'}>;

const isNumberRule = (rule: WriteRule): rule is NumericWriteRule => rule.kind === 'number';

const isSelectRule = (rule: WriteRule): rule is SelectWriteRule => rule.kind === 'select';

const numberRuleDiffers = (rule: NumericWriteRule, control: NumberControl): boolean =>
  rule.minimum !== control.minimum || rule.maximum !== control.maximum || rule.isInteger !== control.isInteger;

const selectRuleDiffers = (rule: SelectWriteRule, control: SelectControl): boolean =>
  rule.options.join('|') !== control.options.join('|');

const ruleDetailMismatch = (rule: WriteRule, control: ControlDescriptor): string | undefined => {
  if (isNumberRule(rule) && isNumberControl(control)) {
    return numberRuleDiffers(rule, control) ? 'number rule differs' : undefined;
  }
  if (isSelectRule(rule) && isSelectControl(control)) {
    return selectRuleDiffers(rule, control) ? 'options differ' : undefined;
  }
  return undefined;
};

const policyMismatch = (entry: CoreCatalogueEntry): string | undefined => {
  const rule = SETTINGS_WRITE_POLICY[entry.key];
  // The policy names a boolean value; the control names the widget that
  // edits it, so a boolean rule corresponds to a toggle.
  const policyKind = rule.kind === 'boolean' ? 'toggle' : rule.kind;
  if (policyKind !== entry.control.kind) {
    return `${entry.key}: policy ${policyKind}, control ${entry.control.kind}`;
  }
  const detail = ruleDetailMismatch(rule, entry.control);
  return detail === undefined ? undefined : `${entry.key}: ${detail}`;
};

describe('settings catalogue parity', () => {
  const properties = readSchemaProperties();
  const schemaKeys = Object.keys(properties);
  const propertyEntries = Object.entries(properties).filter((entry): entry is [string, JsonObject] =>
    isJsonObject(entry[1])
  );

  test('the schema is large enough for the parity check to mean something', () => {
    expect(schemaKeys.length).toBeGreaterThan(30);
  });

  test('every schema property is catalogued or excluded exactly once', () => {
    const missing = schemaKeys.filter((key) => !catalogueByKey.has(key) && !Object.hasOwn(EXCLUDED_CONFIG_KEYS, key));
    expect(missing).toEqual([]);

    const both = schemaKeys.filter((key) => catalogueByKey.has(key) && Object.hasOwn(EXCLUDED_CONFIG_KEYS, key));
    expect(both).toEqual([]);
  });

  test('no catalogue or exclusion names a key the schema does not declare', () => {
    const schemaKeySet = new Set(schemaKeys);
    const unknown = [...CORE_SETTING_KEYS, ...Object.keys(EXCLUDED_CONFIG_KEYS)].filter(
      (key) => !schemaKeySet.has(key)
    );
    expect(unknown).toEqual([]);
  });

  test('every exclusion carries a non-empty reason', () => {
    const empty = Object.entries(EXCLUDED_CONFIG_KEYS)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  test('catalogue keys are unique', () => {
    expect(new Set(CORE_SETTING_KEYS).size).toBe(CORE_SETTING_KEYS.length);
  });

  test('every control matches its schema type', () => {
    const mismatches: string[] = [];
    for (const [key, property] of propertyEntries) {
      const entry = catalogueByKey.get(key);
      if (!entry) {
        continue;
      }
      const kind = controlKindFor(property);
      if (!matchesSchemaType(kind, entry.control, schemaEnumOptions(property))) {
        mismatches.push(`${key}: schema ${kind}, control ${entry.control.kind}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('a declared enum is matched as an enum before its base type', () => {
    const declared = ['canary', 'stable'];
    const text: ControlDescriptor = {kind: 'text'};
    const betaSelect: ControlDescriptor = {kind: 'select', options: ['beta', 'stable']};
    const matchingSelect: ControlDescriptor = {kind: 'select', options: ['stable', 'canary']};

    // `type: 'string'` would accept any textual control, including these two.
    expect(matchesSchemaType('string', text, declared)).toBe(false);
    expect(matchesSchemaType('string', betaSelect, declared)).toBe(false);
    expect(matchesSchemaType('string', matchingSelect, declared)).toBe(true);
  });

  test('every excluded key has a shape no control can express', () => {
    const expressible = Object.keys(EXCLUDED_CONFIG_KEYS).filter((key) => {
      const property = properties[key];
      if (!isJsonObject(property)) {
        return false;
      }
      const kind = controlKindFor(property);
      return kind === 'boolean' || kind === 'number' || kind === 'integer';
    });
    expect(expressible).toEqual([]);
  });

  test('every category has at least one field', () => {
    const empty = buildCorePanelModel().sections.filter((section) => section.fields.length === 0);
    expect(empty).toEqual([]);
  });

  test('setting ids round-trip to their keys and are unique', () => {
    const fields = buildCorePanelModel().sections.flatMap((section) => section.fields);
    expect(new Set(fields.map((field) => field.id)).size).toBe(fields.length);
    expect(fields.filter((field) => coreKeyFromSettingId(field.id) === undefined)).toEqual([]);
    expect(coreKeyFromSettingId('other:fontSize')).toBeUndefined();
    expect(coreKeyFromSettingId('core:notASetting')).toBeUndefined();
  });

  test('panel order follows catalogue order', () => {
    const modelOrder = buildCorePanelModel().sections.flatMap((section) =>
      section.fields.map((field) => String(field.id))
    );
    const catalogueOrder = CORE_SETTINGS_CATALOGUE.map((entry) => `core:${entry.key}`);
    expect(modelOrder).toEqual(catalogueOrder);
  });
});

describe('settings write policy parity', () => {
  test('the policy covers exactly the catalogue keys', () => {
    expect(Object.keys(SETTINGS_WRITE_POLICY).toSorted()).toEqual([...CORE_SETTING_KEYS].toSorted());
  });

  test('every policy rule mirrors its catalogue control', () => {
    const mismatches = CORE_SETTINGS_CATALOGUE.flatMap((entry) => {
      const mismatch = policyMismatch(entry);
      return mismatch === undefined ? [] : [mismatch];
    });
    expect(mismatches).toEqual([]);
  });

  test('the policy rejects keys the catalogue does not expose', () => {
    expect(checkWritePolicy('colors', {black: '#000000'})).toHaveLength(1);
    expect(checkWritePolicy('notASetting', 1)).toHaveLength(1);
  });

  test('the policy accepts exactly the colours the renderer accepts', () => {
    const candidates = [
      '#abc',
      '#AABBCC',
      '#aabbccdd',
      '#ab',
      'rgb(1, 2, 3)',
      'rgb(100%, 0%, 50%)',
      'rgb(255 0 0)',
      'rgb(255 0 0 / 50%)',
      'rgba(0, 0, 0, 0.5)',
      'rgba(1 2 3 / 50%)',
      'rgb(50.5%, 0%, 50%)',
      'rgb(1.5, 2, 3)',
      'rgb(1.0, 2, 3)',
      'rgb(+)',
      'rgba(,,,)',
      'rgb(1, 2)',
      'rgb(1 2 3 4)',
      'rgb(a, b, c)',
      'tomato',
      ''
    ];
    const observed = candidates.map((candidate) => checkWritePolicy('backgroundColor', candidate).length === 0);
    expect(observed).toEqual(candidates.map((candidate) => isColourValue(candidate)));
  });

  test('every accepted colour parses in the terminal it is written for', () => {
    // `lib/components/term.tsx` builds `Color(value)` for the terminal
    // options. A value both validators accept must not throw there, so this
    // asserts against the consumer rather than only against the two copies.
    const accepted = [
      '#abc',
      '#AABBCC',
      '#aabbccdd',
      'rgb(0, 0, 0)',
      'rgb(255, 128, 0)',
      'rgb(100%, 0%, 50%)',
      'rgb(50.5%, 0%, 50%)',
      'rgb(255 0 0)',
      'rgb(255 0 0 / 50%)',
      'rgba(0, 0, 0, 0.5)',
      'rgba(0, 0, 0, 50%)',
      'rgba(1 2 3 / 0.4)'
    ];
    for (const value of accepted) {
      expect(() => Color(value).alpha()).not.toThrow();
    }
    // The consumer rejects a decimal channel, which the validators refuse too.
    expect(() => Color('rgb(1.5, 2, 3)')).toThrow();
  });

  test('the policy refuses malformed functional colours and keeps valid ones', () => {
    expect(checkWritePolicy('backgroundColor', 'rgb(+)')).toHaveLength(1);
    expect(checkWritePolicy('backgroundColor', 'rgba(,,,)')).toHaveLength(1);
    expect(checkWritePolicy('backgroundColor', 'rgb(1, 2)')).toHaveLength(1);
    // A decimal channel is valid CSS but the terminal's parser throws on it.
    expect(checkWritePolicy('backgroundColor', 'rgb(1.5, 2, 3)')).toHaveLength(1);
    expect(checkWritePolicy('backgroundColor', 'rgb(255, 0, 0)')).toHaveLength(0);
    expect(checkWritePolicy('backgroundColor', 'rgb(100%, 0%, 0%)')).toHaveLength(0);
    expect(checkWritePolicy('backgroundColor', 'rgba(0, 0, 0, 50%)')).toHaveLength(0);
  });

  test('the policy agrees with coercion on representative values', () => {
    const cases: readonly {readonly key: string; readonly value: JsonValue}[] = [
      {key: 'fontSize', value: 16},
      {key: 'fontSize', value: -3},
      {key: 'fontSize', value: 101},
      {key: 'fontSize', value: 'big'},
      {key: 'cursorBlink', value: true},
      {key: 'cursorBlink', value: 'true'},
      {key: 'cursorShape', value: 'BEAM'},
      {key: 'cursorShape', value: 'beam'},
      {key: 'updateChannel', value: 'canary'},
      {key: 'updateChannel', value: 'beta'},
      {key: 'webGLRendererMaxContexts', value: 4},
      {key: 'webGLRendererMaxContexts', value: 4.5},
      {key: 'shell', value: '/bin/zsh'},
      {key: 'shell', value: ''}
    ];
    const observed = cases.map(({key, value}) => checkWritePolicy(key, value).length === 0);
    expect(observed).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false
    ]);
  });
});
