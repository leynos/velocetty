/** @file Manages plugin lifecycle and exposes plugin APIs to the app. */
import {exec, execFile} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {promisify} from 'node:util';

import {app, dialog, ipcMain as _ipcMain} from 'electron';
import type {BrowserWindow, App, MenuItemConstructorOptions} from 'electron';
import React from 'react';

import Config from 'electron-store';
import ms from 'ms';
import ReactDom from 'react-dom';

import type {IpcMainWithCommands} from '@shared/types/common';
import type {configOptions} from '@shared/types/config';

import * as config from './config';
import {isFunction, isObject, isString} from '@shared/types/guards';
import {plugs} from './config/paths';
import notify from './notify';
import {availableExtensions} from './plugins/extensions';
import {install} from './plugins/install';
import {
  ensureRuntimePluginSettingsPersisted,
  getRuntimePluginCommandDefinitions,
  getRuntimePluginKeybindings,
  mergeRuntimePluginKeybindings
} from './runtime/plugin-runtime';
import mapKeys from './utils/map-keys';

// local storage
const cache = new Config();
const pluginRequire = createRequire(path.resolve(app.getAppPath(), 'plugins.js'));

type ModuleLoader = (request: string, parent?: NodeJS.Module | null, isMain?: boolean) => ReturnType<NodeJS.Require>;
type ModuleWithLoader = typeof import('node:module') & {_load: ModuleLoader};

/**
 * Keymap shape passed through the plugin decoration hooks.
 *
 * Each command maps to one shortcut or a list of them, matching the accepted
 * `keymaps` config shape. `getDecoratedKeymaps` then normalizes every entry to
 * a list via `mapKeys`.
 */
type KeymapConfig = Record<string, string | string[]>;

// The app process only ever invokes the main-process half of the plugin API,
// so it declares that half here rather than borrowing `hyperPlugin`. That type
// lives in `typings/hyper.d.ts` alongside the renderer contract and imports
// renderer modules; reaching for it from this file pulls the whole renderer
// tree into the main-process build program, which `app/tsconfig.build.json`
// does not list, so every such import fails to resolve.
type AppPluginModule = {
  _name?: string;
  _version?: string;
  decorateConfig?: (config: configOptions) => configOptions;
  decorateMenu?: (menu: MenuItemConstructorOptions[]) => MenuItemConstructorOptions[];
  decorateEnv?: (env: Record<string, string>) => Record<string, string>;
  decorateKeymaps?: (keymaps: KeymapConfig) => KeymapConfig;
  extendKeymaps?: KeymapConfig;
  onApp?: (app: App) => void;
  onUnload?: (app: App) => void;
  onWindow?: (window: BrowserWindow) => void;
  onWindowClass?: (windowClass: typeof import('electron').BrowserWindow) => void;
  decorateWindowClass?: (
    windowClass: typeof import('electron').BrowserWindow
  ) => typeof import('electron').BrowserWindow;
};

const pluginPath = plugs.base;
const localPath = plugs.local;

patchModuleLoad();

let runtimePluginDefaultsPersisted = false;

const ensureRuntimeDefaultsPersisted = () => {
  if (runtimePluginDefaultsPersisted) {
    return;
  }

  try {
    ensureRuntimePluginSettingsPersisted();
    runtimePluginDefaultsPersisted = true;
  } catch (error) {
    console.warn('Failed to persist runtime plugin settings defaults.', error);
  }
};

// caches
let plugins = config.getPlugins();
let paths = getPaths();
let id = getId(plugins);
let modules = requirePlugins();

function getId(plugins_: any) {
  return JSON.stringify(plugins_);
}

const watchers: Function[] = [];

// we listen on configuration updates to trigger
// plugin installation
config.subscribe(() => {
  const plugins_ = config.getPlugins();
  if (plugins !== plugins_) {
    const id_ = getId(plugins_);
    if (id !== id_) {
      id = id_;
      plugins = plugins_;
      updatePlugins();
    }
  }
});

// patching Module._load
// so plugins can `require` them without needing their own version
// https://github.com/vercel/hyper/issues/619
function patchModuleLoad() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  // SAFETY: Node exposes the internal loader on `node:module`; this wrapper preserves its call signature.
  const Module = pluginRequire('node:module') as ModuleWithLoader;
  const originalLoad = Module._load;
  Module._load = function _load(modulePath: string, parent?: NodeJS.Module | null, isMain?: boolean) {
    // PLEASE NOTE: Code changes here, also need to be changed in
    // lib/utils/plugins.js
    switch (modulePath) {
      case 'react': {
        // DEPRECATED
        return React;
      }
      case 'react-dom': {
        // DEPRECATED
        return ReactDom;
      }
      case 'hyper/component': {
        // DEPRECATED
        return React.PureComponent;
      }
      // These return Object, since they work differently on the backend, than on the frontend.
      // Still needs to be here, to prevent errors, while loading plugins.
      case 'hyper/Notification':
      case 'hyper/notify':
      case 'hyper/decorate': {
        return Object;
      }
      default: {
        return originalLoad.call(this, modulePath, parent, isMain);
      }
    }
  };
}

function checkDeprecatedExtendKeymaps() {
  modules.forEach((plugin) => {
    if (plugin.extendKeymaps) {
      notify('Plugin warning!', `"${plugin._name}" use deprecated "extendKeymaps" handler`);
      return;
    }
  });
}

let updating = false;

function updatePlugins({force = false} = {}) {
  if (updating) {
    return notify('Plugin update in progress');
  }
  updating = true;
  syncPackageJSON();
  const id_ = id;
  install((err) => {
    updating = false;

    if (err) {
      notify('Error updating plugins.', err, {error: err});
    } else {
      // flag successful plugin update
      cache.set('hyper.plugins', id_);

      // cache paths
      paths = getPaths();

      // clear require cache
      clearCache();

      // cache modules
      modules = requirePlugins();

      const loaded = modules.length;
      const total = paths.plugins.length + paths.localPlugins.length;
      const pluginVersions = JSON.stringify(getPluginVersions());
      const changed = cache.get('hyper.plugin-versions') !== pluginVersions && loaded === total;
      cache.set('hyper.plugin-versions', pluginVersions);

      // notify watchers
      watchers.forEach((fn) => {
        fn(err, {force});
      });

      if (force || changed) {
        if (changed) {
          notify('Plugins Updated', 'Restart the app or hot-reload with "View" > "Reload" to enjoy the updates!');
        } else {
          notify('Plugins Updated', 'No changes!');
        }
        checkDeprecatedExtendKeymaps();
      }
    }
  });
}

function getPluginVersions() {
  const paths_ = [...paths.plugins, ...paths.localPlugins];
  return paths_.map((path_) => {
    let version: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      version = pluginRequire(path.resolve(path_, 'package.json')).version;
      //eslint-disable-next-line no-empty
    } catch {}
    return [path.basename(path_), version];
  });
}

function clearCache() {
  // trigger unload hooks
  modules.forEach((mod) => {
    if (mod.onUnload) {
      mod.onUnload(app);
    }
  });

  // clear require cache
  for (const entry in pluginRequire.cache) {
    if (entry.indexOf(pluginPath) === 0 || entry.indexOf(localPath) === 0) {
      delete pluginRequire.cache[entry];
    }
  }
}

export {updatePlugins};

export const getLoadedPluginVersions = () => {
  return modules.map((mod) => ({name: mod._name, version: mod._version}));
};

// we schedule the initial plugins update
// a bit after the user launches the terminal
// to prevent slowness
if (cache.get('hyper.plugins') !== id || process.env.HYPER_FORCE_UPDATE) {
  // install immediately if the user changed plugins
  console.log('plugins have changed / not init, scheduling plugins installation');
  setTimeout(() => {
    updatePlugins();
  }, 1000);
}

(() => {
  const baseConfig = config.getConfig();
  if (baseConfig.autoUpdatePlugins) {
    // otherwise update plugins every 5 hours
    setInterval(updatePlugins, ms(baseConfig.autoUpdatePlugins === true ? '5h' : baseConfig.autoUpdatePlugins));
  }
})();

function syncPackageJSON() {
  const dependencies = toDependencies(plugins);
  const pkg = {
    name: 'hyper-plugins',
    description: 'Auto-generated from `config.json5`!',
    private: true,
    version: '0.0.1',
    repository: 'vercel/hyper',
    license: 'MIT',
    homepage: 'https://hyper.is',
    dependencies
  };

  const file = path.resolve(pluginPath, 'package.json');
  try {
    writeFileSync(file, JSON.stringify(pkg, null, 2));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    alert(`An error occurred writing to ${file}: ${reason}`);
  }
}

function alert(message: string) {
  void dialog.showMessageBox({
    message,
    buttons: ['Ok']
  });
}

function toDependencies(plugins_: {plugins: string[]}) {
  const obj: Record<string, string> = {};
  plugins_.plugins.forEach((plugin) => {
    const regex = /.(@|#)/;
    const match = regex.exec(plugin);

    if (match) {
      const index = match.index + 1;
      const pieces: string[] = [];

      pieces[0] = plugin.slice(0, index);
      pieces[1] = plugin.slice(index + 1);
      obj[pieces[0]] = pieces[1];
    } else {
      obj[plugin] = 'latest';
    }
  });
  return obj;
}

export const subscribe = (fn: Function) => {
  watchers.push(fn);
  return () => {
    watchers.splice(watchers.indexOf(fn), 1);
  };
};

function getPaths() {
  return {
    plugins: plugins.plugins.map((name) => {
      return path.resolve(pluginPath, 'node_modules', name.split('#')[0]);
    }),
    localPlugins: plugins.localPlugins.map((name) => {
      return path.resolve(localPath, name);
    })
  };
}

// expose to renderer
export {getPaths};

// get paths from renderer
export const getBasePaths = () => {
  return {path: pluginPath, localPath};
};

function requirePlugins(): any[] {
  const {plugins: plugins_, localPlugins} = paths;

  const load = (path_: string) => {
    let mod: AppPluginModule;
    try {
      mod = pluginRequire(path_);
      const exposed = Object.keys(mod).some((key) => availableExtensions.has(key));
      if (!exposed) {
        notify(
          'Plugin error!',
          `${`Plugin "${path.basename(path_)}" does not expose any `}Hyper extension API methods`
        );
        return;
      }

      // populate the name for internal errors here
      mod._name = path.basename(path_);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mod._version = pluginRequire(path.resolve(path_, 'package.json')).version;
      } catch {
        console.warn(`No package.json found in ${path_}`);
      }
      console.log(`Plugin ${mod._name} (${mod._version}) loaded.`);

      return mod;
    } catch (error) {
      const errorCode = isObject(error) && 'code' in error && isString(error.code) ? error.code : undefined;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorCode === 'MODULE_NOT_FOUND') {
        console.warn(`Plugin error while loading "${path.basename(path_)}" (${path_}): ${errorMessage}`);
      } else {
        notify('Plugin error!', `Plugin "${path.basename(path_)}" failed to load (${errorMessage})`, {error});
      }
    }
  };

  return [...plugins_, ...localPlugins].flatMap((pluginPath) => {
    const value = load(pluginPath);
    return value ? [value] : [];
  });
}

export const onApp = (app_: App) => {
  modules.forEach((plugin) => {
    if (plugin.onApp) {
      try {
        plugin.onApp(app_);
      } catch (error) {
        notify('Plugin error!', `"${plugin._name}" has encountered an error. Check Developer Tools for details.`, {
          error: error
        });
      }
    }
  });
};

export const onWindowClass = (win: BrowserWindow) => {
  modules.forEach((plugin) => {
    if (plugin.onWindowClass) {
      try {
        plugin.onWindowClass(win);
      } catch (error) {
        notify('Plugin error!', `"${plugin._name}" has encountered an error. Check Developer Tools for details.`, {
          error: error
        });
      }
    }
  });
};

export const onWindow = (win: BrowserWindow) => {
  modules.forEach((plugin) => {
    if (plugin.onWindow) {
      try {
        plugin.onWindow(win);
      } catch (error) {
        notify('Plugin error!', `"${plugin._name}" has encountered an error. Check Developer Tools for details.`, {
          error: error
        });
      }
    }
  });
};

// decorates the base entity by calling plugin[key]
// for all the available plugins
function decorateEntity(base: any, key: string, type: 'object' | 'function') {
  let decorated = base;
  modules.forEach((plugin) => {
    if (plugin[key]) {
      let res;
      try {
        res = plugin[key](decorated);
      } catch (error) {
        notify('Plugin error!', `"${plugin._name}" when decorating ${key}`, {error: error});
        return;
      }
      const matchesExpectedType = type === 'object' ? isObject(res) : isFunction(res);
      if (res && matchesExpectedType) {
        decorated = res;
      } else {
        notify('Plugin error!', `"${plugin._name}": invalid return type for \`${key}\``);
      }
    }
  });

  return decorated;
}

function decorateObject<T>(base: T, key: string): T {
  return decorateEntity(base, key, 'object');
}

function decorateClass(base: any, key: string) {
  return decorateEntity(base, key, 'function');
}

export const getDeprecatedConfig = () => {
  const deprecated: Record<string, {css: string[]}> = {};
  const baseConfig = config.getConfig();
  modules.forEach((plugin) => {
    if (!plugin.decorateConfig) {
      return;
    }
    // We need to clone config in case of plugin modifies config directly.
    let configTmp: configOptions;
    try {
      configTmp = plugin.decorateConfig(structuredClone(baseConfig));
    } catch (error) {
      notify('Plugin error!', `"${plugin._name}" has encountered an error. Check Developer Tools for details.`, {
        error: error
      });
      return;
    }
    const pluginCSSDeprecated = config.getDeprecatedCSS(configTmp);
    if (pluginCSSDeprecated.length === 0) {
      return;
    }
    deprecated[plugin._name] = {css: pluginCSSDeprecated};
  });
  return deprecated;
};

export const decorateMenu = (tpl: MenuItemConstructorOptions[]) => {
  return decorateObject(tpl, 'decorateMenu');
};

export const getDecoratedEnv = (baseEnv: NodeJS.ProcessEnv) => {
  return decorateObject(baseEnv, 'decorateEnv');
};

export const getDecoratedConfig = (profile: string) => {
  ensureRuntimeDefaultsPersisted();
  const baseConfig = config.getProfileConfig(profile);
  const decoratedConfig = decorateObject(baseConfig, 'decorateConfig');
  const fixedConfig = config.fixConfigDefaults(decoratedConfig);
  const translatedConfig = config.htermConfigTranslate(fixedConfig);
  return translatedConfig;
};

export const getDecoratedKeymaps = () => {
  ensureRuntimeDefaultsPersisted();
  const baseKeymaps = config.getKeymaps();
  const runtimeKeymaps = getRuntimePluginKeybindings(config.getConfig());
  const keymapsWithRuntimeContributions = mergeRuntimePluginKeybindings(baseKeymaps, runtimeKeymaps);
  // Ensure that all keys are in an array and don't use deprecated key combination`
  const decoratedKeymaps = mapKeys(decorateObject(keymapsWithRuntimeContributions, 'decorateKeymaps'));
  return decoratedKeymaps;
};

export const getRuntimePluginCommands = () => {
  ensureRuntimeDefaultsPersisted();
  return getRuntimePluginCommandDefinitions(config.getConfig());
};

export const getDecoratedBrowserOptions = <T>(defaults: T): T => {
  return decorateObject(defaults, 'decorateBrowserOptions');
};

export const decorateWindowClass = <T>(defaults: T): T => {
  return decorateObject(defaults, 'decorateWindowClass');
};

export const decorateSessionOptions = <T>(defaults: T): T => {
  return decorateObject(defaults, 'decorateSessionOptions');
};

export const decorateSessionClass = <T>(Session: T): T => {
  return decorateClass(Session, 'decorateSessionClass');
};

export {toDependencies as _toDependencies};

// SAFETY: Electron's ipcMain implements the native handle API; this type adds the repository's command map.
const ipcMain = _ipcMain as IpcMainWithCommands;

ipcMain.handle('child_process.exec', (_event, command, options) => {
  return promisify(exec)(command, options);
});

ipcMain.handle('child_process.execFile', (_event, file, args, options) => {
  return promisify(execFile)(file, args, options);
});

ipcMain.handle('getLoadedPluginVersions', () => getLoadedPluginVersions());
ipcMain.handle('getPaths', () => getPaths());
ipcMain.handle('getBasePaths', () => getBasePaths());
ipcMain.handle('getDeprecatedConfig', () => getDeprecatedConfig());
ipcMain.handle('getDecoratedConfig', (_e, profile) => getDecoratedConfig(profile));
ipcMain.handle('getDecoratedKeymaps', () => getDecoratedKeymaps());
ipcMain.handle('getRuntimePluginCommands', () => getRuntimePluginCommands());
