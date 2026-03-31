/** @file Configuration layering utilities implementing defaults → user → runtime merge.
 *
 * Implements the layering rules specified in the design document:
 * 1. Built-in defaults (bundled with the app)
 * 2. User config (config.json5)
 * 3. Runtime overrides (ephemeral, in-memory only)
 *
 * Merge semantics:
 * - Objects: deep merge (nested properties are recursively merged)
 * - Arrays: replace (user array completely replaces default array)
 */

import type {configOptions, rawConfig} from '@shared/types/config';
import {isRecord} from './json5-config';

/** Configuration layer types in order of precedence (lowest to highest). */
export type ConfigLayerType = 'defaults' | 'user' | 'workspace' | 'runtime';

/** A configuration layer with its type and content. */
export type ConfigLayer = {
  /** The type of this configuration layer. */
  readonly type: ConfigLayerType;
  /** The configuration content for this layer. */
  readonly config: Partial<configOptions>;
};

/** Deep merge options for customization. */
export type DeepMergeOptions = {
  /** Maximum depth to merge (prevents infinite recursion on circular refs). */
  readonly maxDepth?: number;
};

const defaultMergeOptions: DeepMergeOptions = {
  maxDepth: 10
};

/**
 * Deep merges two objects, with the source taking precedence over the target.
 *
 * - Nested objects are recursively merged
 * - Arrays are replaced entirely (not merged)
 * - Primitive values are replaced
 * - undefined in source does not overwrite target (allows defaults to persist)
 * - null in source overwrites target (explicit null is a deliberate reset)
 *
 * @param target - The base object (lower precedence).
 * @param source - The override object (higher precedence).
 * @param options - Merge options.
 * @param currentDepth - Current recursion depth (internal use).
 * @returns A new object containing the merged result.
 *
 * @example
 * ```ts
 * deepMerge({a: 1, b: {c: 2}}, {b: {d: 3}})
 * // {a: 1, b: {c: 2, d: 3}}
 * ```
 */
export const deepMerge = <T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
  options: DeepMergeOptions = defaultMergeOptions,
  currentDepth = 0
): T => {
  const maxDepth = (options.maxDepth ?? defaultMergeOptions.maxDepth) as number;

  if (currentDepth >= maxDepth) {
    return {...target, ...source} as T;
  }

  const result = {...target} as Record<string, unknown>;

  for (const [key, sourceValue] of Object.entries(source)) {
    // Skip undefined values to allow defaults to persist
    if (sourceValue === undefined) {
      continue;
    }

    const targetValue = result[key];

    // Deep merge objects (but not arrays)
    if (isRecord(sourceValue) && isRecord(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue, options, currentDepth + 1);
    } else {
      // For arrays and primitives, source replaces target
      result[key] = sourceValue;
    }
  }

  return result as T;
};

/**
 * Merges multiple configuration layers into a single resolved configuration.
 *
 * Layers are applied in order, with later layers taking precedence over earlier ones.
 * This implements the layering rules: defaults → user → runtime overrides.
 *
 * @param layers - Array of configuration layers to merge.
 * @returns The merged configuration object.
 *
 * @example
 * ```ts
 * mergeLayers([
 *   {type: 'defaults', config: {fontSize: 12, colors: {red: '#ff0000'}}},
 *   {type: 'user', config: {fontSize: 14}},
 *   {type: 'runtime', config: {colors: {blue: '#0000ff'}}}
 * ])
 * // {fontSize: 14, colors: {red: '#ff0000', blue: '#0000ff'}}
 * ```
 */
export const mergeLayers = (layers: ConfigLayer[]): configOptions => {
  // Start with empty object and merge each layer in sequence
  let result = {} as Record<string, unknown>;

  for (const layer of layers) {
    result = deepMerge(result, layer.config);
  }

  return result as configOptions;
};

/**
 * Resolves the effective configuration from defaults, user config, and runtime overrides.
 *
 * This is the primary API for config resolution, applying the standard layering order:
 * 1. Built-in defaults
 * 2. User config (from config.json5)
 * 3. Runtime overrides (ephemeral, in-memory only)
 *
 * Workspace layer is currently deferred and not implemented.
 *
 * @param defaults - The built-in default configuration.
 * @param userConfig - The user's configuration from config.json5.
 * @param runtimeOverrides - Optional ephemeral runtime overrides.
 * @returns The resolved effective configuration.
 */
export const resolveConfigLayers = (
  defaults: configOptions,
  userConfig: Partial<configOptions>,
  runtimeOverrides: Partial<configOptions> = {}
): configOptions => {
  const layers: ConfigLayer[] = [
    {type: 'defaults', config: defaults},
    {type: 'user', config: userConfig},
    {type: 'runtime', config: runtimeOverrides}
  ];

  return mergeLayers(layers);
};

/**
 * Extracts the configOptions subset from a rawConfig payload.
 *
 * Handles the case where rawConfig contains additional properties
 * like plugins, localPlugins, and keymaps.
 *
 * @param raw - The raw configuration payload.
 * @returns The configOptions portion, or null if none.
 */
export const extractConfigOptions = (raw: rawConfig): Partial<configOptions> | null => {
  return raw.config ?? null;
};

/**
 * Type guard to check if a value is a valid ConfigLayer.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid ConfigLayer.
 */
export const isConfigLayer = (value: unknown): value is ConfigLayer => {
  if (!isRecord(value)) {
    return false;
  }

  const validTypes: ConfigLayerType[] = ['defaults', 'user', 'workspace', 'runtime'];
  const type = value.type;
  const config = value.config;

  return typeof type === 'string' && validTypes.includes(type as ConfigLayerType) && isRecord(config);
};

/**
 * Creates a runtime override layer for ephemeral configuration changes.
 *
 * Runtime overrides are in-memory only and are not persisted to disk.
 * They take precedence over user config but are lost on application restart.
 *
 * @param overrides - The configuration overrides to apply.
 * @returns A runtime configuration layer.
 */
export const createRuntimeOverrideLayer = (overrides: Partial<configOptions>): ConfigLayer => ({
  type: 'runtime',
  config: {...overrides}
});

/**
 * Checks if a value is an array.
 *
 * @param value - The value to check.
 * @returns True if the value is an array.
 */
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * Deeply compares two values for equality.
 *
 * - Objects: recursively compare all properties
 * - Arrays: compare elements by value (not by reference)
 * - Primitives: use strict equality
 *
 * @param left - The first value.
 * @param right - The second value.
 * @returns True if the values are deeply equal.
 */
const deepEqual = (left: unknown, right: unknown): boolean => {
  // Handle reference equality and primitives
  if (left === right) {
    return true;
  }

  // Handle null/undefined
  if (left === null || right === null) {
    return left === right;
  }
  if (left === undefined || right === undefined) {
    return left === right;
  }

  // Handle arrays - compare by value, not reference
  if (isArray(left) && isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) {
        return false;
      }
    }
    return true;
  }

  // Handle plain objects
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key) || !deepEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  // Different types or non-equal primitives
  return false;
};

/**
 * Checks if a configuration value differs between two config objects.
 *
 * Performs deep comparison for objects and arrays, strict equality for primitives.
 *
 * @param left - The first configuration object.
 * @param right - The second configuration object.
 * @param key - The key to compare.
 * @returns True if the values differ.
 */
export const configValueDiffers = <T extends Record<string, unknown>>(left: T, right: T, key: keyof T): boolean => {
  const leftValue = left[key];
  const rightValue = right[key];

  // Handle undefined vs null vs value
  if (leftValue === undefined && rightValue === undefined) {
    return false;
  }
  if (leftValue === undefined || rightValue === undefined) {
    return true;
  }

  return !deepEqual(leftValue, rightValue);
};

/**
 * Gets the list of changed keys between two configuration objects.
 *
 * @param oldConfig - The previous configuration state.
 * @param newConfig - The new configuration state.
 * @returns Array of keys that have different values.
 */
export const getChangedKeys = <T extends Record<string, unknown>>(oldConfig: T, newConfig: T): Array<keyof T> => {
  const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);
  const changed: Array<keyof T> = [];

  for (const key of allKeys) {
    if (configValueDiffers(oldConfig, newConfig, key)) {
      changed.push(key);
    }
  }

  return changed;
};
