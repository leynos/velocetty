/**
 * @file Generators for JSON5 config documents used by the edit properties.
 *
 * Two sources feed the property suite. `json5DocumentArbitrary` prints a
 * generated value tree in a randomly chosen JSON5 style (comments, quoted or
 * bare keys, single or double quotes, trailing commas, LF or CRLF, BOM,
 * several properties on one line). `json5FixtureCases` reads the handwritten
 * fixtures, which cover formatting the printer deliberately does not emit.
 *
 * `JSON5.parse` is the oracle for both, so a bug in the printer surfaces as a
 * failing property rather than as a silent mismatch.
 */
import fs from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';

import {isBoolean, isNumber, isString} from '@shared/types/guards';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';

/** One document plus the value it must parse to. */
export type Json5DocumentCase = {
  readonly text: string;
  readonly value: JsonValue;
};

/** The formatting choices the printer can make. */
export type Json5Style = {
  readonly indent: string;
  readonly newline: string;
  readonly quote: '"' | "'";
  readonly quoteKeys: boolean;
  readonly trailingComma: boolean;
  readonly commentBefore: boolean;
  readonly commentAfter: boolean;
  readonly inlinePairs: boolean;
  readonly bom: boolean;
};

const FIXTURE_DIRECTORY = path.join(process.cwd(), 'test/fixtures/json5-config');
const PROPERTY_KEYS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

const styleArbitrary: fc.Arbitrary<Json5Style> = fc
  .record({
    indent: fc.constantFrom('  ', '    ', '\t'),
    newline: fc.constantFrom('\n', '\r\n'),
    quote: fc.constantFrom('"' as const, "'" as const),
    quoteKeys: fc.boolean(),
    trailingComma: fc.boolean(),
    commentBefore: fc.boolean(),
    commentAfter: fc.boolean(),
    inlinePairs: fc.boolean(),
    bom: fc.boolean()
  })
  // An inline pair would turn the next property into part of a line comment.
  .map((style) => (style.inlinePairs ? {...style, commentBefore: false, commentAfter: false} : style));

const identifierKey = (key: string): boolean => /^[\p{ID_Start}_$][\p{ID_Continue}_$]*$/u.test(key);

const printKey = (key: string, style: Json5Style): string => {
  if (!style.quoteKeys && identifierKey(key)) {
    return key;
  }
  return `${style.quote}${escapeText(key, style.quote)}${style.quote}`;
};

const escapeText = (text: string, quote: '"' | "'"): string =>
  Array.from(text, (character) => {
    if (character === '\\') {
      return String.raw`\\`;
    }
    if (character === quote) {
      return `\\${quote}`;
    }
    if (character === '\n') {
      return String.raw`\n`;
    }
    if (character === '\r') {
      return String.raw`\r`;
    }
    if (character === '\t') {
      return String.raw`\t`;
    }
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : character;
  }).join('');

const printPrimitive = (value: JsonValue, style: Json5Style): string | undefined => {
  if (value === null) {
    return 'null';
  }
  if (isBoolean(value)) {
    return String(value);
  }
  if (isNumber(value)) {
    return String(value === 0 ? 0 : value);
  }
  if (isString(value)) {
    return `${style.quote}${escapeText(value, style.quote)}${style.quote}`;
  }
  return undefined;
};

const printArray = (values: readonly JsonValue[], depth: number, style: Json5Style): string => {
  if (values.length === 0) {
    return '[]';
  }
  const innerIndent = style.indent.repeat(depth + 1);
  const outerIndent = style.indent.repeat(depth);
  const items = values.map((item, index) => {
    const comma = index < values.length - 1 || style.trailingComma ? ',' : '';
    return `${printValue(item, depth + 1, style)}${comma}`;
  });
  return `[${style.newline}${innerIndent}${items.join(`${style.newline}${innerIndent}`)}${style.newline}${outerIndent}]`;
};

const printObject = (value: JsonObject, depth: number, style: Json5Style): string => {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }
  const innerIndent = style.indent.repeat(depth + 1);
  const outerIndent = style.indent.repeat(depth);
  const members = entries.map(([key, child], index) => {
    const isLast = index === entries.length - 1;
    const comma = !isLast || style.trailingComma ? ',' : '';
    const before = style.commentBefore && index % 2 === 0 ? `/* property ${index} */ ` : '';
    const after = style.commentAfter && index % 3 === 0 ? ' // trailing note' : '';
    return `${before}${printKey(key, style)}: ${printValue(child, depth + 1, style)}${comma}${after}`;
  });
  const separator = style.inlinePairs ? ' ' : `${style.newline}${innerIndent}`;
  return `{${style.newline}${innerIndent}${members.join(separator)}${style.newline}${outerIndent}}`;
};

/**
 * Prints one JSON value as JSON5 in the requested style.
 *
 * @param value - The value to print.
 * @param depth - The current nesting depth, used for indentation.
 * @param style - The formatting choices.
 * @returns JSON5 text that parses back to `value`.
 *
 * @example
 * printValue({config: {}}, 0, style).startsWith('{'); // true
 */
export const printValue = (value: JsonValue, depth: number, style: Json5Style): string => {
  const primitive = printPrimitive(value, style);
  if (primitive !== undefined) {
    return primitive;
  }
  if (Array.isArray(value)) {
    return printArray(value, depth, style);
  }
  if (isJsonObject(value)) {
    return printObject(value, depth, style);
  }
  return 'null';
};

/**
 * Wraps a value as a config document in the requested style.
 *
 * @param config - The generated `config` object.
 * @param style - The formatting choices.
 * @returns The document text and its expected parsed value.
 *
 * @example
 * printDocument({alpha: 1}, style).value; // {config: {alpha: 1}}
 */
export const printDocument = (config: JsonObject, style: Json5Style): Json5DocumentCase => {
  const value: JsonObject = {config};
  const body = printValue(value, 0, style);
  const text = `${style.bom ? '\uFEFF' : ''}${body}${style.newline}`;
  return {text, value};
};

const primitiveArbitrary: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.boolean(),
  fc.integer({min: -1000, max: 1000}),
  fc
    .double({min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true})
    // Negative zero prints and parses as zero; normalise it here so a value
    // comparison is about the document, not about a signed zero.
    .map((value) => (Object.is(value, -0) ? 0 : value)),
  fc.string({maxLength: 12}),
  fc.constant(null)
);

const valueArbitrary = (depth: number): fc.Arbitrary<JsonValue> => {
  if (depth <= 0) {
    return primitiveArbitrary;
  }
  const nested = valueArbitrary(depth - 1);
  return fc.oneof(
    primitiveArbitrary,
    fc.array(nested, {maxLength: 3}),
    fc.dictionary(fc.constantFrom(...PROPERTY_KEYS), nested, {maxKeys: 3})
  );
};

const generatedConfigArbitrary: fc.Arbitrary<JsonObject> = fc.dictionary(
  fc.constantFrom(...PROPERTY_KEYS),
  valueArbitrary(2),
  {maxKeys: 4}
);

/** Documents with generated shapes and randomized formatting. */
export const json5DocumentArbitrary: fc.Arbitrary<Json5DocumentCase> = fc
  .tuple(generatedConfigArbitrary, styleArbitrary)
  .map(([config, style]) => printDocument(config, style));

/** Documents that begin from a generated value and add a value to set. */
export type EditCase = Json5DocumentCase & {
  readonly key: string;
  readonly nextValue: JsonValue;
};

/** A generated document plus the property to set and the value to set it to. */
export const json5EditArbitrary: fc.Arbitrary<EditCase> = fc
  .tuple(json5DocumentArbitrary, fc.constantFrom(...PROPERTY_KEYS), valueArbitrary(1), fc.boolean())
  .map(([document, key, nextValue, replacesExisting]) => {
    // SAFETY: the arbitrary only prints documents whose root is an object
    // with an object `config` member, so the parsed value has that shape.
    const config = document.value as JsonObject;
    // SAFETY: as above; `printDocument` always writes an object `config`.
    const existing = config.config as JsonObject;
    const chosenKey = replacesExisting && Object.keys(existing).length > 0 ? Object.keys(existing)[0] : key;
    return {...document, key: chosenKey, nextValue};
  });

/**
 * Reads the handwritten fixtures.
 *
 * @returns One case per `.json5` file, with the text exactly as committed.
 *
 * @example
 * json5FixtureCases().length; // 6
 */
export const json5FixtureCases = (): readonly {readonly name: string; readonly text: string}[] => {
  const files = fs
    .readdirSync(FIXTURE_DIRECTORY)
    .filter((file) => file.endsWith('.json5'))
    .toSorted();
  return files.map((file) => ({
    name: file.replace(/\.json5$/u, ''),
    text: fs.readFileSync(path.join(FIXTURE_DIRECTORY, file), 'utf8')
  }));
};

/**
 * Builds the style used by the named examples.
 *
 * @param overrides - Style fields to override.
 * @returns A complete style.
 *
 * @example
 * defaultStyle({newline: '\r\n'}).newline; // '\r\n'
 */
export const defaultStyle = (overrides: Partial<Json5Style> = {}): Json5Style => ({
  indent: '  ',
  newline: '\n',
  quote: '"',
  quoteKeys: false,
  trailingComma: false,
  commentBefore: false,
  commentAfter: false,
  inlinePairs: false,
  bom: false,
  ...overrides
});
