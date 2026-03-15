/** @file Covers install, uninstall, and listing branches in CLI plugin APIs. */
import {expect, test} from 'bun:test';

import JSON5 from 'json5';
import path from 'node:path';

import {createCliApi, type CliApi} from '../../cli/api';

type ConfigData = {
  plugins: unknown;
  localPlugins: unknown;
};

type GotError = {
  statusCode?: number;
  message: string;
};

type CliHarnessOptions = {
  readonly configData?: ConfigData;
  readonly env?: {
    APPDATA?: string;
    NODE_ENV?: string;
    XDG_CONFIG_HOME?: string;
  };
  readonly existingPaths?: Set<string> | null;
  readonly fsExistsSyncResult?: boolean;
  readonly fsReadFileSyncValue?: unknown;
  readonly gotError?: GotError | null;
  readonly gotVersions?: unknown;
  readonly hasReadFileSyncOverride?: boolean;
};

type CliHarnessState = {
  configData: ConfigData;
  existingPaths: Set<string> | null;
  fsExistsSyncResult: boolean;
  fsReadFileSyncCallCount: number;
  fsReadFileSyncValue: unknown;
  gotError: GotError | null;
  gotVersions: unknown;
  hasReadFileSyncOverride: boolean;
  requestedUrls: string[];
  savedConfigs: ConfigData[];
};

type CliHarness = {
  api: CliApi;
  state: CliHarnessState;
};

const CLI_DIRECTORY = path.join(process.cwd(), 'cli');

const createCliHarness = (options: CliHarnessOptions = {}): CliHarness => {
  const state: CliHarnessState = {
    configData: options.configData ?? {plugins: [], localPlugins: []},
    existingPaths: options.existingPaths ?? null,
    fsExistsSyncResult: options.fsExistsSyncResult ?? true,
    fsReadFileSyncCallCount: 0,
    fsReadFileSyncValue: options.fsReadFileSyncValue,
    gotError: options.gotError ?? null,
    gotVersions: 'gotVersions' in options ? options.gotVersions : {'1.0.0': {}},
    hasReadFileSyncOverride: options.hasReadFileSyncOverride ?? false,
    requestedUrls: [],
    savedConfigs: []
  };

  const api = createCliApi({
    env: {
      NODE_ENV: options.env?.NODE_ENV ?? 'test',
      XDG_CONFIG_HOME: options.env?.XDG_CONFIG_HOME,
      APPDATA: options.env?.APPDATA
    },
    fsModule: {
      existsSync: (candidatePath) => {
        if (state.existingPaths) {
          return typeof candidatePath === 'string' && state.existingPaths.has(candidatePath);
        }
        return state.fsExistsSyncResult;
      },
      readFileSync: () => {
        state.fsReadFileSyncCallCount += 1;
        return state.hasReadFileSyncOverride ? state.fsReadFileSyncValue : JSON.stringify(state.configData);
      },
      writeFileSync: (_path, contents) => {
        const parsed = JSON5.parse(contents) as ConfigData;
        state.savedConfigs.push(parsed);
        state.configData = parsed;
      }
    },
    gotClient: {
      get: (url: string) => {
        state.requestedUrls.push(url);
        if (state.gotError) {
          return Promise.reject(state.gotError);
        }
        return Promise.resolve({body: {versions: state.gotVersions}});
      }
    },
    moduleDirectory: CLI_DIRECTORY,
    registryUrl: 'https://registry.npmjs.org/'
  });

  return {api, state};
};

test('list() and isInstalled() read configured plugin state', () => {
  const {api} = createCliHarness({
    configData: {plugins: ['plugin-alpha', 'plugin-beta'], localPlugins: ['local-alpha']}
  });

  expect(api.list()).toBe('plugin-alpha\nplugin-beta');
  expect(api.isInstalled('plugin-beta')).toBe(true);
  expect(api.isInstalled('local-alpha', true)).toBe(true);
});

test('list() accepts JSON5 plugin config with comments and trailing commas', () => {
  const {api} = createCliHarness({
    fsReadFileSyncValue: `{
      // plugin sources
      plugins: ['plugin-alpha',],
      localPlugins: ['local-alpha',],
    }`,
    hasReadFileSyncOverride: true
  });

  expect(api.list()).toBe('plugin-alpha');
  expect(api.isInstalled('plugin-alpha')).toBe(true);
  expect(api.isInstalled('local-alpha', true)).toBe(true);
});

test('install() persists plugin entries from npm checks', async () => {
  const {api, state} = createCliHarness();

  await api.install('plugin-alpha');

  expect(state.requestedUrls).toEqual(['https://registry.npmjs.org/plugin-alpha']);
  expect(state.savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-alpha'],
    localPlugins: []
  });
});

test('install() persists local plugin entries when local install is requested', async () => {
  const {api, state} = createCliHarness();

  await api.install('local-plugin', {locally: true});

  expect(state.requestedUrls).toEqual(['https://registry.npmjs.org/local-plugin']);
  expect(state.savedConfigs.at(-1)).toEqual({
    plugins: [],
    localPlugins: ['local-plugin']
  });
});

test('install() rejects duplicate local plugins that already exist in config', async () => {
  const {api} = createCliHarness({
    configData: {plugins: [], localPlugins: ['local-plugin']}
  });

  await expect(api.install('local-plugin', {locally: true})).rejects.toBe('local-plugin is already installed');
});

test('install() maps npm and transport errors to stable user-facing messages', async () => {
  const missingPluginHarness = createCliHarness({
    gotError: {statusCode: 404, message: 'Not found'}
  });
  await expect(missingPluginHarness.api.install('missing-plugin')).rejects.toBe('missing-plugin not found on npm');

  const unstablePluginHarness = createCliHarness({
    gotError: {message: 'socket hang up'}
  });
  await expect(unstablePluginHarness.api.install('unstable-plugin')).rejects.toBe(
    'socket hang up\nPlugin check failed. Check your internet connection or retry later.'
  );
});

test('existsOnNpm() rejects malformed responses that do not include versions', async () => {
  const {api} = createCliHarness({gotVersions: undefined});

  await expect(api.existsOnNpm('plugin-without-versions')).rejects.toMatchObject({
    body: {versions: undefined}
  });
});

test('uninstall() removes installed plugins and rejects unknown plugins', async () => {
  const installedPluginHarness = createCliHarness({
    configData: {plugins: ['plugin-a', 'plugin-b'], localPlugins: []}
  });

  await installedPluginHarness.api.uninstall('plugin-a');
  expect(installedPluginHarness.state.savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-b'],
    localPlugins: []
  });

  const unknownPluginHarness = createCliHarness({
    configData: {plugins: ['plugin-a', 'plugin-b'], localPlugins: []}
  });
  await expect(unknownPluginHarness.api.uninstall('plugin-z')).rejects.toThrow('plugin-z is not installed');
});

test('exists(), list(), and isInstalled() handle empty or malformed plugin arrays', () => {
  const normalHarness = createCliHarness();
  expect(normalHarness.api.exists()).toBe(true);
  expect(normalHarness.api.list()).toBe(false);

  const malformedHarness = createCliHarness({
    configData: {
      plugins: {not: 'an-array'},
      localPlugins: []
    }
  });
  expect(malformedHarness.api.isInstalled('plugin-x')).toBe(false);
});

test('exists() returns false when config file is missing without reading config contents', () => {
  const {api, state} = createCliHarness({fsExistsSyncResult: false});

  expect(api.exists()).toBe(false);
  expect(state.fsReadFileSyncCallCount).toBe(0);
});

test.each([
  {label: 'prefers config.json5 in production', filename: 'config.json5'},
  {label: 'falls back to legacy hyper.json when config.json5 is absent', filename: 'hyper.json'}
])('configPath $label', ({filename}) => {
  const expectedPath = path.join('/tmp/velocetty-xdg', 'Hyper', filename);
  const {api} = createCliHarness({
    env: {
      NODE_ENV: 'production',
      XDG_CONFIG_HOME: '/tmp/velocetty-xdg'
    },
    existingPaths: new Set([expectedPath])
  });

  expect(api.configPath).toBe(expectedPath);
  expect(api.exists()).toBe(true);
});

test('createCliApi() keeps request and config state isolated per instance', async () => {
  const leftHarness = createCliHarness();
  const rightHarness = createCliHarness({
    configData: {plugins: ['plugin-beta'], localPlugins: ['local-beta']}
  });

  await Promise.all([leftHarness.api.install('plugin-alpha'), rightHarness.api.install('plugin-gamma')]);

  expect(leftHarness.state.requestedUrls).toEqual(['https://registry.npmjs.org/plugin-alpha']);
  expect(rightHarness.state.requestedUrls).toEqual(['https://registry.npmjs.org/plugin-gamma']);
  expect(leftHarness.state.savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-alpha'],
    localPlugins: []
  });
  expect(rightHarness.state.savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-beta', 'plugin-gamma'],
    localPlugins: ['local-beta']
  });
});
