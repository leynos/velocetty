/** @file JSON5 roundtrip helpers for runtime plugin settings persistence. */
import JSON5 from 'json5';

import {safeParseRawConfig, stringifyJson5} from '../config/json5-config';
import {Json5Parser, type Json5ObjectRange} from './plugin-runtime-json5-parser';

import type {rawConfig} from '@shared/types/config';

type RuntimePluginSettings = Record<string, unknown>;
export type PluginPersistencePatch = {
  pluginId: string;
  settings: RuntimePluginSettings;
};

const formatObjectKey = (key: string): string => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key));

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

const upsertObjectProperty = (
  raw: string,
  objectRange: Json5ObjectRange,
  key: string,
  value: unknown
): string | null => {
  const parser = new Json5Parser(raw);
  const properties = parser.parseObjectProperties(objectRange);
  if (!properties) {
    return null;
  }

  const existingProperty = properties.find((property) => property.key === key);
  if (existingProperty) {
    const propertyIndent = parser.getLineIndent(existingProperty.keyStartIndex);
    const formattedValue = formatJson5ValueForProperty(value, propertyIndent);
    return replaceSlice(raw, existingProperty.valueStartIndex, existingProperty.valueEndIndex, formattedValue);
  }

  const parentIndent = parser.getLineIndent(objectRange.openBraceIndex);
  const firstProperty = properties[0];
  const memberIndent = firstProperty ? parser.getLineIndent(firstProperty.keyStartIndex) : `${parentIndent}  `;
  const formattedProperty = `${memberIndent}${formatObjectKey(key)}: ${formatJson5ValueForProperty(value, memberIndent)}`;

  if (properties.length === 0) {
    return replaceSlice(
      raw,
      objectRange.openBraceIndex + 1,
      objectRange.closeBraceIndex,
      `\n${formattedProperty}\n${parentIndent}`
    );
  }

  const lastProperty = properties[properties.length - 1];
  if (!lastProperty) {
    return null;
  }
  const closeLineStartIndex = parser.getLineStartIndex(objectRange.closeBraceIndex);
  const closeLinePrefix = raw.slice(closeLineStartIndex, objectRange.closeBraceIndex);
  const closeLineIsIndentOnly = /^[ \t]*$/.test(closeLinePrefix);
  const insertionIndex = closeLineIsIndentOnly ? closeLineStartIndex : objectRange.closeBraceIndex;
  const separator = lastProperty.hasTrailingComma ? '' : ',';
  const prefix = raw.slice(0, insertionIndex);
  const leadingNewline = prefix.endsWith('\n') ? '' : '\n';

  return `${prefix}${separator}${leadingNewline}${formattedProperty}\n${raw.slice(insertionIndex)}`;
};

const getObjectRangeByPath = (raw: string, path: readonly string[]): Json5ObjectRange | null => {
  const parser = new Json5Parser(raw);
  let currentRange = parser.findRootObjectRange();
  if (!currentRange) {
    return null;
  }
  for (const key of path) {
    const property = parser.getObjectProperty(currentRange, key);
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

const ensureObjectPath = (raw: string, path: readonly string[]): string | null => {
  if (path.length === 0) {
    return raw;
  }

  let nextRaw = raw;
  for (let depth = 1; depth <= path.length; depth += 1) {
    const currentPath = path.slice(0, depth);
    if (getObjectRangeByPath(nextRaw, currentPath)) {
      continue;
    }
    const parentRange = getObjectRangeByPath(nextRaw, path.slice(0, depth - 1));
    if (!parentRange) {
      return null;
    }
    const key = path[depth - 1];
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
  let nextRaw = ensureObjectPath(raw, ['config']);
  if (!nextRaw) {
    return null;
  }
  nextRaw = ensureObjectPath(nextRaw, ['config', 'plugins']);
  if (!nextRaw) {
    return null;
  }

  const pluginsRange = getObjectRangeByPath(nextRaw, ['config', 'plugins']);
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
