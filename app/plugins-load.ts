/** @file Loads the configured plugin modules, reporting the ones that fail. */
/*
 * A plugin lives in a directory the user named, so neither the console nor a
 * notification log may quote that path. Failure text comes from the bounded
 * helpers in `utils/plugin-failure`: a notification names the plugin because
 * the reader chose it and has to act on it, while a console line numbers it.
 *
 * The loader is separate from the plugin lifecycle module so that behaviour —
 * including both console sinks — can be exercised without Electron, a config
 * store, or a real plugin directory.
 */
import path from 'node:path';

import {errorCode} from './utils/error-code';
import type {NotificationDetails} from './utils/notification-log';
import {
  pluginFailureLogText,
  pluginLoadedText,
  pluginLoadFailureText,
  pluginMetadataWarning
} from './utils/plugin-failure';

/**
 * The minimal plugin surface this loader writes to.
 *
 * A plugin may expose any of the decoration hooks; the loader only records the
 * name and version it found, leaving the rest of the module untouched.
 */
export type PluginModule = object & {_name?: string; _version?: string};

/** Everything the loader reaches outside itself: module resolution and sinks. */
export type PluginLoaderDependencies = Readonly<{
  /** The extension names any one of which makes a module a usable plugin. */
  readonly availableExtensions: ReadonlySet<string>;
  /** Writes a bounded console record. */
  readonly log: (message: string) => void;
  /** Shows a user-facing notification, with bounded log context. */
  readonly notify: (title: string, body: string, details?: NotificationDetails) => void;
  /** Requires a module the way Node resolves it from the plugin directory. */
  readonly requireModule: <Module>(request: string) => Module;
  /** Writes a bounded console warning. */
  readonly warn: (message: string) => void;
}>;

/**
 * Builds the loader for one configured list of plugin directories.
 *
 * A module that exposes no extension API, or that throws while being required,
 * is reported and left out rather than aborting the rest: one broken
 * third-party plugin must not stop the window from opening.
 *
 * @param dependencies - Module resolution and the console and notification sinks.
 * @returns A loader that keeps the plugins that loaded, in configuration order.
 *
 * @example
 * ```ts
 * const load = createPluginLoader({availableExtensions, log, notify, requireModule, warn});
 * load(['/home/ada/.config/velocetty/plugins/hyper-cwd']);
 * ```
 */
export const createPluginLoader =
  <Module extends PluginModule>(dependencies: PluginLoaderDependencies) =>
  (pluginPaths: readonly string[]): Module[] => {
    const {availableExtensions, log, notify, requireModule, warn} = dependencies;

    /**
     * Requires one plugin module, reporting why it was skipped when it fails.
     *
     * @param pluginPath - Absolute path of the plugin directory.
     * @param ordinal - The plugin's position in the configured list, from one.
     * @returns The loaded module, or `undefined` when it cannot be used.
     */
    const load = (pluginPath: string, ordinal: number): Module | undefined => {
      try {
        const mod = requireModule<Module>(pluginPath);
        const exposed = Object.keys(mod).some((key) => availableExtensions.has(key));
        if (!exposed) {
          // The user has to find this entry in their configuration, so the
          // notification names it; the console reads nothing at all here.
          notify(
            'Plugin error!',
            `${`Plugin "${path.basename(pluginPath)}" does not expose any `}Hyper extension API methods`
          );
          return undefined;
        }

        // Populate the name for internal errors here; it is module state a
        // plugin may read, not a log field.
        mod._name = path.basename(pluginPath);
        try {
          mod._version = requireModule<{version?: string}>(path.resolve(pluginPath, 'package.json')).version;
        } catch {
          warn(pluginMetadataWarning(ordinal));
        }
        // The version is unbounded metadata from the plugin's own manifest, so
        // the console line numbers the plugin instead of quoting it.
        log(pluginLoadedText(ordinal));

        return mod;
      } catch (error) {
        if (errorCode(error) === 'MODULE_NOT_FOUND') {
          // A missing module is common enough to stay quiet in the UI, so the
          // console line is the only report; it numbers the plugin rather than
          // repeating the directory name the configuration supplied.
          warn(pluginFailureLogText(ordinal, error));
        } else {
          notify('Plugin error!', pluginLoadFailureText(path.basename(pluginPath), error), {
            category: 'thrown',
            error,
            operation: 'plugin-load'
          });
        }
        return undefined;
      }
    };

    return pluginPaths.flatMap((pluginPath, index) => {
      const value = load(pluginPath, index + 1);
      return value === undefined ? [] : [value];
    });
  };
