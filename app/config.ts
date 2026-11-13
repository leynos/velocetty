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

import type {parsedConfig, configOptions, ColorMap} from '@shared/types/config';
import {isJsonObject} from './utils/runtime-guards';

import {createConfigMetrics} from './config/config-metrics';
import {createImportRecorder, type ImportRecord} from './config/config-observability';
import {createConfigSpanRecorder} from './config/config-spans';
import {emitE2EMarker, formatKeymapsMarker, type E2EKeymapStatus} from './config/e2e-keymap-probe';
import {fixConfigDefaults as applyConfigDefaults} from './config/fix-config-defaults';
import {createConfigImportModule} from './config/import';
import {shouldAnnounceReload, type ConfigImportReport} from './config/import-report';
import {_init} from './config/init';
import {createKeybindingsService} from './config/keybindings';
import {keybindingsCodec} from './config/keybindings-codec';
import {createKeybindingsNotifier} from './config/keybindings-notifier';
import {createFileKeybindingsStore} from './config/keybindings-store';
import _openConfig from './config/open';
import {
  cfgPath,
  cfgDir,
  configInspection,
  configTree,
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
import {closeWatcherAtShutdown, createConfigWatcher, type WatcherEvent, type WatcherHandle} from './config/watcher';
import {
  captureWatchedFileStamps,
  createWatchedFileReconciler,
  settleWatchedFileStamps,
  type WatchedFileStamps
} from './config/watched-file-stamp';

const metrics = createConfigMetrics();

const recorder = createImportRecorder({
  metrics,
  sink: {info: (line) => console.info(line), warn: (line) => console.warn(line)}
});

const spans = createConfigSpanRecorder({
  now: () => performance.now(),
  sink: {info: (line) => console.info(line), warn: (line) => console.warn(line)}
});

// The adapters are built once, at module load, exactly as before the ports
// were split: only the start-up *command* is deferred to `setup()`, so a
// query made earlier still works and still performs no start-up side effects.
const keybindingsStore = createFileKeybindingsStore({
  filePath: keybindingsPath,
  metrics,
  onRetry: recorder.recordRenameRetry,
  spans
});
const keybindingsService = createKeybindingsService({
  codec: keybindingsCodec,
  report: createKeybindingsNotifier(notify),
  store: keybindingsStore
});

const {_import} = createConfigImportModule({
  _init,
  keybindings: {reload: keybindingsService.reload, start: keybindingsService.start},
  notify,
  paths: {
    cfgDir,
    cfgPath,
    configInspection,
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

/** The files the watcher covers, resolved once because they never change. */
const watchedFiles = [path.resolve(cfgPath), path.resolve(keybindingsPath)];

/**
 * Returns the configuration the last import applied.
 *
 * Throws rather than returning `undefined`, so a caller that runs before
 * `setup()` fails loudly instead of reading a half-built configuration.
 *
 * @example
 * ```ts
 * setup();
 * getCurrentConfig().keymaps; // the keymaps now in effect
 * ```
 */
const getCurrentConfig = (): parsedConfig => {
  if (cfg === undefined) {
    throw new Error('Configuration has not been initialized');
  }

  return cfg;
};

/**
 * Lists the deprecated CSS class names the configuration still uses.
 *
 * @param config - The decorated configuration to inspect.
 * @returns The deprecated names found in `css` or `termCSS`, in a fixed order.
 *
 * @example
 * ```ts
 * getDeprecatedCSS({css: '.x-screen {}', termCSS: ''} as configOptions); // ['x-screen']
 * ```
 */
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

/**
 * Warns once when the active configuration uses deprecated CSS classes.
 *
 * Silent before start-up has stored a configuration, so a query cannot warn.
 *
 * @example
 * ```ts
 * checkDeprecatedConfig(); // notifies only when a deprecated class is in use
 * ```
 */
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
  /** Subscribes one listener to a single chokidar event name. */
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

/**
 * Re-imports every source after a watched file changed.
 *
 * One bounded record is emitted per reload attempt, whether it applied, fell
 * back, or kept the previous keymaps and suppressed the user-facing notice.
 * A thrown import produces no per-file outcomes, so it gets its own bounded
 * failure record and counter instead. Only the import is guarded: a subscriber
 * that throws afterwards must not fabricate an import failure.
 */
const reloadConfiguration = () => {
  const finishSpan = spans.begin('reload');
  let imported: ReturnType<typeof _import>;
  try {
    recorder.beginImport({phase: 'reload'});
    imported = _import('reload');
  } catch (error) {
    finishSpan('thrown');
    recorder.recordImportFailure({cause: 'thrown', phase: 'reload'});
    // The watcher still owns the warning and the decision to keep watching.
    throw error;
  }
  const {config, keybindings: outcome, report} = imported;
  finishSpan(report.config === 'fallback' ? 'fallback' : 'applied');
  cfg = config;
  const announced = shouldAnnounceReload(report);
  const record: ImportRecord = {announced, configSource: configTree, outcome, phase: 'reload', report};
  if (report.config === 'fallback') {
    Object.assign(record, {fallbackBasis: 'defaults' as const});
  }
  recorder.recordImport(record);
  if (announced) {
    notify('Configuration updated', 'Configuration reloaded!');
  }
  watchers.forEach((fn) => {
    fn();
  });
  checkDeprecatedConfig();
  emitKeymapsMarker(report);
};

/**
 * Starts the configuration watcher once; later calls are no-ops.
 *
 * @param startupStamps - The file identities captured before the start-up
 *   import, with the files that import wrote settled to what it applied.
 */
const _watch = (startupStamps: WatchedFileStamps) => {
  if (configWatcher !== undefined) {
    return;
  }

  const watchedDirectories = [...new Set(watchedFiles.map((fileName) => path.dirname(fileName)))];
  // Chokidar's initial scan suppresses events for the files it finds, so a
  // save that lands mid-scan would otherwise wait for the next edit. The
  // reconciler compares against the baseline taken before the import read the
  // files, so a save that landed between that read and now is still seen.
  const reconcileOnReady = createWatchedFileReconciler(startupStamps);

  configWatcher = createConfigWatcher<ReturnType<typeof setTimeout>>({
    cancel: (timer) => clearTimeout(timer),
    debounceMs: CONFIG_DEBOUNCE_MS,
    fileNames: watchedFiles,
    handle: createChokidarHandle(watchedDirectories),
    metrics,
    onReady: () => emitE2EMarker('[e2e] config-watcher-ready'),
    /** Re-reads when a file changed, or could not be inspected, during the scan. */
    reconcileOnReady,
    /** Re-imports on a debounced change; the watcher catches whatever it throws. */
    onReload: reloadConfiguration,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    spans
  });

  app.on('before-quit', () => {
    // A failed release is already counted; logging its bounded shape keeps a
    // configuration path out of the shutdown log.
    closeWatcherAtShutdown(configWatcher, (line, details) => console.warn(line, details));
  });
};

/**
 * Registers a callback that runs after every applied reload.
 *
 * Returns an unsubscribe function, so a caller that is torn down does not keep
 * receiving reloads.
 *
 * @example
 * ```ts
 * const unsubscribe = subscribe(() => render());
 * unsubscribe(); // the callback no longer runs
 * ```
 */
export const subscribe = (fn: Function) => {
  watchers.push(fn);
  return () => {
    watchers.splice(watchers.indexOf(fn), 1);
  };
};

/**
 * Returns the active configuration directory.
 *
 * Plugins load from here, so it names the tree the running configuration came
 * from rather than the Velocetty tree unconditionally.
 *
 * @example
 * ```ts
 * getConfigDir(); // '/home/ada/.config/Velocetty'
 * ```
 */
export const getConfigDir = () => {
  // expose config directory to load plugin from the right place
  return cfgDir;
};

/**
 * Returns the name of the profile the application starts with.
 *
 * Falls back to the first configured profile, then to `default`, so a config
 * that names no profile still resolves to something usable.
 *
 * @example
 * ```ts
 * getDefaultProfile(); // 'default'
 * ```
 */
export const getDefaultProfile = () => {
  const {config} = getCurrentConfig();
  return config.defaultProfile || config.profiles[0]?.name || 'default';
};

/**
 * Returns the merged configuration for the default profile.
 *
 * Kept for backward compatibility with callers that predate profiles.
 *
 * @example
 * ```ts
 * getConfig().colors; // the default profile's colours
 * ```
 */
export const getConfig = () => {
  return getProfileConfig(getDefaultProfile());
};

/**
 * Returns every configured profile.
 *
 * @example
 * ```ts
 * getProfiles().map(({name}) => name); // ['default']
 * ```
 */
export const getProfiles = () => {
  return getCurrentConfig().config.profiles;
};

/** The settings a profile is allowed to override in the root configuration. */
type ProfileOverrideKey = keyof configOptions['profiles'][number]['config'];

/**
 * Merges one profile over the root configuration.
 *
 * Object-valued settings merge key by key, so a profile can recolour one entry
 * without restating the rest; every other setting replaces the root value.
 *
 * @param profileName - The profile to merge; an unknown name contributes nothing.
 * @returns A new configuration with the profile's overrides applied.
 *
 * @example
 * ```ts
 * getProfileConfig('default').colors; // root colours plus the profile's overrides
 * ```
 */
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

/**
 * Opens the active configuration file in the user's editor.
 *
 * @example
 * ```ts
 * openConfig(); // launches the configured editor on config.json5
 * ```
 */
export const openConfig = () => {
  return _openConfig();
};

/**
 * Returns the plugins the active configuration enables.
 *
 * @example
 * ```ts
 * getPlugins(); // {plugins: ['hyper-simple'], localPlugins: []}
 * ```
 */
export const getPlugins = () => {
  const currentConfig = getCurrentConfig();
  return {
    plugins: currentConfig.plugins,
    localPlugins: currentConfig.localPlugins
  };
};

/**
 * Returns the keymaps the running configuration applies.
 *
 * @example
 * ```ts
 * getKeymaps(); // {'window:new': ['ctrl+shift+n']}
 * ```
 */
export const getKeymaps = () => {
  return getCurrentConfig().keymaps;
};

/**
 * Runs the start-up import, then starts watching for configuration changes.
 *
 * Counts the attempt, creates the Velocetty tree, clears a stale temporary
 * keybindings file, and records the import before any watcher can fire, so the
 * first reload sees a complete state. Counting first means a failure during
 * preparation is still reported as a start-up attempt.
 *
 * @example
 * ```ts
 * setup(); // the application is now reading and watching its configuration
 * ```
 */
export const setup = () => {
  const finishSpan = spans.begin('startup');
  let imported: ReturnType<typeof _import>;
  // Captured before the import reads anything: a save that lands between that
  // read and the watcher's baseline must still look like a change, or the app
  // would keep content the file no longer holds and the scan would hide it.
  let startupStamps = captureWatchedFileStamps(watchedFiles);
  try {
    // Count the attempt before any preparation runs: a failure while creating
    // the tree or clearing a stale temporary file is still a start-up attempt,
    // and the failure record below would otherwise describe an uncounted one.
    recorder.beginImport({phase: 'startup'});
    // The Velocetty tree holds new configuration files, so it must exist before
    // the importer copies schemas or seeds `keybindings.json5` into it.
    mkdirpSync(velocettyDir);
    // A crashed write can leave a temporary file behind. Start-up is the only
    // phase that may remove it, and the edge owns that cleanup immediately
    // before the seed decision reads the file.
    keybindingsStore.removeStaleTemporaryFiles();
    imported = _import('startup');
  } catch (error) {
    // A start-up crash is otherwise invisible: no per-file outcome exists, so
    // it needs the same bounded failure record a thrown reload gets.
    finishSpan('thrown');
    recorder.recordImportFailure({cause: 'thrown', phase: 'startup'});
    throw error;
  }
  const {config, keybindings: outcome, report} = imported;
  finishSpan(report.config === 'fallback' ? 'fallback' : 'applied');
  cfg = config;
  // Start-up never shows "Configuration updated", so the record states that
  // rather than leaving the field absent.
  const record: ImportRecord = {announced: false, configSource: configTree, outcome, phase: 'startup', report};
  if (report.config === 'fallback') {
    Object.assign(record, {fallbackBasis: 'defaults' as const});
  }
  recorder.recordImport(record);
  // Adopt a written file's identity only while it still holds the text just
  // applied; a concurrent writer that got there first keeps the pre-import
  // identity, so readiness reloads instead of keeping stale content.
  startupStamps = settleWatchedFileStamps(startupStamps, imported.writtenFiles);
  _watch(startupStamps);
  checkDeprecatedConfig();
  emitE2EMarker(`[e2e] keybindings-path ${keybindingsPath}`);
  emitE2EMarker(`[e2e] config-path ${cfgPath}`);
  emitKeymapsMarker(report);
};

export {get as getWin, recordState as winRecord, defaults as windowDefaults} from './config/windows';

/**
 * Fills the colours the decorated configuration leaves unset.
 *
 * The terminal needs a colour for every xterm CSS slot, so the palette the
 * configuration import applied supplies any the user did not override. The
 * palette is a parameter rather than a fresh bundled-file read: decoration
 * happens whenever a window or the preferences editor opens, and those must
 * not depend on a second read of a file the import already read.
 *
 * @param decoratedConfig - The configuration to complete, mutated in place.
 * @param appliedColors - The colours the applied configuration supplies;
 *   absent or partial when the bundled config could not be read.
 * @returns The same configuration with a full colour map.
 *
 * @example
 * ```ts
 * fixConfigDefaults({colors: {}} as configOptions, {black: '#000'}).colors.black; // '#000'
 * ```
 */
export const fixConfigDefaults = (decoratedConfig: configOptions, appliedColors?: Partial<ColorMap>) =>
  // A bundled config that could not be read or parsed has no `config` section,
  // so the palette is absent rather than merely incomplete. Keep the user's
  // own colours instead of dereferencing `undefined`.
  applyConfigDefaults(decoratedConfig, appliedColors);

/**
 * Decorates a profile's configuration, then completes its colour map.
 *
 * The palette the import applied is copied before the decorator runs, so a
 * plugin that removes a colour cannot also remove the default it should fall
 * back to. The copied palette is the decoration's only default source: a
 * second read of the bundled file would let a later read fault change the
 * colours of an already-running window.
 *
 * @param profileName - The profile to decorate.
 * @param decorate - The plugin decoration to apply first.
 * @returns The decorated configuration with a complete colour map.
 *
 * @example
 * ```ts
 * decorateProfileConfig('default', (config) => ({...config, colors: {}})).colors.black; // the applied black
 * ```
 */
export const decorateProfileConfig = (
  profileName: string,
  decorate: (decoratedConfig: configOptions) => configOptions
): configOptions => {
  const baseConfig = getProfileConfig(profileName);
  const appliedColors = {...baseConfig.colors};
  return fixConfigDefaults(decorate(baseConfig), appliedColors);
};

/**
 * Rewrites legacy hterm CSS selectors to their current equivalents.
 *
 * @param config - The configuration whose `css` and `termCSS` are rewritten.
 * @returns The same configuration with the selectors translated.
 *
 * @example
 * ```ts
 * htermConfigTranslate({css: '.x-screen {}', termCSS: ''} as configOptions).css; // '.xterm-rows > div {}'
 * ```
 */
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
