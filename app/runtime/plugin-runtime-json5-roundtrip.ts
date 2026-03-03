/** @file JSON5 roundtrip helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';

import {safeParseRawConfig, stringifyJson5} from '../config/json5-config';
import {Json5Parser, type Json5ObjectProperty, type Json5ObjectRange} from './plugin-runtime-json5-parser';

import type {rawConfig} from '@shared/types/config';

type RuntimePluginSettings = Record<string, unknown>;
/** Represents a JSON5 object property key with validation semantics. */
export type PropertyKey = {
  readonly value: string;
};

/** Represents a plugin identifier. */
export type PluginId = {
  readonly value: string;
};

/** Represents a path through nested JSON5 objects. */
export type PropertyPath = {
  readonly segments: readonly PropertyKey[];
};

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

const replaceSlice = (raw: string, startIndex: number, endIndex: number, replacement: string): string =>
  `${raw.slice(0, startIndex)}${replacement}${raw.slice(endIndex)}`;

const updateExistingProperty = (
  raw: string,
  parser: Json5Parser,
  existingProperty: Json5ObjectProperty,
  value: unknown
): string => {
  const propertyIndent = parser.getLineIndent({index: existingProperty.keyStartIndex});
  const formattedValue = formatJson5ValueForProperty(value, propertyIndent);
  return replaceSlice(raw, existingProperty.valueStartIndex, existingProperty.valueEndIndex, formattedValue);
};

const insertIntoEmptyObject = (
  raw: string,
  parser: Json5Parser,
  objectRange: Json5ObjectRange,
  key: PropertyKey,
  value: unknown
): string => {
  const parentIndent = parser.getLineIndent({index: objectRange.openBraceIndex});
  const memberIndent = `${parentIndent}  `;
  const formattedProperty = `${memberIndent}${formatObjectKey(key)}: ${formatJson5ValueForProperty(value, memberIndent)}`;
  return replaceSlice(
    raw,
    objectRange.openBraceIndex + 1,
    objectRange.closeBraceIndex,
    `\n${formattedProperty}\n${parentIndent}`
  );
};

const appendToExistingObject = (
  raw: string,
  parser: Json5Parser,
  objectRange: Json5ObjectRange,
  properties: readonly Json5ObjectProperty[],
  key: PropertyKey,
  value: unknown
): string | null => {
  const parentIndent = parser.getLineIndent({index: objectRange.openBraceIndex});
  const firstProperty = properties[0];
  const memberIndent = firstProperty ? parser.getLineIndent({index: firstProperty.keyStartIndex}) : `${parentIndent}  `;
  const formattedProperty = `${memberIndent}${formatObjectKey(key)}: ${formatJson5ValueForProperty(value, memberIndent)}`;
  const lastProperty = properties[properties.length - 1];
  if (!lastProperty) {
    return null;
  }

  const closeLineStartIndex = parser.getLineStartIndex({index: objectRange.closeBraceIndex});
  const closeLinePrefix = raw.slice(closeLineStartIndex, objectRange.closeBraceIndex);
  const closeLineIsIndentOnly = /^[ \t]*$/.test(closeLinePrefix);
  const insertionIndex = closeLineIsIndentOnly ? closeLineStartIndex : objectRange.closeBraceIndex;
  const separator = lastProperty.hasTrailingComma ? '' : ',';
  const prefix = raw.slice(0, insertionIndex);
  const leadingNewline = prefix.endsWith('\n') ? '' : '\n';

  return `${prefix}${separator}${leadingNewline}${formattedProperty}\n${raw.slice(insertionIndex)}`;
};

const upsertObjectProperty = (
  raw: string,
  objectRange: Json5ObjectRange,
  key: PropertyKey,
  value: unknown
): string | null => {
  const parser = new Json5Parser(raw);
  const properties = parser.parseObjectProperties(objectRange);
  if (!properties) {
    return null;
  }

  const existingProperty = properties.find((property) => property.key === key.value);
  if (existingProperty) {
    return updateExistingProperty(raw, parser, existingProperty, value);
  }

  if (properties.length === 0) {
    return insertIntoEmptyObject(raw, parser, objectRange, key, value);
  }

  return appendToExistingObject(raw, parser, objectRange, properties, key, value);
};

const getObjectRangeByPath = (raw: string, path: PropertyPath): Json5ObjectRange | null => {
  const parser = new Json5Parser(raw);
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

const ensureObjectPath = (raw: string, path: PropertyPath): string | null => {
  if (path.segments.length === 0) {
    return raw;
  }

  let nextRaw = raw;
  for (let depth = 1; depth <= path.segments.length; depth += 1) {
    const currentPath: PropertyPath = {segments: path.segments.slice(0, depth)};
    if (getObjectRangeByPath(nextRaw, currentPath)) {
      continue;
    }
    const parentPath: PropertyPath = {segments: path.segments.slice(0, depth - 1)};
    const parentRange = getObjectRangeByPath(nextRaw, parentPath);
    if (!parentRange) {
      return null;
    }
    const key = path.segments[depth - 1];
    if (key === undefined) {
      return null;
    }
    const updated = upsertObjectProperty(nextRaw, parentRange, key, {});
    if (!updated) {
      return null;
    }
    nextRaw = updated;
  }

  return nextRaw;
};

const applyPluginSettingsPatch = (raw: string, patch: PluginPersistencePatch): string | null => {
  let nextRaw = ensureObjectPath(raw, {segments: [{value: 'config'}]});
  if (!nextRaw) {
    return null;
  }
  nextRaw = ensureObjectPath(nextRaw, {segments: [{value: 'config'}, {value: 'plugins'}]});
  if (!nextRaw) {
    return null;
  }

  const pluginsRange = getObjectRangeByPath(nextRaw, {segments: [{value: 'config'}, {value: 'plugins'}]});
  if (!pluginsRange) {
    return null;
  }
  return upsertObjectProperty(nextRaw, pluginsRange, patch.pluginId, patch.settings);
};

export const applyPluginSettingsPatches = (raw: string, patches: readonly PluginPersistencePatch[]): string | null => {
  let nextRaw = raw;
  for (const patch of patches) {
    const updated = applyPluginSettingsPatch(nextRaw, patch);
    if (!updated) {
      return null;
    }
    nextRaw = updated;
  }
  return nextRaw;
};

export const parseConfigJson5Strict = (raw: string): rawConfig | null => {
  try {
    const parsed = JSON5.parse(raw) as unknown;
    const validated = safeParseRawConfig(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
};
