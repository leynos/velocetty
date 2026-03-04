/** @file JSON5 roundtrip helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';

import {safeParseRawConfig, stringifyJson5} from '../config/json5-config';
import {Json5Parser, type Json5ObjectProperty, type Json5ObjectRange} from './plugin-runtime-json5-parser';

import type {rawConfig} from '@shared/types/config';

type RuntimePluginSettings = Record<string, unknown>;
/** Represents a JSON5 object property key with validation semantics. */
export type PropertyKey = {
  readonly value: string;
} & {readonly __brand: 'PropertyKey'};

/** Represents a plugin identifier. */
export type PluginId = {
  readonly value: string;
} & {readonly __brand: 'PluginId'};

/** Represents a path through nested JSON5 objects. */
export type PropertyPath = {
  readonly segments: readonly PropertyKey[];
} & {readonly __brand: 'PropertyPath'};

export const propertyKey = (value: string): PropertyKey => ({value}) as PropertyKey;
export const pluginId = (value: string): PluginId => ({value}) as PluginId;
export const propertyPath = (segments: readonly PropertyKey[]): PropertyPath => ({segments}) as PropertyPath;
/** Nominal type representing a raw JSON5 document string.
 *  Prevents confusing arbitrary strings with a document under round-trip. */
export type Json5Document = string & {readonly __brand: 'Json5Document'};

/** Wraps a raw string as a Json5Document. No validation is performed. */
export const json5Document = (raw: string): Json5Document => raw as Json5Document;

export type PluginPersistencePatch = {
  pluginId: PluginId;
  settings: RuntimePluginSettings;
};

const formatObjectKey = (key: PropertyKey): string =>
  /^[\p{ID_Start}_$][\p{ID_Continue}_$]*$/u.test(key.value) ? key.value : JSON.stringify(key.value);

const formatJson5ValueForProperty = (value: unknown, propertyIndent: string): string => {
  const serialized = stringifyJson5(value).trimEnd();
  const lines = serialized.split('\n');
  if (lines.length <= 1) {
    return serialized;
  }
  return `${lines[0]}\n${lines
    .slice(1)
    .map((line) => `${propertyIndent}${line}`)
    .join('\n')}`;
};

const replaceSlice = (doc: Json5Document, startIndex: number, endIndex: number, replacement: string): Json5Document =>
  `${doc.slice(0, startIndex)}${replacement}${doc.slice(endIndex)}` as Json5Document;

const updateExistingProperty = (
  doc: Json5Document,
  parser: Json5Parser,
  existingProperty: Json5ObjectProperty,
  value: unknown
): Json5Document => {
  const propertyIndent = parser.getLineIndent({index: existingProperty.keyStartIndex});
  const formattedValue = formatJson5ValueForProperty(value, propertyIndent);
  return replaceSlice(doc, existingProperty.valueStartIndex, existingProperty.valueEndIndex, formattedValue);
};

const insertIntoEmptyObject = ({
  doc,
  parser,
  objectRange,
  key,
  value
}: {
  doc: Json5Document;
  parser: Json5Parser;
  objectRange: Json5ObjectRange;
  key: PropertyKey;
  value: unknown;
}): Json5Document => {
  const parentIndent = parser.getLineIndent({index: objectRange.openBraceIndex});
  const memberIndent = `${parentIndent}  `;
  const formattedProperty = `${memberIndent}${formatObjectKey(key)}: ${formatJson5ValueForProperty(value, memberIndent)}`;
  return replaceSlice(
    doc,
    objectRange.closeBraceIndex,
    objectRange.closeBraceIndex,
    `\n${formattedProperty}\n${parentIndent}`
  );
};

const appendToExistingObject = (
  doc: Json5Document,
  parser: Json5Parser,
  objectRange: Json5ObjectRange,
  properties: readonly Json5ObjectProperty[],
  key: PropertyKey,
  value: unknown
): Json5Document | null => {
  const parentIndent = parser.getLineIndent({index: objectRange.openBraceIndex});
  const firstProperty = properties[0];
  const memberIndent = firstProperty ? parser.getLineIndent({index: firstProperty.keyStartIndex}) : `${parentIndent}  `;
  const formattedProperty = `${memberIndent}${formatObjectKey(key)}: ${formatJson5ValueForProperty(value, memberIndent)}`;
  const lastProperty = properties[properties.length - 1];
  if (!lastProperty) {
    return null;
  }

  const closeLineStartIndex = parser.getLineStartIndex({index: objectRange.closeBraceIndex});
  const closeLinePrefix = doc.slice(closeLineStartIndex, objectRange.closeBraceIndex);
  const closeLineIsIndentOnly = /^[ \t]*$/.test(closeLinePrefix);
  const insertionIndex = closeLineIsIndentOnly ? closeLineStartIndex : objectRange.closeBraceIndex;
  const separator = lastProperty.hasTrailingComma ? '' : ',';
  const prefix = doc.slice(0, insertionIndex);
  const leadingNewline = prefix.endsWith('\n') ? '' : '\n';

  return `${prefix}${separator}${leadingNewline}${formattedProperty}\n${doc.slice(insertionIndex)}` as Json5Document;
};

const upsertObjectProperty = (
  doc: Json5Document,
  objectRange: Json5ObjectRange,
  key: PropertyKey,
  value: unknown
): Json5Document | null => {
  const parser = new Json5Parser(doc);
  const properties = parser.parseObjectProperties(objectRange);
  if (!properties) {
    return null;
  }

  const existingProperty = properties.find((property) => property.key === key.value);
  if (existingProperty) {
    return updateExistingProperty(doc, parser, existingProperty, value);
  }

  if (properties.length === 0) {
    return insertIntoEmptyObject({doc, parser, objectRange, key, value});
  }

  return appendToExistingObject(doc, parser, objectRange, properties, key, value);
};

const getObjectRangeByPath = (doc: Json5Document, path: PropertyPath): Json5ObjectRange | null => {
  const parser = new Json5Parser(doc);
  let currentRange = parser.findRootObjectRange();
  if (!currentRange) {
    return null;
  }
  for (const key of path.segments) {
    const property = parser.getObjectProperty(currentRange, key.value);
    if (!property) {
      return null;
    }
    const nextRange = parser.getObjectRangeForProperty(property);
    if (!nextRange) {
      return null;
    }
    currentRange = nextRange;
  }
  return currentRange;
};

const ensureObjectPath = (doc: Json5Document, path: PropertyPath): Json5Document | null => {
  if (path.segments.length === 0) {
    return doc;
  }

  let nextDoc: Json5Document = doc;
  for (let depth = 1; depth <= path.segments.length; depth += 1) {
    const currentPath = propertyPath(path.segments.slice(0, depth));
    if (getObjectRangeByPath(nextDoc, currentPath)) {
      continue;
    }
    const parentPath = propertyPath(path.segments.slice(0, depth - 1));
    const parentRange = getObjectRangeByPath(nextDoc, parentPath);
    if (!parentRange) {
      return null;
    }
    const key = path.segments[depth - 1];
    if (key === undefined) {
      return null;
    }
    const updated = upsertObjectProperty(nextDoc, parentRange, key, {});
    if (!updated) {
      return null;
    }
    nextDoc = updated;
  }

  return nextDoc;
};

const applyPluginSettingsPatch = (doc: Json5Document, patch: PluginPersistencePatch): Json5Document | null => {
  let nextDoc: Json5Document | null = ensureObjectPath(doc, propertyPath([propertyKey('config')]));
  if (!nextDoc) {
    return null;
  }
  nextDoc = ensureObjectPath(nextDoc, propertyPath([propertyKey('config'), propertyKey('plugins')]));
  if (!nextDoc) {
    return null;
  }

  const pluginsRange = getObjectRangeByPath(nextDoc, propertyPath([propertyKey('config'), propertyKey('plugins')]));
  if (!pluginsRange) {
    return null;
  }
  return upsertObjectProperty(nextDoc, pluginsRange, propertyKey(patch.pluginId.value), patch.settings);
};

export const applyPluginSettingsPatches = (
  doc: Json5Document,
  patches: readonly PluginPersistencePatch[]
): Json5Document | null => {
  let nextDoc: Json5Document = doc;
  for (const patch of patches) {
    const updated = applyPluginSettingsPatch(nextDoc, patch);
    if (!updated) {
      return null;
    }
    nextDoc = updated;
  }
  return nextDoc;
};

export const parseConfigJson5Strict = (doc: Json5Document): rawConfig | null => {
  try {
    const parsed = JSON5.parse(doc) as unknown;
    const validated = safeParseRawConfig(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
};
