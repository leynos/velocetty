/** @file Covers install, uninstall, and listing branches in CLI plugin APIs. */
import {afterAll, beforeEach, expect, mock, test} from 'bun:test';

import JSON5 from 'json5';
import type {PathLike} from 'node:fs';
import path from 'node:path';

import {buildNodeFsModuleMock} from '../testUtils/mock-node-fs';

type ConfigData = {
  plugins: unknown;
  localPlugins: unknown;
};

type GotError = {
  statusCode?: number;
  message: string;
};

let importIndex = 0;
let configData: ConfigData = {plugins: [], localPlugins: []};
let savedConfigs: ConfigData[] = [];
let requestedUrls: string[] = [];
let gotError: GotError | null = null;
let gotVersions: unknown = ['1.0.0'];
let fsExistsSyncResult = true;
let fsReadFileSyncValue: unknown;
let hasReadFileSyncOverride = false;
let fsReadFileSyncCallCount = 0;
let existingPaths: Set<string> | null = null;

const fsMock = {
  existsSync: (candidatePath: PathLike) => {
    if (existingPaths) {
      return typeof candidatePath === 'string' && existingPaths.has(candidatePath);
    }
    return fsExistsSyncResult;
  },
  // Assumes cli/api only reads the single config file under test.
  readFileSync: () => {
    fsReadFileSyncCallCount += 1;
    return hasReadFileSyncOverride ? fsReadFileSyncValue : JSON.stringify(configData);
  },
  writeFileSync: (_path: string, contents: string) => {
    const parsed = JSON5.parse(contents) as ConfigData;
    savedConfigs.push(parsed);
    configData = parsed;
  }
};

const gotMock = {
  get: (url: string) => {
    requestedUrls.push(url);
    if (gotError) {
      return Promise.reject(gotError);
    }
    return Promise.resolve({body: {versions: gotVersions}});
  }
};

mock.module('node:fs', () =>
  buildNodeFsModuleMock({
    existsSync: fsMock.existsSync,
    readFileSync: fsMock.readFileSync,
    writeFileSync: fsMock.writeFileSync
  })
);

mock.module('registry-url', () => ({default: () => 'https://registry.npmjs.org/'}));
mock.module('got', () => ({default: gotMock}));

const loadCliApi = async () => {
  importIndex += 1;
  // Query-string cache busting forces a fresh module instance per test in Bun.
  return await import(`../../cli/api.ts?coverage_case=${importIndex}`);
};

const originalNodeEnv = process.env.NODE_ENV;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const restoreEnvVar = (key: 'NODE_ENV' | 'XDG_CONFIG_HOME', value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

beforeEach(() => {
  configData = {plugins: [], localPlugins: []};
  savedConfigs = [];
  requestedUrls = [];
  gotError = null;
  gotVersions = ['1.0.0'];
  fsExistsSyncResult = true;
  hasReadFileSyncOverride = false;
  fsReadFileSyncValue = undefined;
  fsReadFileSyncCallCount = 0;
  existingPaths = null;
  restoreEnvVar('NODE_ENV', originalNodeEnv);
  restoreEnvVar('XDG_CONFIG_HOME', originalXdgConfigHome);
});

afterAll(() => {
  restoreEnvVar('NODE_ENV', originalNodeEnv);
  restoreEnvVar('XDG_CONFIG_HOME', originalXdgConfigHome);
});

test('list() and isInstalled() read configured plugin state', async () => {
  configData = {plugins: ['plugin-alpha', 'plugin-beta'], localPlugins: ['local-alpha']};
  const {list, isInstalled} = await loadCliApi();

  expect(list()).toBe('plugin-alpha\nplugin-beta');
  expect(isInstalled('plugin-beta')).toBe(true);
  expect(isInstalled('local-alpha', true)).toBe(true);
});

test('list() accepts JSON5 plugin config with comments and trailing commas', async () => {
  hasReadFileSyncOverride = true;
  fsReadFileSyncValue = `{
    // plugin sources
    plugins: ['plugin-alpha',],
    localPlugins: ['local-alpha',],
  }`;
  const {list, isInstalled} = await loadCliApi();

  expect(list()).toBe('plugin-alpha');
  expect(isInstalled('plugin-alpha')).toBe(true);
  expect(isInstalled('local-alpha', true)).toBe(true);
});

test('install() persists plugin entries from npm checks', async () => {
  const {install} = await loadCliApi();

  await install('plugin-alpha');

  expect(requestedUrls).toEqual(['https://registry.npmjs.org/plugin-alpha']);
  expect(savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-alpha'],
    localPlugins: []
  });
});

test('install() persists local plugin entries when local install is requested', async () => {
  const {install} = await loadCliApi();

  await install('local-plugin', {locally: true});

  expect(requestedUrls).toEqual(['https://registry.npmjs.org/local-plugin']);
  expect(savedConfigs.at(-1)).toEqual({
    plugins: [],
    localPlugins: ['local-plugin']
  });
});

test('install() rejects duplicate local plugins that already exist in config', async () => {
  configData = {plugins: [], localPlugins: ['local-plugin']};
  const {install} = await loadCliApi();

  await expect(install('local-plugin', {locally: true})).rejects.toBe('local-plugin is already installed');
});

test('install() maps npm and transport errors to stable user-facing messages', async () => {
  const {install} = await loadCliApi();

  gotError = {statusCode: 404, message: 'Not found'};
  await expect(install('missing-plugin')).rejects.toBe('missing-plugin not found on npm');

  // gotMock reads this mutable binding at call time for the second install path.
  gotError = {message: 'socket hang up'};
  await expect(install('unstable-plugin')).rejects.toBe(
    'socket hang up\nPlugin check failed. Check your internet connection or retry later.'
  );
});

test('existsOnNpm() rejects malformed responses that do not include versions', async () => {
  const {existsOnNpm} = await loadCliApi();

  gotVersions = undefined;
  await expect(existsOnNpm('plugin-without-versions')).rejects.toMatchObject({
    body: {versions: undefined}
  });
});

test('uninstall() removes installed plugins and rejects unknown plugins', async () => {
  configData = {plugins: ['plugin-a', 'plugin-b'], localPlugins: []};
  const {uninstall} = await loadCliApi();

  await uninstall('plugin-a');
  expect(savedConfigs.at(-1)).toEqual({
    plugins: ['plugin-b'],
    localPlugins: []
  });

  await expect(uninstall('plugin-z')).rejects.toThrow('plugin-z is not installed');
});

test('exists(), list(), and isInstalled() handle empty or malformed plugin arrays', async () => {
  const normalApi = await loadCliApi();
  // exists() checks readable config presence; list() checks populated plugin entries.
  expect(normalApi.exists()).toBe(true);
  expect(normalApi.list()).toBe(false);

  configData = {
    plugins: {not: 'an-array'},
    localPlugins: []
  };
  const malformedApi = await loadCliApi();
  expect(malformedApi.isInstalled('plugin-x')).toBe(false);
});

test('exists() returns false when config file is missing without reading config contents', async () => {
  fsExistsSyncResult = false;
  const {exists} = await loadCliApi();

  expect(exists()).toBe(false);
  expect(fsReadFileSyncCallCount).toBe(0);
});

test('configPath prefers config.json5 in production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.XDG_CONFIG_HOME = '/tmp/velocetty-xdg';
  const expectedConfigPath = path.join('/tmp/velocetty-xdg', 'Hyper', 'config.json5');
  existingPaths = new Set([expectedConfigPath]);

  const {configPath, exists} = await loadCliApi();

  expect(configPath).toBe(expectedConfigPath);
  expect(exists()).toBe(true);
});

test('configPath falls back to legacy hyper.json when config.json5 is absent', async () => {
  process.env.NODE_ENV = 'production';
  process.env.XDG_CONFIG_HOME = '/tmp/velocetty-xdg';
  const legacyPath = path.join('/tmp/velocetty-xdg', 'Hyper', 'hyper.json');
  existingPaths = new Set([legacyPath]);

  const {configPath, exists} = await loadCliApi();

  expect(configPath).toBe(legacyPath);
  expect(exists()).toBe(true);
});

test('node:fs mock preserves passthrough exports required by other suites', async () => {
  const fsModule = await import('node:fs');
  expect(typeof fsModule.realpathSync).toBe('function');
});
