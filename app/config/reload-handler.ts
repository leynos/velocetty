/** @file Hot-reload detection and warning system for configuration changes.
 *
 * Handles CONFIG_RELOAD actions by comparing new config against current effective
 * config, classifying changes as live-reloadable or restart-required, and routing
 * them appropriately.
 *
 * - Live-reloadable changes: applied immediately
 * - Restart-required changes: queued with structured diagnostics for UI warning
 */

import type {
  configOptions,
  ConfigReloadDiagnostic,
  ConfigReloadResult,
  configValidationDiagnostic
} from '@shared/types/config';
// Define Reloadability type locally to avoid cross-package import issues
// between build and test environments
type Reloadability = 'live' | 'restart';
import {getChangedKeys, configValueDiffers, type ConfigLayer} from './layering';

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
 * Determines the scope of a configuration key for reloadability lookup.
 *
 * @param key - The configuration key.
 * @returns The scope classification for the key.
 */
const getConfigKeyScope = (key: string): 'root' | 'profile' => {
  // Keys that are in rootConfigOptions
  const rootKeys = new Set(['autoUpdatePlugins', 'defaultSSHApp', 'disableAutoUpdates', 'updateChannel', 'useConpty']);

  return rootKeys.has(key) ? 'root' : 'profile';
};

/** Registry entry with classification and rationale. */
type ReloadabilityEntry = {
  /** The reload capability classification for this setting. */
  readonly classification: Reloadability;
  /** Human-readable explanation of why this classification was chosen. */
  readonly rationale: string;
};

/** Registry mapping config keys to their reloadability classification. */
type ConfigReloadabilityRegistry = {
  readonly [key: string]: ReloadabilityEntry;
};

/**
 * Reloadability registry for root-level config options (non-profile settings).
 * These settings affect application-level behaviour and are generally
 * restart-required when they affect process-level configuration.
 */
const rootConfigReloadability: ConfigReloadabilityRegistry = {
  autoUpdatePlugins: {
    classification: 'restart',
    rationale: 'Affects background plugin update scheduling; requires process-level timer reconfiguration'
  },
  defaultSSHApp: {
    classification: 'restart',
    rationale: 'Affects OS protocol handler registration; requires process-level changes'
  },
  disableAutoUpdates: {
    classification: 'restart',
    rationale: 'Affects update check scheduling; requires process-level timer reconfiguration'
  },
  updateChannel: {
    classification: 'restart',
    rationale: 'Affects update source and potentially binary compatibility; safer to restart'
  },
  useConpty: {
    classification: 'restart',
    rationale: 'Affects PTY backend selection; requires new session creation'
  }
};

/**
 * Reloadability registry for profile-level config options (terminal appearance and behaviour).
 * These settings primarily affect terminal presentation and can generally be
 * hot-reloaded.
 */
const profileConfigReloadability: ConfigReloadabilityRegistry = {
  backgroundColor: {
    classification: 'live',
    rationale: 'Theme/UI appearance setting; can be applied via xterm reconfigure'
  },
  bell: {classification: 'live', rationale: 'Terminal behaviour setting; affects event handling only'},
  bellSound: {classification: 'live', rationale: 'Audio resource reference; can be updated for next bell trigger'},
  bellSoundURL: {classification: 'live', rationale: 'Audio resource path; can be updated for next bell trigger'},
  borderColor: {classification: 'live', rationale: 'Theme/UI appearance setting; CSS colour value'},
  colors: {classification: 'live', rationale: 'Terminal colour palette; can be applied via xterm reconfigure'},
  copyOnSelect: {classification: 'live', rationale: 'Terminal behaviour setting; affects selection event handling'},
  css: {classification: 'live', rationale: 'Custom CSS; can be reinjected into the DOM immediately'},
  cursorAccentColor: {
    classification: 'live',
    rationale: 'Cursor appearance setting; can be applied via xterm reconfigure'
  },
  cursorBlink: {classification: 'live', rationale: 'Cursor behaviour setting; can be applied via xterm reconfigure'},
  cursorColor: {classification: 'live', rationale: 'Cursor appearance setting; can be applied via xterm reconfigure'},
  cursorShape: {classification: 'live', rationale: 'Cursor appearance setting; can be applied via xterm reconfigure'},
  disableLigatures: {classification: 'live', rationale: 'Font rendering setting; can be applied via xterm reconfigure'},
  env: {
    classification: 'restart',
    rationale: 'Environment variables affect child process spawning; requires new sessions'
  },
  fontFamily: {classification: 'live', rationale: 'Font setting; can be applied via xterm reconfigure without restart'},
  fontSize: {classification: 'live', rationale: 'Font setting; can be applied via xterm reconfigure without restart'},
  fontWeight: {classification: 'live', rationale: 'Font setting; can be applied via xterm reconfigure without restart'},
  fontWeightBold: {
    classification: 'live',
    rationale: 'Font setting; can be applied via xterm reconfigure without restart'
  },
  foregroundColor: {
    classification: 'live',
    rationale: 'Theme/UI appearance setting; can be applied via xterm reconfigure'
  },
  imageSupport: {
    classification: 'live',
    rationale: 'Terminal protocol support; can be reconfigured on existing sessions'
  },
  letterSpacing: {classification: 'live', rationale: 'Typography setting; can be applied via xterm reconfigure'},
  lineHeight: {classification: 'live', rationale: 'Typography setting; can be applied via xterm reconfigure'},
  macOptionSelectionMode: {
    classification: 'live',
    rationale: 'Selection behaviour setting; affects event handling only'
  },
  modifierKeys: {classification: 'live', rationale: 'Key handling setting; affects input processing only'},
  padding: {classification: 'live', rationale: 'Layout setting; can be updated via CSS immediately'},
  preserveCWD: {classification: 'live', rationale: 'Session behaviour setting; affects future tab/split creation only'},
  quickEdit: {classification: 'live', rationale: 'Context menu behaviour; can be updated for next interaction'},
  screenReaderMode: {
    classification: 'restart',
    rationale: 'Accessibility mode affects DOM structure; safer to restart for consistent state'
  },
  scrollback: {classification: 'live', rationale: 'Buffer size setting; can be applied via xterm reconfigure'},
  selectionColor: {
    classification: 'live',
    rationale: 'Theme/UI appearance setting; can be applied via xterm reconfigure'
  },
  shell: {
    classification: 'restart',
    rationale: 'Shell executable path affects session spawning; requires new sessions'
  },
  shellArgs: {classification: 'restart', rationale: 'Shell arguments affect session spawning; requires new sessions'},
  showHamburgerMenu: {classification: 'live', rationale: 'UI chrome setting; can be toggled via CSS and menu state'},
  showWindowControls: {
    classification: 'restart',
    rationale: 'Window chrome setting; platform window management requires restart'
  },
  termCSS: {classification: 'live', rationale: 'Terminal CSS; can be reinjected into the terminal DOM immediately'},
  uiFontFamily: {classification: 'live', rationale: 'UI font setting; can be updated via CSS immediately'},
  webGLRenderer: {
    classification: 'restart',
    rationale: 'Deferred to CONFIG-001: requires terminal session restart handling'
  },
  webGLRendererMaxContexts: {
    classification: 'restart',
    rationale: 'Deferred to CONFIG-001: coupled with webGLRenderer setting'
  },
  webLinksActivationKey: {classification: 'live', rationale: 'Link activation modifier; affects event handling only'},
  windowSize: {classification: 'restart', rationale: 'Initial window dimensions; only affects new windows'},
  workingDirectory: {classification: 'live', rationale: 'Startup directory; affects future session creation only'}
};

/**
 * Gets the reloadability classification for a given config key.
 *
 * @param key - The configuration key to look up.
 * @param scope - The scope of the config key ('root' or 'profile').
 * @returns The reloadability entry, or undefined if not found.
 */
const getReloadability = (key: string, scope: 'root' | 'profile'): ReloadabilityEntry | undefined => {
  return scope === 'root' ? rootConfigReloadability[key] : profileConfigReloadability[key];
};

/**
 * Checks if a config key requires restart when changed.
 *
 * @param key - The configuration key to check.
 * @param scope - The scope of the config key ('root' or 'profile').
 * @returns True if the setting requires restart, false if live-reloadable.
 */
const requiresRestart = (key: string, scope: 'root' | 'profile'): boolean => {
  const entry = getReloadability(key, scope);
  return entry?.classification === 'restart' || entry === undefined;
};

/**
 * Checks if a config key can be live-reloaded.
 *
 * @param key - The configuration key to check.
 * @param scope - The scope of the config key ('root' or 'profile').
 * @returns True if the setting is live-reloadable, false if restart is required.
 */
const isLiveReloadable = (key: string, scope: 'root' | 'profile'): boolean => {
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
  const scope = getConfigKeyScope(key);
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
  const changeDescription = `${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`;

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
    classifyConfigChange(
      key as string,
      (oldConfig as Record<string, unknown>)[key],
      (newConfig as Record<string, unknown>)[key]
    )
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
 * @param oldConfig - The previous configuration.
 * @param newConfig - The new configuration.
 * @param liveDiagnostics - Diagnostics for live-reloadable changes.
 * @returns Partial config with only live-reloadable changes.
 */
export const extractLiveConfigChanges = (
  oldConfig: configOptions,
  newConfig: configOptions,
  liveDiagnostics: ConfigReloadDiagnostic[]
): Partial<configOptions> => {
  const liveKeys = new Set(liveDiagnostics.map((d) => d.path));
  const result: Record<string, unknown> = {};

  for (const key of liveKeys) {
    const newValue = (newConfig as Record<string, unknown>)[key];
    if (newValue !== undefined) {
      result[key] = newValue;
    }
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

    // Detect all changes
    const allChanges = detectConfigChanges(currentConfig, newConfig);
    const {liveChanges, restartChanges} = partitionChanges(allChanges);

    // Apply live changes if enabled
    if (opts.autoApplyLive && liveChanges.length > 0) {
      const liveConfig = extractLiveConfigChanges(currentConfig, newConfig, liveChanges);
      applyLiveConfig(liveConfig);

      warn('[reload-handler] Applied live-reloadable config changes:', {
        keys: liveChanges.map((d) => d.path)
      });
    }

    // Emit warnings for restart-required changes
    if (opts.emitWarnings && restartChanges.length > 0) {
      emitRestartWarning(restartChanges);

      // Update state with pending changes
      state = {
        ...state,
        pendingRestartChanges: [...state.pendingRestartChanges, ...restartChanges],
        hasPendingRestartChanges: true
      };

      warn('[reload-handler] Queued restart-required config changes:', {
        keys: restartChanges.map((d) => d.path)
      });
    }

    // Update last applied config with live changes
    if (liveChanges.length > 0) {
      state = {
        ...state,
        lastAppliedConfig: {...currentConfig, ...extractLiveConfigChanges(currentConfig, newConfig, liveChanges)}
      };
    }

    return {
      success: true,
      config: newConfig,
      appliedLive: liveChanges.map((d) => d.path),
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
  const getState = (): Readonly<ReloadHandlerState> => ({...state});

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

/** Set of root-level configuration keys for automatic scope detection. */
const ROOT_KEYS = new Set(['autoUpdatePlugins', 'defaultSSHApp', 'disableAutoUpdates', 'updateChannel', 'useConpty']);

/**
 * Determines the scope of a configuration key.
 *
 * @param key - The configuration key.
 * @returns 'root' if it's a root-level key, 'profile' otherwise.
 */
const getKeyScope = (key: string): 'root' | 'profile' => {
  return ROOT_KEYS.has(key) ? 'root' : 'profile';
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
