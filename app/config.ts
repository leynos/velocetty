/** @file Composition root: resolves the config tree and wires import, keybindings, and reload. */
/*
 * This module owns the process-wide configuration state. It resolves the
 * active Velocetty or development tree, builds the keybindings store and
 * service over that path, imports every configuration source, and re-runs the
 * import whenever a watched file changes. The adapters it constructs take
 * filesystem, clock, and notification dependencies as parameters, so the
 * modules below it stay testable without Electron.
 */

import {app} from 'electron';

import chokidar from 'chokidar';
import {mkdirpSync} from 'fs-extra';
import path from 'node:path';

import type {parsedConfig, configOptions} from '@shared/types/config';
import {isJsonObject} from './utils/runtime-guards';

import {createConfigMetrics} from './config/config-metrics';
import {createImportRecorder} from './config/config-observability';
import {formatKeymapsMarker, isE2ERun, type E2EKeymapStatus} from './config/e2e-keymap-probe';
import {createConfigImportModule} from './config/import';
import {shouldAnnounceReload, type ConfigImportReport} from './config/import-report';
import {_init} from './config/init';
import {createKeybindingsService} from './config/keybindings';
import {createFileKeybindingsStore} from './config/keybindings-store';
import _openConfig from './config/open';
import {
  cfgPath,
  cfgDir,
  defaultCfg,
  defaultPlatformKeyPath,
  keybindingsPath,
  keybindingsSchemaFile,
  keybindingsSchemaPath,
  plugs,
  schemaFile,
  schemaPath,
  shadowedConfigPaths,
  velocettyDir
} from './config/paths';
import notify from './notify';
import {getColorMap} from './utils/colours';
import {createConfigWatcher, type WatcherEvent, type WatcherHandle} from './config/watcher';

const metrics = createConfigMetrics();

const recorder = createImportRecorder({
  metrics,
  sink: {info: (line) => console.info(line), warn: (line) => console.warn(line)}
});

const keybindingsStore = createFileKeybindingsStore({filePath: keybindingsPath, onRetry: recorder.recordRenameRetry});
const keybindingsService = createKeybindingsService({notify, store: keybindingsStore});

const {_import, getDefaultConfig} = createConfigImportModule({
  _init,
  keybindings: {reload: keybindingsService.reload, start: keybindingsService.start},
  notify,
  paths: {
    cfgDir,
    cfgPath,
    defaultCfg,
    defaultPlatformKeyPath,
    keybindingsDir: path.dirname(keybindingsPath),
    keybindingsPath,
    keybindingsSchemaFile,
    keybindingsSchemaPath,
    plugs,
    schemaFile,
    schemaPath,
    shadowedConfigPaths,
    velocettyDir
  }
});

/** Imports keybindings text verbatim; the active keymaps change on the next reload. */
export const importKeybindings = keybindingsService.importKeybindings;

/** Reports the stored keybindings text without writing, notifying, or changing state. */
export const exportKeybindings = keybindingsService.exportKeybindings;

const CONFIG_DEBOUNCE_MS = 100;

const watchers: Function[] = [];
let cfg: parsedConfig | undefined;
let configWatcher: {readonly close: () => Promise<void>} | undefined;

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

const emitE2EMarker = (line: string) => {
  if (isE2ERun()) {
    console.log(line);
  }
};

/** Maps the import report onto the keymap status the E2E lane asserts on. */
const keymapStatus = (report: ConfigImportReport): E2EKeymapStatus =>
  report.keybindings === 'applied' ? 'applied' : 'kept';

/** Reports the probe binding the E2E lane asserts on after every reload. */
const emitKeymapsMarker = (report: ConfigImportReport) => {
  emitE2EMarker(formatKeymapsMarker(keymapStatus(report), getCurrentConfig().keymaps));
};

/** Wraps chokidar in the adapter the watcher debounces over. */
const createChokidarHandle = (directories: readonly string[]): WatcherHandle => {
  const watcher = chokidar.watch([...directories], {depth: 0, ignoreInitial: true});
  const on = (event: WatcherEvent, listener: (eventPath: string) => void) => {
    switch (event) {
      case 'add': {
        watcher.on('add', listener);
        break;
      }
      case 'change': {
        watcher.on('change', listener);
        break;
      }
      case 'unlink': {
        watcher.on('unlink', listener);
        break;
      }
    }
  };

  return {
    close: async () => watcher.close(),
    on,
    onError: (listener) => {
      // SAFETY: chokidar's error event emits the error as its only argument.
      watcher.on('error', (error: unknown) => listener(error));
    },
    onReady: (listener) => {
      watcher.on('ready', listener);
    }
  };
};

/** Starts the configuration watcher once; later calls are no-ops. */
const _watch = () => {
  if (configWatcher !== undefined) {
    return;
  }

  const watchedDirectories = [
    ...new Set([path.dirname(cfgPath), path.dirname(keybindingsPath)].map((directory) => path.resolve(directory)))
  ];

  configWatcher = createConfigWatcher<ReturnType<typeof setTimeout>>({
    cancel: (timer) => clearTimeout(timer),
    debounceMs: CONFIG_DEBOUNCE_MS,
    fileNames: [path.resolve(cfgPath), path.resolve(keybindingsPath)],
    handle: createChokidarHandle(watchedDirectories),
    onReady: () => emitE2EMarker('[e2e] config-watcher-ready'),
    onReload: () => {
      const {config, keybindings: outcome, report} = _import('reload');
      cfg = config;
      // One bounded record per reload attempt, whether it applied, fell back,
      // or kept the previous keymaps and suppressed the user-facing notice.
      const announced = shouldAnnounceReload(report);
      recorder.recordImport({announced, outcome, phase: 'reload', report});
      if (announced) {
        notify('Configuration updated', 'Configuration reloaded!');
      }
      watchers.forEach((fn) => {
        fn();
      });
      checkDeprecatedConfig();
      emitKeymapsMarker(report);
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs)
  });

  app.on('before-quit', () => {
    configWatcher?.close().catch((error) => {
      console.warn(error);
    });
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
  // The Velocetty tree holds new configuration files, so it must exist before
  // the importer copies schemas or seeds `keybindings.json5` into it.
  mkdirpSync(velocettyDir);
  const {config, keybindings: outcome, report} = _import('startup');
  cfg = config;
  // Start-up never shows "Configuration updated", so the record states that
  // rather than leaving the field absent.
  recorder.recordImport({announced: false, outcome, phase: 'startup', report});
  _watch();
  checkDeprecatedConfig();
  emitE2EMarker(`[e2e] keybindings-path ${keybindingsPath}`);
  emitE2EMarker(`[e2e] config-path ${cfgPath}`);
  emitKeymapsMarker(report);
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
