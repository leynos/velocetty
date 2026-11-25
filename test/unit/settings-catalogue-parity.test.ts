/**
 * @file Exhaustive parity between the generated config schema and the
 * settings catalogue.
 *
 * The schema is finite, so every property can be checked. A config option
 * with no catalogue entry and no recorded exclusion is a setting users cannot
 * find, which is exactly the failure this suite exists to prevent.
 */
import {describe, expect, test} from 'bun:test';
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
import {isString} from '@shared/types/guards';
import {isJsonObject, type JsonObject} from '@shared/types/json';

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

const matchesSchemaType = (
  kind: string,
  control: ControlDescriptor,
  enumOptions: readonly string[] | undefined
): boolean => {
  switch (kind) {
    case 'boolean': {
      return control.kind === 'toggle';
    }
    case 'string': {
      return control.kind === 'text' || control.kind === 'colour' || control.kind === 'select';
    }
    case 'number': {
      return isNumberControl(control) && !control.isInteger;
    }
    case 'integer': {
      return isNumberControl(control) && control.isInteger;
    }
    case 'enum': {
      if (!isSelectControl(control) || enumOptions === undefined) {
        return false;
      }
      const schemaOptions = new Set(enumOptions);
      const controlOptions = new Set(control.options);
      return (
        schemaOptions.size === controlOptions.size && [...schemaOptions].every((option) => controlOptions.has(option))
      );
    }
    default: {
      return false;
    }
  }
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
