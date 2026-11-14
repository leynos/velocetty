/**
 * @file Exercises the production plugin loader with a sensitive plugin name.
 *
 * The loader is the only place a configured plugin directory reaches a console
 * or a notification. A notification names the plugin so the user can find the
 * entry to fix; a console line must number it, because the directory name and
 * the version are user text that would otherwise be copied into a log.
 */
import {expect, test} from 'bun:test';
import path from 'node:path';

import {createPluginLoader, type PluginModule} from '../../app/plugins-load';
import type {NotificationDetails} from '../../app/utils/notification-log';

/*
 * The loader resolves each plugin's manifest with `path.resolve`, so every
 * fixture path is resolved the same way. A literal `/home/ada/...` string is
 * rooted differently by the two platforms, and a registry keyed by the literal
 * text then misses on Windows even though the code is correct.
 */

/** A directory and version that must never reach the console. */
const PLUGIN_DIRECTORY = path.resolve('/home/ada/secret-projects/super-secret-plugin');
const LOCAL_PLUGIN_DIRECTORY = path.resolve('/home/ada/secret-projects/local-only');
const INSTALLED_PLUGIN_DIRECTORY = path.resolve('/installed/first');
const PLUGIN_VERSION = '0.0.0-private';

/** The manifest request the loader makes for a plugin directory. */
const manifestOf = (pluginDirectory: string) => path.resolve(pluginDirectory, 'package.json');

/** The shapes a scripted `require` request may resolve to. */
type RegistryEntry =
  | Error
  | {readonly decorateConfig: (config: string) => string}
  | {readonly notAPlugin: true}
  | {readonly version: string};

/** Builds the scripted registry from `[specifier, exports]` pairs. */
const registryOf = (...entries: [string, RegistryEntry][]) => new Map(entries);

/** One notification the loader asked to show. */
type ShownNotification = Readonly<{
  readonly body: string;
  readonly details: NotificationDetails | undefined;
  readonly title: string;
}>;

/**
 * Builds a loader over a scripted module registry.
 *
 * A registry value is returned as the module's exports, except an `Error`,
 * which the require call throws: that is how a load failure reaches the loader.
 *
 * @param registry - Requested specifier to exports, or the error to throw.
 * @returns The loader and the records each sink received.
 */
const createLoader = (registry: ReadonlyMap<string, RegistryEntry>) => {
  const logs: string[] = [];
  const warnings: string[] = [];
  const notifications: ShownNotification[] = [];

  const load = createPluginLoader<PluginModule>({
    // One extension name is enough for the tests; the real set is larger.
    availableExtensions: new Set(['decorateConfig']),
    log: (message) => logs.push(message),
    notify: (title, body, details) => notifications.push({body, details, title}),
    requireModule: <Module>(request: string): Module => {
      if (!registry.has(request)) {
        throw Object.assign(new Error(`Cannot find module '${request}'`), {code: 'MODULE_NOT_FOUND'});
      }
      const entry = registry.get(request);
      if (entry instanceof Error) {
        throw entry;
      }
      // SAFETY: `has` above proved a mapping exists, and the registry only ever
      // holds a `PluginModule` here; the loader reads its keys and two fields.
      return entry as Module;
    },
    warn: (message) => warnings.push(message)
  });

  return {load, logs, notifications, warnings};
};

/**
 * The user text a console line must never carry.
 *
 * The path fragment is matched by the directory and account names rather than
 * by a separator, so the same assertion holds whichever separator the platform
 * resolved into the fixture.
 */
const SENSITIVE_TEXT = /super-secret-plugin|0\.0\.0-private|ada/;

/** Everything the loader wrote to a console sink, as one searchable string. */
const consoleText = (loads: {logs: string[]; warnings: string[]}) => JSON.stringify([loads.logs, loads.warnings]);

test('a successful load reports the plugin by position, never by name or version', () => {
  const {load, logs, notifications, warnings} = createLoader(
    registryOf(
      [PLUGIN_DIRECTORY, {decorateConfig: (config: string) => config}],
      [manifestOf(PLUGIN_DIRECTORY), {version: PLUGIN_VERSION}]
    )
  );

  const [plugin] = load([PLUGIN_DIRECTORY]);

  expect(logs).toEqual(['Plugin 1 loaded.']);
  expect(warnings).toEqual([]);
  expect(notifications).toEqual([]);
  expect(consoleText({logs, warnings})).not.toMatch(SENSITIVE_TEXT);
  // The name is still populated for the plugin's own internal errors; it just
  // never reaches a log.
  expect(plugin._name).toBe('super-secret-plugin');
  expect(plugin._version).toBe(PLUGIN_VERSION);
});

test('a missing manifest warns by position and still loads the plugin', () => {
  const {load, logs, notifications, warnings} = createLoader(
    registryOf([PLUGIN_DIRECTORY, {decorateConfig: (config: string) => config}])
  );

  const [plugin] = load([PLUGIN_DIRECTORY]);

  expect(warnings).toEqual(['No package.json found for plugin 1.']);
  expect(logs).toEqual(['Plugin 1 loaded.']);
  expect(notifications).toEqual([]);
  expect(consoleText({logs, warnings})).not.toMatch(SENSITIVE_TEXT);
  expect(plugin._name).toBe('super-secret-plugin');
});

test('a missing module warns by position and shows no notification', () => {
  const {load, logs, notifications, warnings} = createLoader(registryOf());

  const loaded = load([PLUGIN_DIRECTORY]);

  expect(loaded).toEqual([]);
  expect(warnings).toEqual(['Plugin 1 failed to load.']);
  expect(logs).toEqual([]);
  expect(notifications).toEqual([]);
  expect(consoleText({logs, warnings})).not.toMatch(SENSITIVE_TEXT);
});

test('a module that throws while loading is notified by name and logged nowhere', () => {
  const failure = Object.assign(new Error(`EACCES: open ${path.join(PLUGIN_DIRECTORY, 'index.js')}`), {code: 'EACCES'});
  const {load, logs, notifications, warnings} = createLoader(registryOf([PLUGIN_DIRECTORY, failure]));

  const loaded = load([PLUGIN_DIRECTORY]);

  expect(loaded).toEqual([]);
  expect(logs).toEqual([]);
  expect(warnings).toEqual([]);
  // The user has to find this entry in their configuration, so this text keeps
  // the name; only the log sinks are restricted.
  expect(notifications).toEqual([
    {
      body: 'Plugin "super-secret-plugin" failed to load (EACCES).',
      details: {category: 'thrown', error: failure, operation: 'plugin-load'},
      title: 'Plugin error!'
    }
  ]);
});

test('a module exposing no extension API is notified by name and logged nowhere', () => {
  const {load, logs, notifications, warnings} = createLoader(registryOf([PLUGIN_DIRECTORY, {notAPlugin: true}]));

  const loaded = load([PLUGIN_DIRECTORY]);

  expect(loaded).toEqual([]);
  expect(notifications).toEqual([
    {
      body: 'Plugin "super-secret-plugin" does not expose any Hyper extension API methods',
      details: undefined,
      title: 'Plugin error!'
    }
  ]);
  expect(consoleText({logs, warnings})).toBe('[[],[]]');
});

test('positions count across the installed and local lists', () => {
  const {load, warnings} = createLoader(
    registryOf(
      [LOCAL_PLUGIN_DIRECTORY, {decorateConfig: (config: string) => config}],
      [manifestOf(LOCAL_PLUGIN_DIRECTORY), {version: PLUGIN_VERSION}]
    )
  );

  const loaded = load([INSTALLED_PLUGIN_DIRECTORY, LOCAL_PLUGIN_DIRECTORY]);

  // Two entries were configured, so the local plugin is second even though the
  // installed one failed to load.
  expect(loaded).toHaveLength(1);
  expect(warnings).toEqual(['Plugin 1 failed to load.']);
  expect(loaded[0]._version).toBe(PLUGIN_VERSION);
});
