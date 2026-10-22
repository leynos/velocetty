/** @file Runtime-safe JSON5 helpers for app-process config parsing and persistence. */
import JSON5 from 'json5';
import Ajv from 'ajv';
import {ZodError} from 'zod';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import {isObject, isString} from '@shared/types/guards';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';
import configJsonSchema from './schema.json';

export type ParseSuccess<T> = {success: true; data: T};
export type ParseFailure = {success: false; error: Error};
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
export type ParseSchema<T> = {
  readonly safeParse: (value: unknown) => ParseResult<T>;
};

type DiagnosticHint = Pick<configValidationDiagnostic, 'docHint' | 'defaultHint'>;
type DiagnosticHints = Record<string, DiagnosticHint>;
type ParseDiagnosticContext = {
  source: string;
  itemType: string;
  diagnosticHints?: DiagnosticHints;
};
type SchemaDiagnosticContext = Pick<ParseDiagnosticContext, 'itemType' | 'diagnosticHints'>;
type ErrorMessageContext = Pick<ParseDiagnosticContext, 'source' | 'itemType'>;

export interface ParseOptions<T> {
  readonly raw: string;
  readonly source: string;
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType?: string;
  readonly diagnosticHints?: DiagnosticHints;
}

export type ParseWithDiagnosticsResult<T> = {
  value: T;
  diagnostics: configValidationDiagnostic[];
  usedFallback: boolean;
};

type DiagnosticError = Error & {diagnostic: configValidationDiagnostic};
type SchemaIssue = ZodError['issues'][number];
type FieldValidator = (value: JsonObject, field: string) => DiagnosticError | null;

/**
 * Decodes a `$ref` path segment into the definition name it addresses.
 *
 * The generator percent-encodes characters that a JSON Pointer token cannot
 * carry, so `Partial<configOptions>` arrives as `Partial%3CconfigOptions%3E`.
 * The `~1` and `~0` replacements cover the two escapes JSON Pointer itself
 * defines, and must be undone after percent-decoding.
 */
const decodeRefSegment = (segment: string): string =>
  decodeURIComponent(segment).replaceAll('~1', '/').replaceAll('~0', '~');

/**
 * Resolves the generated definition name that describes the `config` property.
 *
 * The generator names each definition after the TypeScript type it was derived
 * from, so changing that type renames the definition and rewrites the `$ref`
 * that points at it. Reading the name back out of the schema keeps this module
 * bound to the schema's shape rather than to one spelling of it; a hardcoded
 * name would fail whenever the type changed, taking every config load with it.
 *
 * @throws If the generated schema does not carry the definition it references.
 */
const resolveConfigOptionsDefinitionName = (): string => {
  const ref: string = configJsonSchema.properties.config.$ref;
  const name = decodeRefSegment(ref.slice(ref.lastIndexOf('/') + 1));
  if (!(name in configJsonSchema.definitions)) {
    throw new Error(`The generated config schema has no "${name}" definition for config options.`);
  }
  return name;
};

/**
 * Collects the schema sections that constrain individual config options.
 *
 * A raw user config is a partial override of the resolved defaults, so any
 * `required` list is dropped however the generator spelled the source type.
 * That keeps the contract the same whether the type is written as complete or
 * already partial, and whichever way the generator expresses the constraint:
 * as an `allOf` of sections, or as a single inline object.
 */
const configOptionsSections = (): JsonValue[] => {
  const name = resolveConfigOptionsDefinitionName();
  const definition = structuredClone(configJsonSchema.definitions[name]);
  const sections = Array.isArray(definition.allOf) ? definition.allOf : [definition];
  for (const section of sections) {
    // SAFETY: every generated definition section is a JSON object; only the
    // object form carries the `required` keyword this drops.
    if (isJsonObject(section)) {
      delete section.required;
    }
  }
  return sections;
};

const configOptionsValidator = new Ajv({allErrors: true, allowUnionTypes: true}).compile({
  allOf: configOptionsSections(),
  definitions: configJsonSchema.definitions
});

const rootPath = '/';
const schemaFallbackFix = 'Update the JSON structure to match the expected config schema.';
const parseFallbackFix = 'Fix the JSON5 syntax (for example, commas, quotes, or braces) and retry.';

const createDiagnosticError = (diagnostic: configValidationDiagnostic): DiagnosticError =>
  Object.assign(new Error(diagnostic.message), {diagnostic});

const getPathForField = (field: string): string => `/${field}`;

export function isRecord(value: JsonValue): value is JsonObject;
export function isRecord(value: unknown): value is JsonObject;
export function isRecord(value: unknown): value is JsonObject {
  return isJsonObject(value);
}

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => isString(entry));

const isKeymapBinding = (value: unknown): value is string | string[] => isString(value) || isStringArray(value);

export const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => isKeymapBinding(entry));

const makeFieldValidator =
  (
    guard: (value: unknown) => boolean,
    message: (field: string) => string,
    suggestedFix: (field: string) => string
  ): FieldValidator =>
  (value, field) => {
    if (Object.hasOwn(value, field) && !guard(value[field])) {
      return createDiagnosticError({
        path: getPathForField(field),
        message: message(field),
        suggestedFix: suggestedFix(field)
      });
    }
    return null;
  };

const validateRecordField: FieldValidator = makeFieldValidator(
  isRecord,
  (field) => `Expected \`${field}\` to be an object when present.`,
  (field) => `Set \`${field}\` to an object value.`
);

const validateStringArrayField: FieldValidator = makeFieldValidator(
  isStringArray,
  (field) => `Expected \`${field}\` to be an array of strings when present.`,
  (field) => `Set \`${field}\` to an array of plugin names, for example ['plugin-name'].`
);

const validateKeymapField: FieldValidator = makeFieldValidator(
  isKeymapConfig,
  (field) => `Expected \`${field}\` values to be strings or string arrays when present.`,
  (field) => `Set \`${field}\` entries to keybinding strings or string arrays.`
);

export const validateRawConfig = (value: unknown): ParseResult<JsonObject> => {
  if (!isRecord(value)) {
    return {
      success: false,
      error: createDiagnosticError({
        path: rootPath,
        message: 'Expected config payload to be an object.',
        suggestedFix: 'Set the root config value to an object (for example, `{}`) before adding fields.'
      })
    };
  }

  const validators: Array<[string, FieldValidator]> = [
    ['config', validateRecordField],
    ['plugins', validateStringArrayField],
    ['localPlugins', validateStringArrayField],
    ['keymaps', validateKeymapField]
  ];

  for (const [field, validator] of validators) {
    const error = validator(value, field);
    if (error) {
      return {success: false, error};
    }
  }

  if (Object.hasOwn(value, 'config') && !configOptionsValidator(value.config)) {
    const issue = configOptionsValidator.errors?.at(0);
    const issuePath = issue?.instancePath ?? '';
    return {
      success: false,
      error: createDiagnosticError({
        path: `/config${issuePath}`,
        message: issue?.message ?? 'Configuration options do not match the supported schema.',
        suggestedFix: 'Set configuration option values to match the documented types.'
      })
    };
  }

  return {success: true, data: value};
};

export const safeParseRawConfig = (value: unknown): ParseResult<rawConfig> => {
  const parsed = validateRawConfig(value);
  if (!parsed.success) {
    return parsed;
  }
  // SAFETY: validateRawConfig checks all rawConfig fields and validates present config options against the generated schema.
  return {success: true, data: parsed.data as rawConfig};
};

const hasDiagnostic = (error: Error): error is DiagnosticError => {
  return (
    error instanceof Error &&
    'diagnostic' in error &&
    isJsonObject(error.diagnostic) &&
    isString(error.diagnostic.path) &&
    isString(error.diagnostic.message) &&
    isString(error.diagnostic.suggestedFix)
  );
};

const getIssuePath = (path: unknown): string => {
  if (!Array.isArray(path) || path.length === 0) {
    return rootPath;
  }
  const segments = path.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
  if (segments.length === 0) {
    return rootPath;
  }
  return `/${segments.map((segment) => `${segment}`).join('/')}`;
};

const withHints = (
  diagnostic: configValidationDiagnostic,
  diagnosticHints: DiagnosticHints | undefined
): configValidationDiagnostic => {
  const hint = diagnosticHints?.[diagnostic.path];
  if (!hint) {
    return diagnostic;
  }
  return {
    ...diagnostic,
    ...hint
  };
};

const extractFirstIssue = (error: Error): SchemaIssue | undefined =>
  error instanceof ZodError ? error.issues.at(0) : undefined;

const buildIssueDiagnostic = (issue: SchemaIssue, context: SchemaDiagnosticContext): configValidationDiagnostic => {
  return {
    path: getIssuePath(issue.path),
    message: issue.message || `Invalid ${context.itemType} schema shape.`,
    suggestedFix: schemaFallbackFix
  };
};

const buildFallbackDiagnostic = (error: Error, context: SchemaDiagnosticContext): configValidationDiagnostic => ({
  path: rootPath,
  message: error.message || `Invalid JSON5 ${context.itemType} shape.`,
  suggestedFix: schemaFallbackFix
});

const toSchemaDiagnostic = (error: Error, context: SchemaDiagnosticContext): configValidationDiagnostic => {
  if (hasDiagnostic(error)) {
    return withHints(error.diagnostic, context.diagnosticHints);
  }

  const firstIssue = extractFirstIssue(error);
  if (firstIssue) {
    return withHints(buildIssueDiagnostic(firstIssue, context), context.diagnosticHints);
  }

  return withHints(buildFallbackDiagnostic(error, context), context.diagnosticHints);
};

const extractErrorMessage = (error: unknown, context: ErrorMessageContext): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return `Failed to parse JSON5 ${context.itemType} from ${context.source}.`;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

type ParseLocation = {lineNumber?: number; columnNumber?: number};

const isParseLocation = (value: unknown): value is ParseLocation =>
  isObject(value) &&
  (!('lineNumber' in value) || isFiniteNumber(value.lineNumber)) &&
  (!('columnNumber' in value) || isFiniteNumber(value.columnNumber));

const extractLineNumber = (error: unknown): number | null => {
  if (!isParseLocation(error)) {
    return null;
  }
  return error.lineNumber ?? null;
};

const extractColumnNumber = (error: unknown): number | null => {
  if (!isParseLocation(error)) {
    return null;
  }
  return error.columnNumber ?? null;
};

const buildDiagnosticPath = (source: string, lineNumber: number | null, columnNumber: number | null): string => {
  if (lineNumber !== null && columnNumber !== null) {
    return `${source}:${lineNumber}:${columnNumber}`;
  }
  return source;
};

const toParseDiagnostic = (error: unknown, context: ParseDiagnosticContext): configValidationDiagnostic => {
  const message = extractErrorMessage(error, context);
  const lineNumber = extractLineNumber(error);
  const columnNumber = extractColumnNumber(error);
  const path = buildDiagnosticPath(context.source, lineNumber, columnNumber);

  return withHints(
    {
      path,
      message,
      suggestedFix: parseFallbackFix
    },
    context.diagnosticHints
  );
};

export const parseJson5WithSchemaDiagnostics = <T>(options: ParseOptions<T>): ParseWithDiagnosticsResult<T> => {
  const {raw, source, schema, fallback, itemType = 'config', diagnosticHints} = options;
  try {
    const parsed: unknown = JSON5.parse(raw);
    const validated = schema.safeParse(parsed);
    if (validated.success === false) {
      return {
        value: fallback,
        diagnostics: [toSchemaDiagnostic(validated.error, {itemType, diagnosticHints})],
        usedFallback: true
      };
    }
    return {value: validated.data, diagnostics: [], usedFallback: false};
  } catch (error) {
    return {
      value: fallback,
      diagnostics: [toParseDiagnostic(error, {source, itemType, diagnosticHints})],
      usedFallback: true
    };
  }
};

export const parseJson5WithSchema = <T>(options: ParseOptions<T>): T => {
  const {source, itemType = 'config'} = options;
  const result = parseJson5WithSchemaDiagnostics(options);
  if (result.usedFallback) {
    console.warn(`Invalid JSON5 ${itemType} from ${source}. Falling back to defaults.`, {
      source,
      itemType,
      diagnostics: result.diagnostics
    });
  }
  return result.value;
};

export const sortKeys = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, sortKeys(item)])
    );
  }

  return value;
};

export const stringifyJson5 = (value: JsonValue): string => `${JSON5.stringify(sortKeys(value), null, 2)}\n`;
