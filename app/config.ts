import {app} from 'electron';

import chokidar from 'chokidar';

import type {parsedConfig, configOptions} from '@shared/types/config';

import {_import, getDefaultConfig} from './config/import';
import _openConfig from './config/open';
import {cfgPath, cfgDir} from './config/paths';
import notify from './notify';
import {getColorMap} from './utils/colours';

const watchers: Function[] = [];
let cfg: parsedConfig = {} as any;
let _watcher: chokidar.FSWatcher;

/** Lists deprecated CSS selectors still present in a configuration's `css`/`termCSS`. */
export const getDeprecatedCSS = (config: configOptions) => {
  const deprecated: string[] = [];
  const deprecatedCSS = ['x-screen', 'x-row', 'cursor-node', '::selection'];
  deprecatedCSS.forEach((css) => {
    if (config.css?.includes(css) || config.termCSS?.includes(css)) {
      deprecated.push(css);
    }
  });
  return deprecated;
};

const checkDeprecatedConfig = () => {
  if (!cfg.config) {
    return;
  }
  const deprecated = getDeprecatedCSS(cfg.config);
  if (deprecated.length === 0) {
    return;
  }
  const deprecatedStr = deprecated.join(', ');
  notify('Configuration warning', `Your configuration uses some deprecated CSS classes (${deprecatedStr})`);
};

const _watch = () => {
  if (_watcher) {
    return;
  }

  const onChange = () => {
    // Need to wait 100ms to ensure that write is complete
    setTimeout(() => {
      cfg = _import();
      notify('Configuration updated', 'Hyper configuration reloaded!');
      watchers.forEach((fn) => {
        fn();
      });
      checkDeprecatedConfig();
    }, 100);
  };

  _watcher = chokidar.watch(cfgPath);
  _watcher.on('change', onChange);
  _watcher.on('error', (error) => {
    console.error('error watching config', error);
  });

  app.on('before-quit', () => {
    if (Object.keys(_watcher.getWatched()).length > 0) {
      _watcher.close().catch((err) => {
        console.warn(err);
      });
    }
  });
};

/** Registers a callback to run whenever the on-disk configuration is reloaded. */
export const subscribe = (fn: Function) => {
  watchers.push(fn);
  return () => {
    watchers.splice(watchers.indexOf(fn), 1);
  };
};

/** Returns the directory holding the user's configuration, for plugins to resolve paths against. */
export const getConfigDir = () => {
  // expose config directory to load plugin from the right place
  return cfgDir;
};

/** Resolves the profile name to use when none is specified, falling back to the first profile. */
export const getDefaultProfile = () => {
  return cfg.config.defaultProfile || cfg.config.profiles[0]?.name || 'default';
};

// get config for the default profile, keeping it for backward compatibility
/** Returns the resolved configuration for the default profile. */
export const getConfig = () => {
  return getProfileConfig(getDefaultProfile());
};

/** Returns the list of configured profiles. */
export const getProfiles = () => {
  return cfg.config.profiles;
};

/** Merges a named profile's overrides onto the base configuration. */
export const getProfileConfig = (profileName: string): configOptions => {
  const {profiles, defaultProfile, ...baseConfig} = cfg.config;
  const profileConfig = profiles.find((p) => p.name === profileName)?.config || {};
  for (const key in profileConfig) {
    if (typeof baseConfig[key] === 'object' && !Array.isArray(baseConfig[key])) {
      baseConfig[key] = {...baseConfig[key], ...profileConfig[key]};
    } else {
      baseConfig[key] = profileConfig[key];
    }
  }
  return {...baseConfig, defaultProfile, profiles};
};

/** Opens the configuration file for editing in the user's preferred editor. */
export const openConfig = () => {
  return _openConfig();
};

/** Returns the configured plugin module names, split by npm-published vs. local plugins. */
export const getPlugins = (): {
  /** npm-published plugin module names. */
  plugins: string[];
  /** Locally developed plugin module names. */
  localPlugins: string[];
} => {
  return {
    plugins: cfg.plugins,
    localPlugins: cfg.localPlugins
  };
};

/** Returns the configured keymap overrides. */
export const getKeymaps = () => {
  return cfg.keymaps;
};

/** Loads the configuration and starts watching it for changes. */
export const setup = () => {
  cfg = _import();
  _watch();
  checkDeprecatedConfig();
};

export {get as getWin, recordState as winRecord, defaults as windowDefaults} from './config/windows';

/** Fills in default colours on a plugin-decorated config so xterm CSS always has values to use. */
export const fixConfigDefaults = (decoratedConfig: configOptions) => {
  const defaultConfig = getDefaultConfig().config!;
  const colorOverrides = getColorMap(decoratedConfig.colors);
  // We must have default colours for xterm css.
  decoratedConfig.colors = {...defaultConfig.colors, ...(colorOverrides ?? {})};
  return decoratedConfig;
};

/** Rewrites legacy hterm CSS selectors in a config to their xterm.js equivalents. */
export const htermConfigTranslate = (config: configOptions) => {
  const cssReplacements: Record<string, string> = {
    'x-screen x-row([ {.[])': '.xterm-rows > div$1',
    '.cursor-node([ {.[])': '.terminal-cursor$1',
    '::selection([ {.[])': '.terminal .xterm-selection div$1',
    'x-screen a([ {.[])': '.terminal a$1',
    'x-row a([ {.[])': '.terminal a$1'
  };
  Object.keys(cssReplacements).forEach((pattern) => {
    const searchvalue = new RegExp(pattern, 'g');
    const newvalue = cssReplacements[pattern];
    config.css = config.css?.replace(searchvalue, newvalue);
    config.termCSS = config.termCSS?.replace(searchvalue, newvalue);
  });
  return config;
};
