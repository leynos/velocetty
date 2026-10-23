/**
 * @file App-local mirror of the shared configuration reloadability registry.
 *
 * The registry is the source of truth for whether a settings change can be
 * applied while the app runs or needs a restart. `app/config/reload-handler.ts`
 * consumes it at runtime from the main process, where it is compiled to
 * CommonJS under `dist/app` and has no runtime `@shared/*` resolution. The
 * shared copy in `shared/src/constants/config-reloadability.ts` serves the
 * renderer, which is bundled and resolves the alias.
 *
 * Both copies are held to the same classifications by
 * `test/unit/app-reloadability-parity.test.ts`, which imports each under its
 * own alias and compares them entry by entry. Edit both together; the parity
 * test is what fails when only one moves. See the alias rule in
 * `docs/developers-guide.md`.
 */

import type {ConfigReloadClassification as Reloadability} from '@shared/types/config';

export type {ConfigReloadClassification as Reloadability} from '@shared/types/config';

/**
 * Configuration key under which the terminal cursor style is stored.
 *
 * The shared contract exports this as `CURSOR_STYLE_CONFIG_KEY`, a runtime
 * value this tree cannot import. Repeating the string is safe because the key
 * is a data value in a computed position rather than a symbol name, and the
 * parity test asserts it still matches the shared constant.
 */
const CURSOR_STYLE_KEY = 'cursorShape';

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
export const rootConfigReloadability = {
  autoUpdatePlugins: {
    classification: 'restart',
    rationale: 'Affects background plugin update scheduling; requires process-level timer reconfiguration'
  },
  defaultProfile: {
    classification: 'live',
    rationale: 'Default profile selection; affects next session creation'
  },
  defaultSSHApp: {
    classification: 'restart',
    rationale: 'Affects OS protocol handler registration; requires process-level changes'
  },
  disableAutoUpdates: {
    classification: 'restart',
    rationale: 'Affects update check scheduling; requires process-level timer reconfiguration'
  },
  profiles: {
    classification: 'live',
    rationale: 'Available profile configurations; can be updated for subsequent sessions'
  },
  updateChannel: {
    classification: 'restart',
    rationale: 'Affects update source and potentially binary compatibility; safer to restart'
  },
  useConpty: {
    classification: 'restart',
    rationale: 'Affects PTY backend selection; requires new session creation'
  }
} satisfies ConfigReloadabilityRegistry;

/**
 * Reloadability registry for profile-level config options (terminal appearance
 * and behaviour).
 *
 * These settings primarily affect terminal presentation and can generally be
 * hot-reloaded, with the exception of the WebGL renderer, which is deferred to
 * CONFIG-001.
 */
export const profileConfigReloadability = {
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
  // Spelled out rather than imported: `CURSOR_STYLE_CONFIG_KEY` is a runtime
  // value, and this module is compiled for a tree with no `@shared/*`
  // resolution. The parity test asserts this key still matches the shared
  // constant.
  [CURSOR_STYLE_KEY]: {
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
} satisfies ConfigReloadabilityRegistry;

/**
 * Reloadability registry for keymap settings.
 *
 * Keybindings are always live-reloadable as they only affect input event
 * routing.
 */
export const keymapReloadability = {
  '*': {
    classification: 'live',
    rationale: 'All keymap entries are live-reloadable; they only affect input event routing'
  }
} satisfies ConfigReloadabilityRegistry;

/**
 * Reloadability registry for plugin configuration.
 *
 * Plugin enable/disable is generally live-reloadable subject to safe unload.
 */
export const pluginReloadability = {
  plugins: {
    classification: 'live',
    rationale: 'Plugin list changes are live-reloadable subject to safe unload/load'
  },
  localPlugins: {
    classification: 'live',
    rationale: 'Local plugin changes are live-reloadable subject to safe unload/load'
  }
} satisfies ConfigReloadabilityRegistry;

/** Configuration key scope types. */
export type ConfigScope = 'root' | 'profile' | 'keymap' | 'plugin';

/**
 * Reads a registry entry by key through the open registry contract.
 *
 * Each registry is declared with `satisfies`, so its binding keeps the literal
 * type of the keys it actually contains. That is what lets `Object.keys`
 * enumerate them precisely, but it also means a dynamic key cannot index the
 * binding directly. Widening the parameter here, rather than the binding, keeps
 * both properties: callers get a typed lookup, and the registries retain their
 * known-key evidence.
 *
 * @param registry - The registry to read from.
 * @param key - The configuration key to look up.
 * @returns The matching entry, or undefined when the key is absent.
 */
const lookupReloadability = (registry: ConfigReloadabilityRegistry, key: string): ReloadabilityEntry | undefined =>
  registry[key];

/**
 * Gets the reloadability classification for a given config key.
 *
 * @param key - The configuration key to look up.
 * @param scope - The scope of the config key.
 * @returns The reloadability entry, or undefined if not found.
 */
export const getReloadability = (key: string, scope: ConfigScope): ReloadabilityEntry | undefined => {
  switch (scope) {
    case 'root': {
      return lookupReloadability(rootConfigReloadability, key);
    }
    case 'profile': {
      return lookupReloadability(profileConfigReloadability, key);
    }
    case 'keymap': {
      return lookupReloadability(keymapReloadability, key) ?? lookupReloadability(keymapReloadability, '*');
    }
    case 'plugin': {
      return lookupReloadability(pluginReloadability, key);
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Set of root-level configuration keys for automatic scope detection.
 * Derived from `rootConfigReloadability` to maintain a single source of truth.
 */
const ROOT_KEYS = new Set(Object.keys(rootConfigReloadability));

/** Set of plugin-related configuration keys. */
const PLUGIN_KEYS = new Set(['plugins', 'localPlugins']);

/** Set of keymap-related configuration keys. */
const KEYMAP_KEYS = new Set(['keymap']);

/**
 * Determines the scope of a configuration key.
 *
 * @param key - The configuration key.
 * @returns The scope classification: 'root', 'profile', 'plugin', or 'keymap'.
 */
export const getKeyScope = (key: string): ConfigScope => {
  if (ROOT_KEYS.has(key)) {
    return 'root';
  }
  if (PLUGIN_KEYS.has(key)) {
    return 'plugin';
  }
  if (KEYMAP_KEYS.has(key)) {
    return 'keymap';
  }
  return 'profile';
};
