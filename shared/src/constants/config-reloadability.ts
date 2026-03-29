/** @file Configuration reloadability registry defining live-reloadable vs restart-required settings.
 *
 * This registry maps configuration keys to their reload capability classification,
 * determining whether a setting change can be applied immediately or requires
 * an application restart.
 *
 * Classification rationale follows the design document specifications:
 * - Hot reload: theme/UI appearance, font settings, keybindings, tab decorations,
 *   plugin enable/disable
 * - Restart required: backend transport settings, update channel, process-level
 *   configuration, WebGL renderer (deferred to CONFIG-001)
 */

/** Classification values for configuration reloadability. */
export type Reloadability = 'live' | 'restart';

/** Entry in the reloadability registry with classification and rationale. */
export type ReloadabilityEntry = {
  /** The reload capability classification for this setting. */
  readonly classification: Reloadability;
  /** Human-readable explanation of why this classification was chosen. */
  readonly rationale: string;
};

/** Registry mapping config keys to their reloadability classification. */
export type ConfigReloadabilityRegistry = {
  readonly [key: string]: ReloadabilityEntry;
};

/**
 * Reloadability registry for root-level config options (non-profile settings).
 *
 * These settings affect application-level behaviour and are generally
 * restart-required when they affect process-level configuration.
 */
export const rootConfigReloadability: ConfigReloadabilityRegistry = {
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
 *
 * These settings primarily affect terminal presentation and can generally be
 * hot-reloaded, with the exception of WebGL renderer which is deferred to CONFIG-001.
 */
export const profileConfigReloadability: ConfigReloadabilityRegistry = {
  backgroundColor: {
    classification: 'live',
    rationale: 'Theme/UI appearance setting; can be applied via xterm reconfigure'
  },
  bell: {
    classification: 'live',
    rationale: 'Terminal behaviour setting; affects event handling only'
  },
  bellSound: {
    classification: 'live',
    rationale: 'Audio resource reference; can be updated for next bell trigger'
  },
  bellSoundURL: {
    classification: 'live',
    rationale: 'Audio resource path; can be updated for next bell trigger'
  },
  borderColor: {
    classification: 'live',
    rationale: 'Theme/UI appearance setting; CSS colour value'
  },
  colors: {
    classification: 'live',
    rationale: 'Terminal colour palette; can be applied via xterm reconfigure'
  },
  copyOnSelect: {
    classification: 'live',
    rationale: 'Terminal behaviour setting; affects selection event handling'
  },
  css: {
    classification: 'live',
    rationale: 'Custom CSS; can be reinjected into the DOM immediately'
  },
  cursorAccentColor: {
    classification: 'live',
    rationale: 'Cursor appearance setting; can be applied via xterm reconfigure'
  },
  cursorBlink: {
    classification: 'live',
    rationale: 'Cursor behaviour setting; can be applied via xterm reconfigure'
  },
  cursorColor: {
    classification: 'live',
    rationale: 'Cursor appearance setting; can be applied via xterm reconfigure'
  },
  cursorShape: {
    classification: 'live',
    rationale: 'Cursor appearance setting; can be applied via xterm reconfigure'
  },
  disableLigatures: {
    classification: 'live',
    rationale: 'Font rendering setting; can be applied via xterm reconfigure'
  },
  env: {
    classification: 'restart',
    rationale: 'Environment variables affect child process spawning; requires new sessions'
  },
  fontFamily: {
    classification: 'live',
    rationale: 'Font setting; can be applied via xterm reconfigure without restart'
  },
  fontSize: {
    classification: 'live',
    rationale: 'Font setting; can be applied via xterm reconfigure without restart'
  },
  fontWeight: {
    classification: 'live',
    rationale: 'Font setting; can be applied via xterm reconfigure without restart'
  },
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
  letterSpacing: {
    classification: 'live',
    rationale: 'Typography setting; can be applied via xterm reconfigure'
  },
  lineHeight: {
    classification: 'live',
    rationale: 'Typography setting; can be applied via xterm reconfigure'
  },
  macOptionSelectionMode: {
    classification: 'live',
    rationale: 'Selection behaviour setting; affects event handling only'
  },
  modifierKeys: {
    classification: 'live',
    rationale: 'Key handling setting; affects input processing only'
  },
  padding: {
    classification: 'live',
    rationale: 'Layout setting; can be updated via CSS immediately'
  },
  preserveCWD: {
    classification: 'live',
    rationale: 'Session behaviour setting; affects future tab/split creation only'
  },
  quickEdit: {
    classification: 'live',
    rationale: 'Context menu behaviour; can be updated for next interaction'
  },
  screenReaderMode: {
    classification: 'restart',
    rationale: 'Accessibility mode affects DOM structure; safer to restart for consistent state'
  },
  scrollback: {
    classification: 'live',
    rationale: 'Buffer size setting; can be applied via xterm reconfigure'
  },
  selectionColor: {
    classification: 'live',
    rationale: 'Theme/UI appearance setting; can be applied via xterm reconfigure'
  },
  shell: {
    classification: 'restart',
    rationale: 'Shell executable path affects session spawning; requires new sessions'
  },
  shellArgs: {
    classification: 'restart',
    rationale: 'Shell arguments affect session spawning; requires new sessions'
  },
  showHamburgerMenu: {
    classification: 'live',
    rationale: 'UI chrome setting; can be toggled via CSS and menu state'
  },
  showWindowControls: {
    classification: 'restart',
    rationale: 'Window chrome setting; platform window management requires restart'
  },
  termCSS: {
    classification: 'live',
    rationale: 'Terminal CSS; can be reinjected into the terminal DOM immediately'
  },
  uiFontFamily: {
    classification: 'live',
    rationale: 'UI font setting; can be updated via CSS immediately'
  },
  webGLRenderer: {
    classification: 'restart',
    rationale: 'Deferred to CONFIG-001: requires terminal session restart handling'
  },
  webGLRendererMaxContexts: {
    classification: 'restart',
    rationale: 'Deferred to CONFIG-001: coupled with webGLRenderer setting'
  },
  webLinksActivationKey: {
    classification: 'live',
    rationale: 'Link activation modifier; affects event handling only'
  },
  windowSize: {
    classification: 'restart',
    rationale: 'Initial window dimensions; only affects new windows'
  },
  workingDirectory: {
    classification: 'live',
    rationale: 'Startup directory; affects future session creation only'
  }
};

/**
 * Reloadability registry for keymap settings.
 *
 * Keybindings are always live-reloadable as they only affect input event routing.
 */
export const keymapReloadability: ConfigReloadabilityRegistry = {
  '*': {
    classification: 'live',
    rationale: 'All keymap entries are live-reloadable; they only affect input event routing'
  }
};

/**
 * Reloadability registry for plugin configuration.
 *
 * Plugin enable/disable is generally live-reloadable subject to safe unload.
 */
export const pluginReloadability: ConfigReloadabilityRegistry = {
  plugins: {
    classification: 'live',
    rationale: 'Plugin list changes are live-reloadable subject to safe unload/load'
  },
  localPlugins: {
    classification: 'live',
    rationale: 'Local plugin changes are live-reloadable subject to safe unload/load'
  }
};

/**
 * Gets the reloadability classification for a given config key.
 *
 * @param key - The configuration key to look up.
 * @param scope - The scope of the config key ('root', 'profile', or 'keymap').
 * @returns The reloadability entry, or undefined if not found.
 *
 * @example
 * ```ts
 * const entry = getReloadability('fontSize', 'profile');
 * // { classification: 'live', rationale: 'Font setting...' }
 * ```
 */
export const getReloadability = (
  key: string,
  scope: 'root' | 'profile' | 'keymap' | 'plugin'
): ReloadabilityEntry | undefined => {
  switch (scope) {
    case 'root':
      return rootConfigReloadability[key];
    case 'profile':
      return profileConfigReloadability[key];
    case 'keymap':
      return keymapReloadability[key] ?? keymapReloadability['*'];
    case 'plugin':
      return pluginReloadability[key];
    default:
      return undefined;
  }
};

/**
 * Checks if a config key requires restart when changed.
 *
 * @param key - The configuration key to check.
 * @param scope - The scope of the config key ('root', 'profile', or 'keymap').
 * @returns True if the setting requires restart, false if live-reloadable.
 */
export const requiresRestart = (key: string, scope: 'root' | 'profile' | 'keymap' | 'plugin'): boolean => {
  const entry = getReloadability(key, scope);
  // Default to restart-required for safety when classification is unknown
  return entry?.classification === 'restart' || entry === undefined;
};

/**
 * Checks if a config key can be live-reloaded.
 *
 * @param key - The configuration key to check.
 * @param scope - The scope of the config key ('root', 'profile', or 'keymap').
 * @returns True if the setting is live-reloadable, false if restart is required.
 */
export const isLiveReloadable = (key: string, scope: 'root' | 'profile' | 'keymap' | 'plugin'): boolean => {
  const entry = getReloadability(key, scope);
  return entry?.classification === 'live';
};

/**
 * Gets all config keys in a given scope.
 *
 * @param scope - The scope to enumerate.
 * @returns Array of config keys in that scope.
 */
export const getConfigKeys = (scope: 'root' | 'profile' | 'keymap' | 'plugin'): string[] => {
  switch (scope) {
    case 'root':
      return Object.keys(rootConfigReloadability);
    case 'profile':
      return Object.keys(profileConfigReloadability);
    case 'keymap':
      return ['*'];
    case 'plugin':
      return Object.keys(pluginReloadability);
    default:
      return [];
  }
};

/**
 * Set of root-level configuration keys for automatic scope detection.
 */
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
 * Checks if a config key requires restart when changed (convenience function).
 *
 * @param key - The configuration key to check.
 * @returns True if the setting requires restart, false if live-reloadable.
 */
export const keyRequiresRestart = (key: string): boolean => {
  const scope = getKeyScope(key);
  const entry = getReloadability(key, scope);
  // Default to restart-required for safety when classification is unknown
  return entry?.classification === 'restart' || entry === undefined;
};

/**
 * Checks if a config key can be live-reloaded (convenience function).
 *
 * @param key - The configuration key to check.
 * @returns True if the setting is live-reloadable, false if restart is required.
 */
export const keyIsLiveReloadable = (key: string): boolean => {
  const scope = getKeyScope(key);
  const entry = getReloadability(key, scope);
  return entry?.classification === 'live';
};

/**
 * Gets the reload classification for a config key (convenience function).
 *
 * @param key - The configuration key.
 * @returns The classification or undefined if unknown.
 */
export const getKeyReloadClassification = (key: string): Reloadability | undefined => {
  const scope = getKeyScope(key);
  return getReloadability(key, scope)?.classification;
};
