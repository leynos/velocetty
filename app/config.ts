import {app} from 'electron';

import chokidar from 'chokidar';

import type {parsedConfig, configOptions} from '@shared/types/config';
import {isJsonObject} from './utils/runtime-guards';

import {createConfigImportModule} from './config/import';
import {_init} from './config/init';
import _openConfig from './config/open';
import {cfgPath, cfgDir, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath} from './config/paths';
import notify from './notify';
import {getColorMap} from './utils/colours';

const {_import, getDefaultConfig} = createConfigImportModule({
  _init,
  notify,
  paths: {cfgDir, cfgPath, defaultCfg, defaultPlatformKeyPath, plugs, schemaFile, schemaPath}
});

const watchers: Function[] = [];
let cfg: parsedConfig | undefined;
let _watcher: chokidar.FSWatcher | undefined;

const getCurrentConfig = (): parsedConfig => {
  if (cfg === undefined) {
    throw new Error('Configuration has not been initialized');
  }

  return cfg;
};

export const getDeprecatedCSS = (config: configOptions) => {
  const deprecated: string[] = [];
  const deprecatedCSS = ['x-screen', 'x-row', 'cursor-node', '::selection'];
  deprecatedCSS.forEach((css) => {
    if (config.css.includes(css) || config.termCSS.includes(css)) {
      deprecated.push(css);
    }
  });
  return deprecated;
};

const checkDeprecatedConfig = () => {
  if (cfg === undefined) {
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
  if (_watcher !== undefined) {
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
    const watcher = _watcher;
    if (watcher && Object.keys(watcher.getWatched()).length > 0) {
      watcher.close().catch((error) => {
        console.warn(error);
      });
    }
  });
};

export const subscribe = (fn: Function) => {
  watchers.push(fn);
  return () => {
    watchers.splice(watchers.indexOf(fn), 1);
  };
};

export const getConfigDir = () => {
  // expose config directory to load plugin from the right place
  return cfgDir;
};

export const getDefaultProfile = () => {
  const {config} = getCurrentConfig();
  return config.defaultProfile || config.profiles[0]?.name || 'default';
};

// get config for the default profile, keeping it for backward compatibility
export const getConfig = () => {
  return getProfileConfig(getDefaultProfile());
};

export const getProfiles = () => {
  return getCurrentConfig().config.profiles;
};

/** The settings a profile is allowed to override in the root configuration. */
type ProfileOverrideKey = keyof configOptions['profiles'][number]['config'];

export const getProfileConfig = (profileName: string): configOptions => {
  const {profiles, defaultProfile, ...baseConfig} = getCurrentConfig().config;
  const profileConfig = profiles.find((candidate) => candidate.name === profileName)?.config ?? {};
  const merged: configOptions = {...baseConfig, defaultProfile, profiles};

  // A profile overrides only the settings it names. Object-valued settings
  // (`colors`, `env`, `modifierKeys`) merge with the base so a profile can
  // recolour one entry; every other setting replaces the base value outright.
  // SAFETY: `profileConfig` is a `Partial<profileConfigOptions>`, so every
  // enumerable key it carries is a profile setting; `Object.keys` only loses
  // that fact because it widens the key type to `string`.
  for (const key of Object.keys(profileConfig) as ProfileOverrideKey[]) {
    const baseValue = merged[key];
    const overrideValue = profileConfig[key];
    const mergedValue =
      isJsonObject(baseValue) && isJsonObject(overrideValue) ? {...baseValue, ...overrideValue} : overrideValue;
    Object.assign(merged, {[key]: mergedValue});
  }

  return merged;
};

export const openConfig = () => {
  return _openConfig();
};

export const getPlugins = () => {
  const currentConfig = getCurrentConfig();
  return {
    plugins: currentConfig.plugins,
    localPlugins: currentConfig.localPlugins
  };
};

export const getKeymaps = () => {
  return getCurrentConfig().keymaps;
};

export const setup = () => {
  cfg = _import();
  _watch();
  checkDeprecatedConfig();
};

export {get as getWin, recordState as winRecord, defaults as windowDefaults} from './config/windows';

export const fixConfigDefaults = (decoratedConfig: configOptions) => {
  const defaultConfig = getDefaultConfig().config!;
  const colorOverrides = getColorMap(decoratedConfig.colors);
  // We must have default colours for xterm css.
  decoratedConfig.colors = {...defaultConfig.colors, ...colorOverrides};
  return decoratedConfig;
};

export const htermConfigTranslate = (config: configOptions) => {
  const cssReplacements = {
    'x-screen x-row([ {.[])': '.xterm-rows > div$1',
    '.cursor-node([ {.[])': '.terminal-cursor$1',
    '::selection([ {.[])': '.terminal .xterm-selection div$1',
    'x-screen a([ {.[])': '.terminal a$1',
    'x-row a([ {.[])': '.terminal a$1'
  };
  Object.entries(cssReplacements).forEach(([pattern, newvalue]) => {
    const searchvalue = new RegExp(pattern, 'g');
    config.css = config.css.replace(searchvalue, newvalue);
    config.termCSS = config.termCSS.replace(searchvalue, newvalue);
  });
  return config;
};
