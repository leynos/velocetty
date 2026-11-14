/** @file The process-wide configuration the last import applied. */
/*
 * This module is the single owner of the applied configuration. Queries and
 * the reload watcher both read it directly rather than through the composition
 * root, so neither has to be wired back to the module that built them. The
 * start-up command and the reload path both write it, each only once an import
 * has produced a whole config.
 */
import type {parsedConfig} from '@shared/types/config';

let currentConfig: parsedConfig | undefined;

/**
 * Returns the configuration the last import applied.
 *
 * Throws rather than returning `undefined`, so a caller that runs before
 * `setup()` fails loudly instead of reading a half-built configuration.
 *
 * @example
 * ```ts
 * setup();
 * getCurrentConfig().keymaps; // the keymaps now in effect
 * ```
 */
export const getCurrentConfig = (): parsedConfig => {
  if (currentConfig === undefined) {
    throw new Error('Configuration has not been initialized');
  }

  return currentConfig;
};

/**
 * Reports whether an import has stored a configuration yet.
 *
 * Callers that must stay quiet before start-up, such as the deprecated-CSS
 * warning, use this instead of catching the deliberate throw above.
 *
 * @example
 * ```ts
 * hasCurrentConfig(); // false until setup() has imported the configuration
 * ```
 */
export const hasCurrentConfig = (): boolean => currentConfig !== undefined;

/**
 * Stores the configuration an import just applied.
 *
 * @param config - The whole configuration produced by an import.
 *
 * @example
 * ```ts
 * setCurrentConfig(imported); // a later getCurrentConfig() returns it
 * ```
 */
export const setCurrentConfig = (config: parsedConfig): void => {
  currentConfig = config;
};
