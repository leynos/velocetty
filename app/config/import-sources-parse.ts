/** @file Parses configuration sources for the default/user config loader. */
/*
 * These helpers are pure over their inputs: a source's text and path go in, a
 * value and its diagnostics come out. Keeping them apart from the loader means
 * the read-only default query cannot accidentally acquire write helpers.
 */
import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import {isJsonValue} from '../utils/runtime-guards';
import {parseJson5WithSchemaDiagnostics, safeParseRawConfig, stringifyJson5, type ParseSchema} from './json5-config';

/** Bundles the raw text of a config source with the path diagnostics cite. */
export type ConfigSource = {
  readonly filePath: string;
  readonly rawContent: string;
};

const rawConfigSchema: ParseSchema<rawConfig> = {
  safeParse: (value) => safeParseRawConfig(value)
};

const rawConfigDiagnosticHints = {
  '/': {
    docHint: 'Top-level config payload object.',
    defaultHint: '{}'
  },
  '/config': {
    docHint: 'Root terminal configuration object.',
    defaultHint: '{}'
  },
  '/plugins': {
    docHint: 'List of plugins to fetch and install from npm.',
    defaultHint: '[]'
  },
  '/localPlugins': {
    docHint: 'List of local plugin directories to load in development.',
    defaultHint: '[]'
  },
  '/keymaps': {
    docHint: 'Command keymap overrides as strings or string arrays.',
    defaultHint: '{}'
  }
} as const;

/**
 * Emits one bounded warning per non-empty diagnostic list.
 *
 * The context names the layer in fixed words. Neither the source path nor the
 * diagnostics are logged: a diagnostic path can repeat a command identifier
 * and its message can quote the user's file. The user-facing notification is
 * the surface that explains the problem; the log keeps only the count.
 */
export const reportDiagnostics = (
  warnFn: typeof console.warn,
  context: string,
  diagnostics: readonly configValidationDiagnostic[]
) => {
  if (diagnostics.length === 0) {
    return;
  }
  warnFn(`[config-import] ${context}`, {count: diagnostics.length});
};

type ConfigParseOptions<T> = {
  readonly schema: ParseSchema<T>;
  readonly fallback: T;
  readonly itemType: string;
  readonly diagnosticHints: Record<string, {docHint?: string; defaultHint?: string}>;
};

/** Parses one source with the shared JSON5 helper and the caller's schema. */
const parseConfigSource = <T>(source: ConfigSource, options: ConfigParseOptions<T>) =>
  parseJson5WithSchemaDiagnostics({
    raw: source.rawContent,
    source: source.filePath,
    schema: options.schema,
    fallback: options.fallback,
    itemType: options.itemType,
    diagnosticHints: options.diagnosticHints
  });

/** Parses a configuration payload, falling back to `null` on invalid input. */
export const parseRawConfig = (source: ConfigSource) =>
  parseConfigSource(source, {
    schema: rawConfigSchema,
    fallback: null,
    itemType: 'config',
    diagnosticHints: rawConfigDiagnosticHints
  });

/** Serializes config using deterministic JSON5 formatting for stable snapshots. */
export const stringifyConfig = (config: rawConfig): string => {
  if (!isJsonValue(config)) {
    throw new TypeError('Config values must be JSON-compatible before serialization.');
  }
  return stringifyJson5(config);
};
