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
import {isObject} from '../utils/runtime-guards';

const objectKeys = <T extends object>(value: T): Array<keyof T> => {
  // SAFETY: The typed inputs to these merge and comparison helpers own the
  // enumerable keys returned here; callers pass config objects, not proxies.
  return Object.keys(value) as Array<keyof T>;
};

/**
 * Narrows a key to one the owner actually carries.
 *
 * The two sides of a comparison are frequently different types, so a key that
 * is valid for one object need not exist on the other. Stating the check as a
 * predicate lets the read below stay an ordinary property access while still
 * reporting an absent key as `undefined` rather than inventing a value.
 */
const isOwnKey = <TObject extends object>(owner: TObject, key: PropertyKey): key is keyof TObject =>
  Object.hasOwn(owner, key);

/** Configuration layer types in order of precedence (lowest to highest). */
export type ConfigLayerType = 'defaults' | 'user' | 'workspace' | 'runtime';

/**
 * Makes every property of a configuration object optional, at every depth.
 *
 * Arrays are left whole because merging replaces them wholesale rather than
 * element by element, so a partial array would describe a merge that never
 * happens.
 */
type DeepOverrides<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepOverrides<T[K]> : T[K];
};

/**
 * A recursively optional `configOptions`, describing what one layer may supply.
 *
 * A layer is an override, not a configuration: `mergeLayers` deep-merges nested
 * objects, so a user layer that sets a single terminal colour is valid even
 * though `configOptions` declares `colors` as a complete palette.
 */
export type ConfigOverrides = DeepOverrides<configOptions>;

/** A configuration layer with its type and content. */
export type ConfigLayer = {
  /** The type of this configuration layer. */
  readonly type: ConfigLayerType;
  /** The configuration content for this layer. */
  readonly config: ConfigOverrides;
};

/** Deep merge options for customization. */
export type DeepMergeOptions = {
  /** Maximum depth to merge (prevents infinite recursion on circular refs). */
  readonly maxDepth?: number;
};

/**
 * Depth at which merging stops recursing.
 *
 * Declared separately from `defaultMergeOptions` so it is read as a literal
 * `number`: the options type makes `maxDepth` optional, so reading the default
 * back out of it would reintroduce `undefined` at every call site.
 */
const DEFAULT_MAX_MERGE_DEPTH = 10;

const defaultMergeOptions: DeepMergeOptions = {
  maxDepth: DEFAULT_MAX_MERGE_DEPTH
};

/**
 * Source keys whose value is not statically `undefined`.
 *
 * `deepMerge` skips `undefined` source values, so a key that can only ever be
 * `undefined` contributes nothing to the result and must not narrow it.
 */
type DefinedSourceKeys<S> = {[K in keyof S]-?: S[K] extends undefined ? never : K}[keyof S];

/** The shape produced by merging `S` over `T`. */
type MergeResult<T, S> = T & Pick<S, DefinedSourceKeys<S>>;

/**
 * Reports whether two values are objects that merge key by key.
 *
 * Arrays are excluded even though they are objects: merging them element by
 * element would splice positions together, where a layer that supplies an
 * array means to replace it whole.
 */
const isMergeableRecord = (value: unknown): value is object => isObject(value) && !Array.isArray(value);

/**
 * Deep merges two objects, with the source taking precedence over the target.
 *
 * - Nested objects are recursively merged
 * - Arrays are replaced entirely (not merged)
 * - Primitive values are replaced
 * - undefined in source does not overwrite target (allows defaults to persist)
 * - null in source overwrites target (explicit null is a deliberate reset)
 *
 * The source is not a `Partial<T>`. `Partial` only makes the top level
 * optional, so it would reject a nested object that adds keys the target does
 * not have — precisely the case the merge exists to handle. The result is
 * therefore the target's shape plus every source key that can carry a value.
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
export const deepMerge = <T extends object, S extends object>(
  target: T,
  source: S,
  options: DeepMergeOptions = defaultMergeOptions,
  currentDepth = 0
): MergeResult<T, S> => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_MERGE_DEPTH;

  if (currentDepth >= maxDepth) {
    return Object.assign({...target}, source);
  }

  const result: T = {...target};

  for (const key of objectKeys(source)) {
    const sourceValue = source[key];
    // Skip undefined values to allow defaults to persist
    if (sourceValue === undefined) {
      continue;
    }

    // `key` belongs to `S`, so it need not exist on `T`. The ownership check
    // says that plainly instead of pretending the two key sets match.
    const targetValue: unknown = isOwnKey(target, key) ? target[key] : undefined;

    const mergedValue =
      isMergeableRecord(sourceValue) && isMergeableRecord(targetValue)
        ? deepMerge(targetValue, sourceValue, options, currentDepth + 1)
        : sourceValue;
    Object.assign(result, {[key]: mergedValue});
  }

  // SAFETY: `result` starts as a copy of `target` and receives every defined
  // key of `source`; the skipped keys are exactly the ones `MergeResult` omits.
  return result as MergeResult<T, S>;
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
export const mergeLayers = (layers: ConfigLayer[]): ConfigOverrides => {
  // Start with an empty override and merge each layer in sequence. Each layer is
  // already a `ConfigOverrides`, so the accumulation keeps that type.
  let result: ConfigOverrides = {};

  for (const layer of layers) {
    result = deepMerge(result, layer.config);
  }

  const required: (keyof configOptions)[] = ['defaultProfile', 'profiles'];
  for (const key of required) {
    if (!(key in result)) {
      throw new Error(`Missing required config field: ${String(key)}`);
    }
  }

  return result;
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
  userConfig: ConfigOverrides,
  runtimeOverrides: ConfigOverrides = {}
): configOptions => {
  const layers: ConfigLayer[] = [
    {type: 'defaults', config: defaults},
    {type: 'user', config: userConfig},
    {type: 'runtime', config: runtimeOverrides}
  ];

  const merged = mergeLayers(layers);
  // SAFETY: `defaults` supplies every required config field; deepMerge skips
  // undefined overrides, so each required field remains present.
  return merged as configOptions;
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
export const extractConfigOptions = (raw: rawConfig): ConfigOverrides | null => {
  return raw.config ?? null;
};

/**
 * The layer names `mergeLayers` recognises, in precedence order.
 *
 * Typed over `unknown` because its one caller asks whether an arbitrary input
 * is a member; that question is a set lookup, not a narrowing of the input.
 */
const CONFIG_LAYER_TYPES: ReadonlySet<unknown> = new Set<ConfigLayerType>(['defaults', 'user', 'workspace', 'runtime']);

/** Narrows a value to a configuration layer type name. */
const isConfigLayerType = (value: unknown): value is ConfigLayerType => CONFIG_LAYER_TYPES.has(value);

/** Narrows a value to a record carrying the two fields a layer must have. */
const hasLayerFields = (value: unknown): value is {type: unknown; config: unknown} =>
  isMergeableRecord(value) && 'type' in value && 'config' in value;

export const isConfigLayer = (value: unknown): value is ConfigLayer =>
  hasLayerFields(value) && isConfigLayerType(value.type) && isMergeableRecord(value.config);

/**
 * Creates a runtime override layer for ephemeral configuration changes.
 *
 * Runtime overrides are in-memory only and are not persisted to disk.
 * They take precedence over user config but are lost on application restart.
 *
 * @param overrides - The configuration overrides to apply.
 * @returns A runtime configuration layer.
 */
export const createRuntimeOverrideLayer = (overrides: ConfigOverrides): ConfigLayer => ({
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
  if (left === right) return true;
  // Past this point the two differ, so a missing side cannot be equal to a
  // present one and the comparison can stop before recursing.
  if (left == null || right == null) return false;
  if (isArray(left) && isArray(right)) return arraysEqual(left, right);
  if (isMergeableRecord(left) && isMergeableRecord(right)) return recordsEqual(left, right);
  return false;
};

/**
 * Compares two arrays for deep equality, element by element.
 */
function arraysEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, i) => deepEqual(item, right[i]));
}

/**
 * Compares two plain record objects for deep equality.
 */
function recordsEqual<T extends object>(left: T, right: T): boolean {
  const leftKeys = objectKeys(left);
  if (leftKeys.length !== objectKeys(right).length) {
    return false;
  }
  return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

/** A key that appears in either of two compared objects. */
type SharedKey<TLeft extends object, TRight extends object> = keyof TLeft | keyof TRight;

/**
 * Checks if a configuration value differs between two config objects.
 *
 * Performs deep comparison for objects and arrays, strict equality for primitives.
 *
 * The two sides are inferred separately. They are frequently different types —
 * a default configuration against a partial user override is the whole point of
 * the layering — and inferring one type for both would narrow `key` to the keys
 * they happen to share.
 *
 * @param left - The first configuration object.
 * @param right - The second configuration object.
 * @param key - The key to compare, present on either side.
 * @returns True if the values differ.
 */
export const configValueDiffers = <TLeft extends object, TRight extends object>(
  left: TLeft,
  right: TRight,
  key: SharedKey<TLeft, TRight>
): boolean => {
  // A key may exist on only one side; the ownership check reports the missing
  // side as `undefined` without claiming both objects have the key.
  const leftValue: unknown = isOwnKey(left, key) ? left[key] : undefined;
  const rightValue: unknown = isOwnKey(right, key) ? right[key] : undefined;

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
 * @returns Array of keys that have different values, including keys present on
 * only one side.
 */
export const getChangedKeys = <TLeft extends object, TRight extends object>(
  oldConfig: TLeft,
  newConfig: TRight
): Array<SharedKey<TLeft, TRight>> => {
  const allKeys = new Set<SharedKey<TLeft, TRight>>([...objectKeys(oldConfig), ...objectKeys(newConfig)]);
  const changed: Array<SharedKey<TLeft, TRight>> = [];

  for (const key of allKeys) {
    if (configValueDiffers(oldConfig, newConfig, key)) {
      changed.push(key);
    }
  }

  return changed;
};
