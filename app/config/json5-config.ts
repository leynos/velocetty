/** @file Runtime-safe JSON5 helpers for app-process config parsing and persistence. */
import JSON5 from 'json5';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';

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
type FieldValidator = (value: Record<string, unknown>, field: string) => DiagnosticError | null;

const rootPath = '/';
const schemaFallbackFix = 'Update the JSON structure to match the expected config schema.';
const parseFallbackFix = 'Fix the JSON5 syntax (for example, commas, quotes, or braces) and retry.';

const createDiagnosticError = (diagnostic: configValidationDiagnostic): DiagnosticError =>
  Object.assign(new Error(diagnostic.message), {diagnostic});

const getPathForField = (field: string): string => `/${field}`;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const isKeymapConfig = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' || isStringArray(entry));

const makeFieldValidator =
  (
    guard: (value: unknown) => boolean,
    message: (field: string) => string,
    suggestedFix: (field: string) => string
  ): FieldValidator =>
  (value, field) => {
    if (value[field] !== undefined && !guard(value[field])) {
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

export const validateRawConfig = (value: unknown): ParseResult<Record<string, unknown>> => {
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

  return {success: true, data: value};
};

export const safeParseRawConfig = (value: unknown): ParseResult<rawConfig> => {
  const parsed = validateRawConfig(value);
  if (!parsed.success) {
    return parsed;
  }
  return {success: true, data: parsed.data as rawConfig};
};

const hasDiagnostic = (error: unknown): error is DiagnosticError => {
  return isRecord(error) && isRecord(error.diagnostic);
};

const getIssuePath = (path: unknown): string => {
  if (!Array.isArray(path) || path.length === 0) {
    return rootPath;
  }
  const segments = path.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
  if (segments.length === 0) {
    return rootPath;
  }
  return `/${segments.map((segment) => String(segment)).join('/')}`;
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

const extractFirstIssue = (error: Error): Record<string, unknown> | undefined => {
  const issues = (error as {issues?: unknown}).issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return undefined;
  }
  const firstIssue = issues[0];
  return isRecord(firstIssue) ? firstIssue : undefined;
};

const buildIssueDiagnostic = (
  issue: Record<string, unknown>,
  context: SchemaDiagnosticContext
): configValidationDiagnostic => {
  const issuePath = 'path' in issue ? issue.path : undefined;
  const issueMessage = 'message' in issue ? issue.message : undefined;
  return {
    path: getIssuePath(issuePath),
    message: typeof issueMessage === 'string' ? issueMessage : `Invalid ${context.itemType} schema shape.`,
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

const getFiniteNumberProperty = (record: Record<string, unknown>, property: string): number | null => {
  const value = record[property];
  return isFiniteNumber(value) ? value : null;
};

const extractLineNumber = (error: unknown): number | null => {
  if (!isRecord(error)) {
    return null;
  }
  return getFiniteNumberProperty(error, 'lineNumber');
};

const extractColumnNumber = (error: unknown): number | null => {
  if (!isRecord(error)) {
    return null;
  }
  return getFiniteNumberProperty(error, 'columnNumber');
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
    const parsed = JSON5.parse(raw) as unknown;
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

export const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, sortKeys(item)])
    );
  }

  return value;
};

export const stringifyJson5 = (value: unknown): string => `${JSON5.stringify(sortKeys(value), null, 2)}\n`;
