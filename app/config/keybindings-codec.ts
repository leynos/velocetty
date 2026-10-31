/** @file JSON5 keybindings codec: validation, diagnostics, and canonical text. */
/*
 * This is the trust boundary for user keybindings. Text arrives from a file
 * the user edits, so parsing must terminate for any string, and every
 * rejection must carry an actionable diagnostic.
 */
import JSON5 from 'json5';
import {z} from 'zod';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import type {JsonObject} from '@shared/types/json';
import {isObject, isString} from '../utils/runtime-guards';
import {stringifyJson5} from './json5-config';
import type {UserKeymaps} from './keybindings-policy';

/** The parser's verdict on one keybindings document. */
export type KeybindingsParseOutcome =
  | {readonly kind: 'ok'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'invalid'; readonly diagnostics: readonly configValidationDiagnostic[]};

/** Command ids are non-empty and carry no leading or trailing whitespace. */
const COMMAND_ID_PATTERN = /^\S(?:[\s\S]*\S)?$/;

/** Shortcuts are non-empty and not only whitespace; their grammar is not ours yet. */
const SHORTCUT_PATTERN = /\S/;

/** Editor tooling owns this key; it never becomes a command binding. */
const RESERVED_SCHEMA_KEY = '$schema';

const commandIdSchema = z.string().min(1).regex(COMMAND_ID_PATTERN);
const shortcutSchema = z.string().regex(SHORTCUT_PATTERN);
const bindingSchema = z.union([shortcutSchema, z.array(shortcutSchema)]);

/**
 * The keybindings schema.
 *
 * Zod's own record parsing assigns with `[[Set]]`, which silently drops an own
 * `__proto__` key. `parseKeybindingsText` therefore validates entries through
 * the schemas below but assembles the map itself, so prototype-named command
 * ids survive. The generated JSON Schema has no such gap.
 */
export const keybindingsSchema: z.ZodType<UserKeymaps> = z.record(commandIdSchema, bindingSchema);

/**
 * The draft-07 JSON Schema editors consume for `keybindings.json5`.
 *
 * `$schema` is editor metadata rather than a binding, so the schema names it
 * explicitly and requires a non-blank string. Draft-07 applies
 * `additionalProperties` only to keys absent from `properties`, so the other
 * keys keep the binding shape while `$schema` does not.
 */
export const keybindingsJsonSchema = () => {
  const recordSchema = z.toJSONSchema(keybindingsSchema, {target: 'draft-7'});
  return {
    ...recordSchema,
    properties: {[RESERVED_SCHEMA_KEY]: {pattern: '\\S', type: 'string'}}
  };
};

/** The three parts of one actionable diagnostic. */
type DiagnosticSpec = {
  readonly message: string;
  readonly path: string;
  readonly suggestedFix: string;
};

const diagnostic = ({message, path, suggestedFix}: DiagnosticSpec): configValidationDiagnostic => ({
  message,
  path,
  suggestedFix
});

const rootDiagnostic = (sourceLabel: string): configValidationDiagnostic =>
  diagnostic({
    message: 'Expected a JSON5 object mapping command ids to shortcuts.',
    path: sourceLabel,
    suggestedFix: 'Wrap the keybindings in braces, for example {}.'
  });

const commandIdDiagnostic = (command: string): configValidationDiagnostic =>
  diagnostic({
    message: `Invalid command identifier ${JSON.stringify(command)}: it must be non-empty and carry no leading or trailing whitespace.`,
    path: `/${command}`,
    suggestedFix: 'Remove the surrounding whitespace or rename the command.'
  });

const schemaKeyDiagnostic = (): configValidationDiagnostic =>
  diagnostic({
    message: 'Expected the $schema key to hold a non-empty string.',
    path: `/${RESERVED_SCHEMA_KEY}`,
    suggestedFix: 'Set $schema to the schema URL, or remove the key.'
  });

const bindingDiagnostic = (command: string): configValidationDiagnostic =>
  diagnostic({
    message: 'Expected a non-empty shortcut string or an array of non-empty shortcut strings.',
    path: `/${command}`,
    suggestedFix: "Set the command to a shortcut such as 'ctrl+n', or to [] to unbind it."
  });

type LocatedError = {lineNumber?: number; columnNumber?: number};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const locatedError = (error: unknown): LocatedError => {
  const located: LocatedError = {};
  if (!isObject(error)) {
    return located;
  }
  if ('lineNumber' in error && isFiniteNumber(error.lineNumber)) {
    located.lineNumber = error.lineNumber;
  }
  if ('columnNumber' in error && isFiniteNumber(error.columnNumber)) {
    located.columnNumber = error.columnNumber;
  }
  return located;
};

const parseDiagnostic = (sourceLabel: string, error: unknown): configValidationDiagnostic => {
  const message =
    error instanceof Error && error.message.length > 0 ? error.message : `Failed to parse ${sourceLabel}.`;
  const {lineNumber, columnNumber} = locatedError(error);
  const path =
    lineNumber !== undefined && columnNumber !== undefined
      ? `${sourceLabel}:${lineNumber}:${columnNumber}`
      : sourceLabel;
  return diagnostic({
    message,
    path,
    suggestedFix: 'Fix the JSON5 syntax (for example, commas, quotes, or braces) and retry.'
  });
};

/**
 * Narrows the parsed root to a JSON object without walking its values.
 *
 * `isJsonObject` recurses through every nested value, so a balanced but very
 * deep document could exhaust the stack after `JSON5.parse` succeeded. Only the
 * root needs narrowing here, and the claim is still sound because everything
 * `JSON5.parse` produces is a JSON value. Each entry is validated shallowly
 * below, which keeps parsing total.
 */
const isDocumentRoot = (value: unknown): value is JsonObject => isObject(value) && !Array.isArray(value);

const isBindingValue = (value: unknown): value is string | string[] =>
  bindingSchema.safeParse(value).success &&
  (isString(value) || (Array.isArray(value) && value.every((item) => isString(item))));

const copyBinding = (binding: string | string[]): string | string[] =>
  Array.isArray(binding) ? [...binding] : binding;

type EntryRead = {
  readonly entries: ReadonlyArray<readonly [string, string | string[]]>;
  readonly diagnostics: readonly configValidationDiagnostic[];
};

const readEntries = (root: JsonObject): EntryRead => {
  const entries: Array<readonly [string, string | string[]]> = [];
  const diagnostics: configValidationDiagnostic[] = [];

  for (const [command, value] of Object.entries(root)) {
    if (command === RESERVED_SCHEMA_KEY) {
      // The generated schema names `$schema` as a string, so the codec must
      // require one too or Ajv and the codec would accept different files.
      if (!shortcutSchema.safeParse(value).success) {
        diagnostics.push(schemaKeyDiagnostic());
      }
      continue;
    }
    if (!commandIdSchema.safeParse(command).success) {
      diagnostics.push(commandIdDiagnostic(command));
      continue;
    }
    if (!isBindingValue(value)) {
      diagnostics.push(bindingDiagnostic(command));
      continue;
    }
    entries.push([command, copyBinding(value)]);
  }

  return {entries, diagnostics};
};

/**
 * Parses keybindings text into validated keymaps, or explains why it cannot.
 *
 * Total by construction: JSON5 syntax errors, pathological nesting, and shape
 * violations all return `invalid` with at least one actionable diagnostic.
 *
 * @param text - The JSON5 document to parse.
 * @param sourceLabel - The file or label reported in diagnostics.
 * @returns The keymaps, or diagnostics describing every rejection.
 *
 * @example
 * ```ts
 * parseKeybindingsText(`{'window:new': 'ctrl+n'}`, 'keybindings.json5');
 * // {kind: 'ok', keymaps: {'window:new': 'ctrl+n'}}
 * ```
 */
export const parseKeybindingsText = (text: string, sourceLabel: string): KeybindingsParseOutcome => {
  let parsed: unknown;
  try {
    parsed = JSON5.parse(text);
  } catch (error) {
    return {kind: 'invalid', diagnostics: [parseDiagnostic(sourceLabel, error)]};
  }

  if (!isDocumentRoot(parsed)) {
    return {kind: 'invalid', diagnostics: [rootDiagnostic(sourceLabel)]};
  }

  const {entries, diagnostics} = readEntries(parsed);
  if (diagnostics.length > 0) {
    return {kind: 'invalid', diagnostics};
  }
  return {kind: 'ok', keymaps: Object.fromEntries(entries)};
};

const HEADER = [
  '// Velocetty keybindings: command ids mapped to a shortcut string or an array of shortcuts.',
  '// An empty array unbinds a command.'
].join('\n');

/**
 * Writes the canonical text used when bootstrap creates the file.
 *
 * Only first-run bootstrap uses this; import and export store user text
 * verbatim, so their comments and formatting survive.
 *
 * @param keymaps - The keymaps to write.
 * @returns Header comment, a blank line, then sorted two-space JSON5.
 *
 * @example
 * ```ts
 * serializeKeybindings({'window:new': 'ctrl+n'}).startsWith('// Velocetty keybindings');
 * // true
 * ```
 */
export const serializeKeybindings = (keymaps: UserKeymaps): string => `${HEADER}\n\n${stringifyJson5(keymaps)}`;

/**
 * Copies validated keymaps into the mutable raw-config shape.
 *
 * @param keymaps - The validated keymaps to copy.
 * @returns An independent map, with each binding array copied too.
 *
 * @example
 * ```ts
 * const raw = toRawKeymaps({'window:new': ['ctrl+n']});
 * raw['window:new'] = 'ctrl+m'; // the input is unchanged
 * ```
 */
export const toRawKeymaps = (keymaps: UserKeymaps): NonNullable<rawConfig['keymaps']> =>
  Object.fromEntries(Object.entries(keymaps).map(([command, binding]) => [command, copyBinding(binding)] as const));
