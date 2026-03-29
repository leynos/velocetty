/** @file React hook for checking configuration reloadability in settings UI.
 *
 * Provides utilities for determining if config changes require restart
 * and tracking pending restart-required changes.
 */
import {useCallback, useMemo} from 'react';

import {
  keyRequiresRestart,
  keyIsLiveReloadable,
  getKeyReloadClassification,
  getReloadability,
  type Reloadability
} from '../../shared/src/constants/config-reloadability';

/** Options for useConfigReloadability hook. */
export type UseConfigReloadabilityOptions = {
  /** The configuration key to check (optional - if not provided, returns general utilities). */
  configKey?: string;
};

/** Return type for useConfigReloadability hook. */
export type UseConfigReloadabilityReturn = {
  /** Whether the specified config key requires restart (false if no key specified). */
  requiresRestart: boolean;
  /** Whether the specified config key is live-reloadable (false if no key specified). */
  isLiveReloadable: boolean;
  /** The reload classification for the specified key (undefined if no key specified). */
  classification: Reloadability | undefined;
  /** Function to check if any key requires restart. */
  checkRequiresRestart: (key: string) => boolean;
  /** Function to check if any key is live-reloadable. */
  checkIsLiveReloadable: (key: string) => boolean;
  /** Function to get classification for any key. */
  getClassification: (key: string) => Reloadability | undefined;
  /** Function to get full reloadability entry with rationale. */
  getReloadabilityEntry: (key: string) => {classification: Reloadability; rationale: string} | undefined;
  /** Function to filter keys by classification. */
  filterKeysByClassification: (keys: string[], classification: Reloadability) => string[];
  /** Function to partition keys by reloadability. */
  partitionKeys: (keys: string[]) => {live: string[]; restart: string[]};
};

/**
 * React hook for working with configuration reloadability.
 *
 * @example
 * ```tsx
 * function FontSizeSetting() {
 *   const { requiresRestart, isLiveReloadable } = useConfigReloadability({ configKey: 'fontSize' });
 *
 *   return (
 *     <div>
 *       <label>
 *         Font Size
 *         {requiresRestart && <span title="Requires restart">⟳</span>}
 *         {isLiveReloadable && <span title="Live reloadable">⚡</span>}
 *       </label>
 *       <input type="number" />
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * function SettingsForm() {
 *   const { partitionKeys } = useConfigReloadability();
 *   const allKeys = ['fontSize', 'shell', 'backgroundColor', 'updateChannel'];
 *   const { live, restart } = partitionKeys(allKeys);
 *
 *   return (
 *     <form>
 *       <section>
 *         <h3>Live Settings ({live.length})</h3>
 *         {live.map(key => <Setting key={key} configKey={key} />)}
 *       </section>
 *       <section>
 *         <h3>Restart Required ({restart.length})</h3>
 *         {restart.map(key => <Setting key={key} configKey={key} />)}
 *       </section>
 *     </form>
 *   );
 * }
 * ```
 */
export const useConfigReloadability = (options: UseConfigReloadabilityOptions = {}): UseConfigReloadabilityReturn => {
  const {configKey} = options;

  // Memoized values for the specified key
  const requiresRestartValue = useMemo(() => {
    return configKey ? keyRequiresRestart(configKey) : false;
  }, [configKey]);

  const isLiveReloadableValue = useMemo(() => {
    return configKey ? keyIsLiveReloadable(configKey) : false;
  }, [configKey]);

  const classificationValue = useMemo(() => {
    return configKey ? getKeyReloadClassification(configKey) : undefined;
  }, [configKey]);

  // Utility functions that work with any key
  const checkRequiresRestart = useCallback((key: string): boolean => {
    return keyRequiresRestart(key);
  }, []);

  const checkIsLiveReloadable = useCallback((key: string): boolean => {
    return keyIsLiveReloadable(key);
  }, []);

  const getClassification = useCallback((key: string): Reloadability | undefined => {
    return getKeyReloadClassification(key);
  }, []);

  const getReloadabilityEntry = useCallback(
    (key: string): {classification: Reloadability; rationale: string} | undefined => {
      const scope = isRootKey(key) ? 'root' : 'profile';
      const entry = getReloadability(key, scope);
      return entry ? {classification: entry.classification, rationale: entry.rationale} : undefined;
    },
    []
  );

  const filterKeysByClassification = useCallback((keys: string[], classification: Reloadability): string[] => {
    return keys.filter((key) => getKeyReloadClassification(key) === classification);
  }, []);

  const partitionKeys = useCallback((keys: string[]): {live: string[]; restart: string[]} => {
    const live: string[] = [];
    const restart: string[] = [];

    for (const key of keys) {
      const classification = getKeyReloadClassification(key);
      if (classification === 'live') {
        live.push(key);
      } else {
        // Unknown keys default to restart for safety
        restart.push(key);
      }
    }

    return {live, restart};
  }, []);

  return {
    requiresRestart: requiresRestartValue,
    isLiveReloadable: isLiveReloadableValue,
    classification: classificationValue,
    checkRequiresRestart,
    checkIsLiveReloadable,
    getClassification,
    getReloadabilityEntry,
    filterKeysByClassification,
    partitionKeys
  };
};

/** Set of root-level configuration keys. */
const ROOT_KEYS = new Set(['autoUpdatePlugins', 'defaultSSHApp', 'disableAutoUpdates', 'updateChannel', 'useConpty']);

/**
 * Checks if a configuration key is a root-level key.
 *
 * @param key - The configuration key to check.
 * @returns True if the key is a root-level key.
 */
const isRootKey = (key: string): boolean => {
  return ROOT_KEYS.has(key);
};
