/** @file React hook for checking configuration reloadability in settings UI.
 *
 * Provides utilities for determining if config changes require restart
 * and tracking pending restart-required changes.
 */
import {
  keyRequiresRestart,
  keyIsLiveReloadable,
  getKeyReloadClassification,
  getReloadability,
  getKeyScope,
  type Reloadability
} from '@shared/constants/config-reloadability';

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
  /** Function to filter keys by classification (includes unknown keys when classification is 'restart'). */
  filterKeysByClassification: (keys: string[], classification: Reloadability) => string[];
  /** Function to partition keys by reloadability (unknown keys default to restart). */
  partitionKeys: (keys: string[]) => {live: string[]; restart: string[]};
};

/**
 * Gets the full reloadability entry for a config key.
 *
 * @param key - The configuration key.
 * @returns The reloadability entry with classification and rationale, or undefined.
 */
export const getReloadabilityEntry = (key: string): {classification: Reloadability; rationale: string} | undefined => {
  const scope = getKeyScope(key);
  const entry = getReloadability(key, scope);
  return entry ? {classification: entry.classification, rationale: entry.rationale} : undefined;
};

/**
 * Filters keys by their reloadability classification.
 *
 * Note: When filtering for 'restart', unknown keys are included (safety default).
 * When filtering for 'live', only known live-reloadable keys are returned.
 *
 * @param keys - Array of configuration keys to filter.
 * @param classification - The classification to filter by ('live' or 'restart').
 * @returns Array of keys matching the classification.
 */
export const filterKeysByClassification = (keys: string[], classification: Reloadability): string[] => {
  return keys.filter((key) => {
    const keyClassification = getKeyReloadClassification(key);
    if (classification === 'restart') {
      // Include both explicitly restart-classified keys AND unknown keys (safety default)
      return keyClassification === 'restart' || keyClassification === undefined;
    }
    return keyClassification === classification;
  });
};

/**
 * Partitions keys into live-reloadable and restart-required categories.
 *
 * Unknown keys default to restart-required for safety.
 *
 * @param keys - Array of configuration keys to partition.
 * @returns Object with live and restart arrays.
 */
export const partitionKeys = (keys: string[]): {live: string[]; restart: string[]} => {
  const live: string[] = [];
  const restart: string[] = [];

  for (const key of keys) {
    const classification = getKeyReloadClassification(key);
    if (classification === 'live') {
      live.push(key);
    } else {
      // Unknown keys (undefined) default to restart for safety
      restart.push(key);
    }
  }

  return {live, restart};
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

  // Simple derived values - no memoization needed for cheap pure functions
  const requiresRestart = !!(configKey && keyRequiresRestart(configKey));
  const isLiveReloadable = !!(configKey && keyIsLiveReloadable(configKey));
  const classification = configKey ? getKeyReloadClassification(configKey) : undefined;

  return {
    requiresRestart,
    isLiveReloadable,
    classification,
    // Direct function references - no useCallback needed
    checkRequiresRestart: keyRequiresRestart,
    checkIsLiveReloadable: keyIsLiveReloadable,
    getClassification: getKeyReloadClassification,
    getReloadabilityEntry,
    filterKeysByClassification,
    partitionKeys
  };
};
