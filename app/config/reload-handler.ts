/** @file Hot-reload detection and warning system for configuration changes.
 *
 * Handles CONFIG_RELOAD actions by comparing new config against current effective
 * config, classifying changes as live-reloadable or restart-required, and routing
 * them appropriately.
 *
 * - Live-reloadable changes: applied immediately
 * - Restart-required changes: queued with structured diagnostics for UI warning
 */

import type {configOptions, ConfigReloadDiagnostic, ConfigReloadResult} from '@shared/types/config';
import type {Reloadability} from '@shared/constants/config-reloadability';
import {getKeyScope, getReloadability} from '@shared/constants/config-reloadability';
import {getChangedKeys, deepMerge} from './layering';

/** Dependencies required by the reload handler. */
export type ReloadHandlerDependencies = {
  /** Function to get the current effective configuration. */
  readonly getCurrentConfig: () => configOptions;
  /** Function to apply live configuration changes. */
  readonly applyLiveConfig: (config: Partial<configOptions>) => void;
  /** Function to emit restart-required warnings to the UI. */
  readonly emitRestartWarning: (diagnostics: ConfigReloadDiagnostic[]) => void;
  /** Optional logger for diagnostic output. */
  readonly warn?: typeof console.warn;
};

/** Internal state tracking for the reload handler. */
export type ReloadHandlerState = {
  /** The last configuration that was successfully applied. */
  lastAppliedConfig: configOptions;
  /** Queue of pending restart-required changes. */
  pendingRestartChanges: ConfigReloadDiagnostic[];
  /** Whether there are unapplied changes requiring restart. */
  hasPendingRestartChanges: boolean;
};

/** Options for the reload detection process. */
export type ReloadDetectionOptions = {
  /** If true, automatically apply live-reloadable changes. */
  readonly autoApplyLive: boolean;
  /** If true, emit warnings for restart-required changes. */
  readonly emitWarnings: boolean;
};

const defaultDetectionOptions: ReloadDetectionOptions = {
  autoApplyLive: true,
  emitWarnings: true
};

/**
 * Truncates a value for safe display in diagnostic messages.
 * Prevents leaking secrets or flooding logs with large objects.
 *
 * @param value - The value to truncate.
 * @param maxLength - Maximum length before truncation (default: 50).
 * @returns Truncated string representation.
 */
const truncateValue = (value: unknown, maxLength = 50): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }
  try {
    const str = JSON.stringify(value);
    return str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
  } catch {
    return '[unserializable]';
  }
};

/**
 * Checks if a config key requires restart when changed.
 *
 * @param key - The configuration key to check.
 * @param scope - The scope of the config key.
 * @returns True if the setting requires restart, false if live-reloadable.
 */
const requiresRestart = (key: string, scope: 'root' | 'profile' | 'keymap' | 'plugin'): boolean => {
  const entry = getReloadability(key, scope);
  return entry?.classification === 'restart' || entry === undefined;
};

/**
 * Checks if a config key can be live-reloaded.
 *
 * @param key - The configuration key to check.
 * @param scope - The scope of the config key.
 * @returns True if the setting is live-reloadable, false if restart is required.
 */
const isLiveReloadable = (key: string, scope: 'root' | 'profile' | 'keymap' | 'plugin'): boolean => {
  const entry = getReloadability(key, scope);
  return entry?.classification === 'live';
};

/**
 * Classifies a configuration change as live-reloadable or restart-required.
 *
 * @param key - The configuration key that changed.
 * @param oldValue - The previous value.
 * @param newValue - The new value.
 * @returns A reload diagnostic with classification.
 */
export const classifyConfigChange = (key: string, oldValue: unknown, newValue: unknown): ConfigReloadDiagnostic => {
  const scope = getKeyScope(key);
  const entry = getReloadability(key, scope);

  if (!entry) {
    // Unknown key - default to restart-required for safety
    return {
      path: key,
      message: `Unknown configuration key "${key}" changed. Change will require restart to ensure safe application.`,
      classification: 'restart',
      rationale: 'Unknown keys default to restart-required for safety.'
    };
  }

  const classification = entry.classification;
  const changeDescription = `${key}: ${truncateValue(oldValue)} → ${truncateValue(newValue)}`;

  if (classification === 'live') {
    return {
      path: key,
      message: `Configuration change applied live: ${changeDescription}`,
      classification: 'live',
      rationale: entry.rationale
    };
  } else {
    return {
      path: key,
      message: `Configuration change requires restart: ${changeDescription}. ${entry.rationale}`,
      classification: 'restart',
      rationale: entry.rationale
    };
  }
};

/**
 * Detects changes between old and new configuration objects.
 *
 * @param oldConfig - The previous configuration state.
 * @param newConfig - The new configuration state.
 * @returns Array of reload diagnostics for all changed keys.
 */
export const detectConfigChanges = (oldConfig: configOptions, newConfig: configOptions): ConfigReloadDiagnostic[] => {
  const changedKeys = getChangedKeys(oldConfig as Record<string, unknown>, newConfig as Record<string, unknown>);

  return changedKeys.map((key) =>
    classifyConfigChange(key, (oldConfig as Record<string, unknown>)[key], (newConfig as Record<string, unknown>)[key])
  );
};

/**
 * Partitions changes into live-reloadable and restart-required categories.
 *
 * @param diagnostics - Array of reload diagnostics.
 * @returns Partitioned changes.
 */
export const partitionChanges = (diagnostics: ConfigReloadDiagnostic[]) => {
  const liveChanges: ConfigReloadDiagnostic[] = [];
  const restartChanges: ConfigReloadDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.classification === 'live') {
      liveChanges.push(diagnostic);
    } else {
      restartChanges.push(diagnostic);
    }
  }

  return {liveChanges, restartChanges};
};

/**
 * Extracts the live-reloadable subset of configuration changes.
 *
 * The _oldConfig parameter is intentionally unused/reserved for future API symmetry.
 *
 * @param _oldConfig - The previous configuration (unused).
 * @param newConfig - The new configuration.
 * @param liveDiagnostics - Diagnostics for live-reloadable changes.
 * @returns Partial config with only live-reloadable changes.
 */
export const extractLiveConfigChanges = (
  _oldConfig: configOptions,
  newConfig: configOptions,
  liveDiagnostics: ConfigReloadDiagnostic[]
): Partial<configOptions> => {
  const result: Record<string, unknown> = {};

  // Iterate live diagnostics and extract values from newConfig
  // Including undefined values to properly handle key removals
  for (const {path: key} of liveDiagnostics) {
    result[key] = (newConfig as Record<string, unknown>)[key];
  }

  return result as Partial<configOptions>;
};

/**
 * Creates a reload handler with the given dependencies.
 *
 * @param dependencies - The dependencies required by the handler.
 * @returns Reload handler functions and state accessors.
 */
export const createReloadHandler = (dependencies: ReloadHandlerDependencies) => {
  const {getCurrentConfig, applyLiveConfig, emitRestartWarning, warn = console.warn} = dependencies;

  // Initialize state with current config
  let state: ReloadHandlerState = {
    lastAppliedConfig: getCurrentConfig(),
    pendingRestartChanges: [],
    hasPendingRestartChanges: false
  };

  const applyLiveChangesIfEnabled = (
    currentConfig: configOptions,
    newConfig: configOptions,
    liveChanges: ConfigReloadDiagnostic[],
    autoApplyLive: boolean
  ): void => {
    if (!autoApplyLive || liveChanges.length === 0) return;
    const liveConfig = extractLiveConfigChanges(currentConfig, newConfig, liveChanges);
    applyLiveConfig(liveConfig);
    warn('[reload-handler] Applied live-reloadable config changes:', {
      keys: liveChanges.map((d) => d.path)
    });
    state = {
      ...state,
      lastAppliedConfig: deepMerge(currentConfig, liveConfig)
    };
  };

  const updatePendingRestartState = (restartChanges: ConfigReloadDiagnostic[], emitWarnings: boolean): void => {
    const pendingMap = new Map<string, ConfigReloadDiagnostic>();
    for (const change of restartChanges) {
      pendingMap.set(change.path, change);
    }
    state = {
      ...state,
      pendingRestartChanges: Array.from(pendingMap.values()),
      hasPendingRestartChanges: pendingMap.size > 0
    };
    if (emitWarnings && restartChanges.length > 0) {
      emitRestartWarning(restartChanges);
      warn('[reload-handler] Queued restart-required config changes:', {
        keys: restartChanges.map((d) => d.path),
        pendingCount: pendingMap.size
      });
    }
  };

  /**
   * Processes a configuration reload, classifying and routing changes.
   *
   * @param newConfig - The new configuration to apply.
   * @param options - Options for the reload detection.
   * @returns The reload result with applied and pending changes.
   */
  const processReload = (
    newConfig: configOptions,
    options: Partial<ReloadDetectionOptions> = {}
  ): ConfigReloadResult => {
    const opts = {...defaultDetectionOptions, ...options};
    const currentConfig = state.lastAppliedConfig;

    const allChanges = detectConfigChanges(currentConfig, newConfig);
    const {liveChanges, restartChanges} = partitionChanges(allChanges);

    applyLiveChangesIfEnabled(currentConfig, newConfig, liveChanges, opts.autoApplyLive);
    updatePendingRestartState(restartChanges, opts.emitWarnings);

    return {
      success: true,
      config: newConfig,
      appliedLive: opts.autoApplyLive ? liveChanges.map((d) => d.path) : [],
      restartRequired: restartChanges,
      validationErrors: []
    };
  };

  /**
   * Clears all pending restart-required changes.
   *
   * Called after application restart when all pending changes have been applied.
   */
  const clearPendingChanges = () => {
    state = {
      ...state,
      pendingRestartChanges: [],
      hasPendingRestartChanges: false
    };
  };

  /**
   * Gets the current handler state.
   *
   * @returns The current reload handler state.
   */
  const getState = (): Readonly<ReloadHandlerState> => ({
    ...state,
    pendingRestartChanges: [...state.pendingRestartChanges]
  });

  /**
   * Checks if there are pending restart-required changes.
   *
   * @returns True if restart is required to apply pending changes.
   */
  const isRestartRequired = (): boolean => state.hasPendingRestartChanges;

  /**
   * Gets the list of pending restart-required diagnostics.
   *
   * @returns Array of pending restart-required diagnostics.
   */
  const getPendingRestartDiagnostics = (): ConfigReloadDiagnostic[] => [...state.pendingRestartChanges];

  return {
    processReload,
    clearPendingChanges,
    getState,
    isRestartRequired,
    getPendingRestartDiagnostics
  };
};

/**
 * Creates a formatted restart warning message from diagnostics.
 *
 * @param diagnostics - Array of restart-required diagnostics.
 * @returns Formatted warning message for display.
 */
export const formatRestartWarning = (diagnostics: ConfigReloadDiagnostic[]): string => {
  if (diagnostics.length === 0) {
    return '';
  }

  const header = 'Configuration changes require restart:';
  const items = diagnostics.map((d) => `  • ${d.path}: ${d.rationale}`);

  return [header, ...items, '', 'Please restart the application to apply these changes.'].join('\n');
};

/**
 * Checks if a specific config key change would require restart.
 *
 * @param key - The configuration key to check.
 * @returns True if changing this key would require restart.
 */
export const keyRequiresRestart = (key: string): boolean => {
  const scope = getKeyScope(key);
  return requiresRestart(key, scope);
};

/**
 * Checks if a specific config key can be live-reloaded.
 *
 * @param key - The configuration key to check.
 * @returns True if changing this key can be applied live.
 */
export const keyIsLiveReloadable = (key: string): boolean => {
  const scope = getKeyScope(key);
  return isLiveReloadable(key, scope);
};

/**
 * Gets the reload classification for a config key.
 *
 * @param key - The configuration key.
 * @returns The classification or undefined if unknown.
 */
export const getKeyReloadClassification = (key: string): Reloadability | undefined => {
  const scope = getKeyScope(key);
  const entry = getReloadability(key, scope);
  return entry?.classification;
};
