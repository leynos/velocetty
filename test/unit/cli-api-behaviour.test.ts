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

type GotRequestOptions = {
  readonly responseType?: string;
  readonly signal?: AbortSignal;
  readonly timeout?: {
    readonly request?: number;
  };
};

type CliHarnessOptions = {
  readonly appData?: string;
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
  readonly homeDirectory?: string;
  readonly moduleDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly registryUrl?: string;
};

type CliHarnessState = {
  configData: ConfigData;
  existingPaths: Set<string> | null;
  fsExistsSyncResult: boolean;
  fsReadFileSyncCallCount: number;
  fsReadFileSyncValue: unknown;
  gotError: GotError | null;
  gotOptions: GotRequestOptions[];
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

const buildFsModule = (state: CliHarnessState) => ({
  existsSync: (candidatePath: unknown) => {
    if (state.existingPaths) {
      return typeof candidatePath === 'string' && state.existingPaths.has(candidatePath);
    }
    return state.fsExistsSyncResult;
  },
  readFileSync: () => {
    state.fsReadFileSyncCallCount += 1;
    return state.hasReadFileSyncOverride ? state.fsReadFileSyncValue : JSON.stringify(state.configData);
  },
  writeFileSync: (_path: unknown, contents: string) => {
    const parsed = JSON5.parse(contents) as ConfigData;
    state.savedConfigs.push(parsed);
    state.configData = parsed;
  }
});

const buildGotClient = (state: CliHarnessState) => ({
  get: (url: string, requestOptions?: GotRequestOptions) => {
    state.requestedUrls.push(url);
    if (requestOptions) {
      state.gotOptions.push(requestOptions);
    }
    if (state.gotError) {
      return Promise.reject(state.gotError);
    }
    return Promise.resolve({body: {versions: state.gotVersions}});
  }
});

const createCliHarness = (options: CliHarnessOptions = {}): CliHarness => {
  const state: CliHarnessState = {
    configData: options.configData ?? {plugins: [], localPlugins: []},
    existingPaths: options.existingPaths ?? null,
    fsExistsSyncResult: options.fsExistsSyncResult ?? true,
    fsReadFileSyncCallCount: 0,
    fsReadFileSyncValue: options.fsReadFileSyncValue,
    gotError: options.gotError ?? null,
    gotOptions: [],
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
    fsModule: buildFsModule(state),
    gotClient: buildGotClient(state),
    appData: options.appData,
    homeDirectory: options.homeDirectory,
    moduleDirectory: options.moduleDirectory ?? CLI_DIRECTORY,
    platform: options.platform,
    registryUrl: options.registryUrl ?? 'https://registry.npmjs.org/'
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
  const controller = new AbortController();

  await api.install('plugin-alpha', {signal: controller.signal});

  expect(state.requestedUrls).toEqual(['https://registry.npmjs.org/plugin-alpha']);
  expect(state.gotOptions[0]).toMatchObject({
    signal: controller.signal,
    timeout: {request: 10000}
  });
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

test('existsOnNpm() joins registry URLs with path segments safely', async () => {
  const {api, state} = createCliHarness({
    registryUrl: 'https://registry.npmjs.org/custom/segment'
  });

  await api.existsOnNpm('plugin-alpha');

  expect(state.requestedUrls).toEqual(['https://registry.npmjs.org/custom/segment/plugin-alpha']);
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

test('uninstall() removes locally installed plugins', async () => {
  const installedPluginHarness = createCliHarness({
    configData: {plugins: ['plugin-a'], localPlugins: ['plugin-local']}
  });

  await installedPluginHarness.api.uninstall('plugin-local');

  expect(installedPluginHarness.state.savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-a'],
    localPlugins: []
  });
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

test.each([
  {label: 'prefers dev config.json5 when present', filename: 'config.json5'},
  {label: 'falls back to dev legacy hyper.json when config.json5 is absent', filename: 'hyper.json'}
])('configPath $label outside production uses the module-relative development file', ({filename}) => {
  const moduleDirectory = '/tmp/velocetty-module/cli';
  const expectedPath = path.join(moduleDirectory, '..', filename);
  const {api} = createCliHarness({
    env: {
      NODE_ENV: 'development'
    },
    existingPaths: new Set([expectedPath]),
    moduleDirectory
  });

  expect(api.configPath).toBe(expectedPath);
  expect(api.exists()).toBe(true);
});

test('configPath uses APPDATA for Windows production resolution when provided', () => {
  const appData = 'C:\\Users\\alice\\AppData\\Roaming';
  const expectedPath = path.win32.join(appData, 'Hyper', 'config.json5');
  const {api} = createCliHarness({
    appData,
    env: {
      NODE_ENV: 'production'
    },
    existingPaths: new Set([expectedPath]),
    homeDirectory: 'C:\\Users\\alice',
    platform: 'win32'
  });

  expect(api.configPath).toBe(expectedPath);
  expect(api.exists()).toBe(true);
});

test('configPath falls back to the home-directory APPDATA path on Windows', () => {
  const homeDirectory = 'C:\\Users\\bob';
  const inferredAppData = path.win32.join(homeDirectory, 'AppData', 'Roaming');
  const expectedPath = path.win32.join(inferredAppData, 'Hyper', 'hyper.json');
  const {api} = createCliHarness({
    env: {
      NODE_ENV: 'production'
    },
    existingPaths: new Set([expectedPath]),
    homeDirectory,
    platform: 'win32'
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
