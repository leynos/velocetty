/**
 * @file A JSON Schema interpreter that needs no code generation.
 *
 * Responsibilities:
 * - Decide whether a JSON value satisfies the subset of JSON Schema this
 *   repository's command schemas use.
 * - Report every failure as the same structured issue shape Ajv produced, so
 *   callers and the wire format are unchanged.
 *
 * Why not Ajv: Ajv implements JSON Schema by generating JavaScript and running
 * it through `new Function`. The packaged renderer's Content Security Policy
 * forbids `unsafe-eval`, so `ajv.compile` logs a `console.error` and throws
 * there — which meant command argument validation never worked in the shipped
 * application. `ajv` is also a development dependency, so bundling it into the
 * renderer was a dependency-policy violation. Ajv remains the oracle the
 * property tests compare this interpreter against.
 *
 * Supported keywords: `type` (including a union with `null`), `const`, `enum`,
 * `properties`, `required`, `additionalProperties` (set to `false`), `items`,
 * `minLength`, `maxLength`, `minimum`, `maximum`. A schema using anything else
 * is reported as an invalid schema rather than silently ignored, so a command
 * cannot appear validated while part of its contract is unchecked.
 *
 * Related modules:
 * - `./command-registry-validation.ts` caches a compiled verdict per command
 *   and target and calls `checkSchema`.
 */
import type {CommandValidationIssue} from '@shared/types/commands';
import {isBoolean, isNumber, isString} from '@shared/types/guards';
import {isJsonObject, isJsonValue, type JsonObject, type JsonValue} from '@shared/types/json';

/** Keywords this interpreter understands. */
const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minLength',
  'maxLength',
  'minimum',
  'maximum'
]);

const JSON_TYPE_NAMES: ReadonlySet<string> = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null'
]);

/** Reads a keyword that may be a single string or a list of strings. */
const asStringList = (value: JsonValue | undefined): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => isString(item));
  }
  return isString(value) ? [value] : [];
};

/** Whether a schema declares a keyword at all, regardless of its value. */
const has = (schema: JsonObject, keyword: string): boolean => keyword in schema;

/** Reads a keyword that may be any JSON list. */
const asJsonList = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);

/** The outcome of checking a schema's own well-formedness. */
export type SchemaCheck = {readonly ok: true} | {readonly ok: false; readonly message: string};

/**
 * Verifies that a schema uses only supported keywords, with usable values.
 *
 * Checked once when a command is registered, so a schema defect is reported as
 * `INVALID_COMMAND_SCHEMA` rather than surfacing mid-validation.
 */
export const checkSchema = (schema: unknown): SchemaCheck => {
  if (!isJsonObject(schema)) {
    return {ok: false, message: 'A command schema must be a JSON object'};
  }
  return checkSchemaNode(schema, '#');
};

const checkSchemaNode = (schema: JsonObject, path: string): SchemaCheck => {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      return {ok: false, message: `Unsupported schema keyword "${keyword}" at ${path}`};
    }
  }

  const types = has(schema, 'type') ? asStringList(schema['type']) : [];
  for (const type of types) {
    if (!JSON_TYPE_NAMES.has(type)) {
      return {ok: false, message: `Unknown schema type ${JSON.stringify(type)} at ${path}/type`};
    }
  }

  const properties = schema['properties'];
  if (has(schema, 'properties')) {
    if (!isJsonObject(properties)) {
      return {ok: false, message: `"properties" must be an object at ${path}`};
    }
    for (const [name, child] of Object.entries(properties)) {
      if (!isJsonObject(child)) {
        return {ok: false, message: `Property schema for "${name}" must be an object at ${path}`};
      }
      const childCheck = checkSchemaNode(child, `${path}/properties/${name}`);
      if (!childCheck.ok) {
        return childCheck;
      }
    }
  }

  for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum']) {
    if (has(schema, keyword) && !isNumber(schema[keyword])) {
      return {ok: false, message: `"${keyword}" must be a number at ${path}`};
    }
  }
  for (const keyword of ['required', 'enum']) {
    if (has(schema, keyword) && !Array.isArray(schema[keyword])) {
      return {ok: false, message: `"${keyword}" must be an array at ${path}`};
    }
  }
  if (has(schema, 'additionalProperties') && schema['additionalProperties'] !== false) {
    return {ok: false, message: `"additionalProperties" is supported only as false at ${path}`};
  }

  const items = schema['items'];
  if (has(schema, 'items')) {
    if (!isJsonObject(items)) {
      return {ok: false, message: `"items" must be an object at ${path}`};
    }
    return checkSchemaNode(items, `${path}/items`);
  }

  return {ok: true};
};

const typeOf = (value: JsonValue): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (isNumber(value)) {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (isString(value)) {
    return 'string';
  }
  return isBoolean(value) ? 'boolean' : 'object';
};

const matchesType = (declared: string, value: JsonValue): boolean => {
  const actual = typeOf(value);
  if (declared === 'number') {
    return actual === 'integer' || actual === 'number';
  }
  return declared === actual;
};

/**
 * Structural equality for JSON values.
 *
 * Compares object members by key rather than by serialized text, so a schema
 * constant written with a different key order still matches.
 */
const jsonEquals = (left: JsonValue, right: JsonValue): boolean => {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonEquals(item, right.at(index) ?? null));
  }
  if (!isJsonObject(left) || !isJsonObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  return leftKeys.every((key) => has(right, key) && jsonEquals(left[key], right[key]));
};

/** Accumulates issues while walking one value against one schema. */
interface Walk {
  readonly issues: CommandValidationIssue[];
}

const report = (walk: Walk, keyword: string, instancePath: string, schemaPath: string, message: string): void => {
  walk.issues.push({instancePath, schemaPath, keyword, message, params: {}});
};

/** Renders a schema constant for a human. */
const describe = (value: JsonValue): string => JSON.stringify(value);

/** Checks one value against one schema node, appending every failure. */
export const validateAgainstSchema = (schema: JsonObject, value: unknown): CommandValidationIssue[] => {
  const walk: Walk = {issues: []};
  if (!isJsonValue(value)) {
    report(walk, 'type', '', '#', 'should be a JSON value');
    return walk.issues;
  }
  walkNode(schema, value, '', '#', walk);
  return walk.issues;
};

const walkNode = (schema: JsonObject, value: JsonValue, instancePath: string, schemaPath: string, walk: Walk): void => {
  const types = has(schema, 'type') ? asStringList(schema['type']) : [];
  if (types.length > 0) {
    const allowed = types.some((type) => matchesType(type, value));
    if (!allowed) {
      report(walk, 'type', instancePath, `${schemaPath}/type`, `should be ${types.join(' or ')}`);
      // A type mismatch makes every other keyword meaningless for this value.
      return;
    }
  }

  const constValue = schema['const'];
  if (has(schema, 'const') && !jsonEquals(constValue, value)) {
    report(walk, 'const', instancePath, `${schemaPath}/const`, `should be equal to ${describe(constValue)}`);
  }

  const enumValues = asJsonList(schema['enum']);
  if (enumValues.length > 0) {
    const permitted = enumValues.some((candidate) => jsonEquals(candidate, value));
    if (!permitted) {
      report(walk, 'enum', instancePath, `${schemaPath}/enum`, 'should be equal to one of the allowed values');
    }
  }

  if (isString(value)) {
    // JSON Schema counts characters, not UTF-16 code units.
    const characterCount = [...value].length;
    const minLength = schema['minLength'];
    if (isNumber(minLength) && characterCount < minLength) {
      report(
        walk,
        'minLength',
        instancePath,
        `${schemaPath}/minLength`,
        `should NOT be shorter than ${minLength} characters`
      );
    }
    const maxLength = schema['maxLength'];
    if (isNumber(maxLength) && characterCount > maxLength) {
      report(
        walk,
        'maxLength',
        instancePath,
        `${schemaPath}/maxLength`,
        `should NOT be longer than ${maxLength} characters`
      );
    }
  }

  if (isNumber(value)) {
    const minimum = schema['minimum'];
    if (isNumber(minimum) && value < minimum) {
      report(walk, 'minimum', instancePath, `${schemaPath}/minimum`, `should be >= ${minimum}`);
    }
    const maximum = schema['maximum'];
    if (isNumber(maximum) && value > maximum) {
      report(walk, 'maximum', instancePath, `${schemaPath}/maximum`, `should be <= ${maximum}`);
    }
  }

  if (Array.isArray(value)) {
    const items = schema['items'];
    if (isJsonObject(items)) {
      value.forEach((item, index) => {
        walkNode(items, item, `${instancePath}/${index}`, `${schemaPath}/items`, walk);
      });
    }
    return;
  }

  if (!isJsonObject(value)) {
    return;
  }

  const properties = schema['properties'];
  const known = isJsonObject(properties) ? properties : {};
  for (const name of asStringList(schema['required'])) {
    if (!Object.hasOwn(value, name)) {
      report(walk, 'required', instancePath, `${schemaPath}/required`, `should have required property '${name}'`);
    }
  }

  for (const [name, childSchema] of Object.entries(known)) {
    if (!Object.hasOwn(value, name) || !isJsonObject(childSchema)) {
      continue;
    }
    walkNode(childSchema, value[name], `${instancePath}/${name}`, `${schemaPath}/properties/${name}`, walk);
  }

  if (schema['additionalProperties'] === false) {
    for (const name of Object.keys(value)) {
      if (!Object.hasOwn(known, name)) {
        report(
          walk,
          'additionalProperties',
          instancePath,
          `${schemaPath}/additionalProperties`,
          `should NOT have additional properties`
        );
      }
    }
  }
};
