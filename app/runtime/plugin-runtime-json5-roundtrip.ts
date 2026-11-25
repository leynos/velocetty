/**
 * @file JSON5 persistence helpers for runtime plugin settings.
 *
 * The edit itself lives in `app/config/json5/document-edit.ts`; this module
 * only names the plugin shape and refuses to write when the document cannot be
 * edited safely.
 */
import JSON5 from 'json5';

import {propertyKey, setPropertyAtPath, type Json5Document} from '../config/json5';
import {safeParseRawConfig} from '../config/json5-config';

import type {rawConfig} from '@shared/types/config';
import type {JsonObject, JsonValue} from '@shared/types/json';

export {json5Document, type Json5Document} from '../config/json5';

/** A plugin identifier. */
export type PluginId = {
  readonly value: string;
} & {readonly __brand: 'PluginId'};

/**
 * Brands a plugin id.
 *
 * @param value - The manifest id.
 * @returns The branded id.
 *
 * @example
 * pluginId('demo'); // {value: 'demo'}
 */
export const pluginId = (value: string): PluginId => {
  // SAFETY: plugin identifiers enter persistence through this constructor.
  return {value} as PluginId;
};

/** One plugin's complete settings object to persist. */
export type PluginPersistencePatch = {
  pluginId: PluginId;
  settings: JsonObject;
};

/**
 * Applies plugin settings patches, preserving comments and formatting.
 *
 * @param doc - The user's config document.
 * @param patches - One complete settings object per plugin.
 * @returns The edited document, or null when an edit had to be refused.
 *
 * @example
 * applyPluginSettingsPatches(json5Document('{config: {plugins: {}}}'), [
 *   {pluginId: pluginId('demo'), settings: {enabled: true}}
 * ]);
 */
export const applyPluginSettingsPatches = (
  doc: Json5Document,
  patches: readonly PluginPersistencePatch[]
): Json5Document | null => {
  let nextDoc = doc;
  for (const patch of patches) {
    const path = [propertyKey('config'), propertyKey('plugins'), propertyKey(patch.pluginId.value)];
    const result = setPropertyAtPath(nextDoc, path, patch.settings);
    if (result.kind === 'refused') {
      return null;
    }
    nextDoc = result.doc;
  }
  return nextDoc;
};

/**
 * Parses and validates a config document, returning null on any failure.
 *
 * @param doc - The document text.
 * @returns The validated config, or null.
 *
 * @example
 * parseConfigJson5Strict(json5Document('{config: {}}')); // {config: {}, ...}
 */
export const parseConfigJson5Strict = (doc: Json5Document): rawConfig | null => {
  try {
    // SAFETY: JSON5.parse can only produce JSON5 primitives, arrays, and objects.
    const parsed = JSON5.parse(doc) as JsonValue;
    const validated = safeParseRawConfig(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
};
