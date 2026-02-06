/** @file Covers install, uninstall, and listing branches in CLI plugin APIs. */
import {beforeEach, expect, mock, test} from 'bun:test';

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

const fsMock = {
  existsSync: () => fsExistsSyncResult,
  // Assumes cli/api only reads the single config file under test.
  readFileSync: () => (hasReadFileSyncOverride ? fsReadFileSyncValue : JSON.stringify(configData)),
  writeFileSync: (_path: string, contents: string) => {
    const parsed = JSON.parse(contents) as ConfigData;
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

beforeEach(() => {
  configData = {plugins: [], localPlugins: []};
  savedConfigs = [];
  requestedUrls = [];
  gotError = null;
  gotVersions = ['1.0.0'];
  fsExistsSyncResult = true;
  hasReadFileSyncOverride = false;
  fsReadFileSyncValue = undefined;
});

test('list() and isInstalled() read configured plugin state', async () => {
  configData = {plugins: ['plugin-alpha', 'plugin-beta'], localPlugins: ['local-alpha']};
  const {list, isInstalled} = await loadCliApi();

  expect(list()).toBe('plugin-alpha\nplugin-beta');
  expect(isInstalled('plugin-beta')).toBe(true);
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

  await install('local-plugin', true);

  expect(requestedUrls).toEqual(['https://registry.npmjs.org/local-plugin']);
  expect(savedConfigs.at(-1)).toEqual({
    plugins: [],
    localPlugins: ['local-plugin']
  });
});

test('install() rejects duplicate local plugins that already exist in config', async () => {
  configData = {plugins: [], localPlugins: ['local-plugin']};
  const {install} = await loadCliApi();

  await expect(install('local-plugin', true)).rejects.toBe('local-plugin is already installed');
});

test('install() maps npm and transport errors to stable user-facing messages', async () => {
  const {install} = await loadCliApi();

  gotError = {statusCode: 404, message: 'Not found'};
  await expect(install('missing-plugin')).rejects.toBe('missing-plugin not found on npm');

  gotError = {message: 'socket hang up'};
  await expect(install('unstable-plugin')).rejects.toBe(
    'socket hang up\nPlugin check failed. Check your internet connection or retry later.'
  );
});

test('existsOnNpm() rejects malformed responses that do not include versions', async () => {
  const {existsOnNpm} = await loadCliApi();

  gotVersions = undefined;
  await expect(existsOnNpm('plugin-without-versions')).rejects.toMatchObject({
    body: {}
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

  await expect(uninstall('plugin-z')).rejects.toBe('plugin-z is not installed');
});

test('exists(), list(), and isInstalled() handle empty or malformed plugin arrays', async () => {
  const normalApi = await loadCliApi();
  expect(normalApi.exists()).toBe(true);
  expect(normalApi.list()).toBe(false);

  configData = {
    plugins: {not: 'an-array'},
    localPlugins: []
  };
  const malformedApi = await loadCliApi();
  expect(malformedApi.isInstalled('plugin-x')).toBe(false);
});

test('exists() returns false when config reading yields undefined', async () => {
  hasReadFileSyncOverride = true;
  fsReadFileSyncValue = undefined;
  const {exists} = await loadCliApi();
  expect(exists()).toBe(false);
});

test('node:fs mock preserves passthrough exports required by other suites', async () => {
  const fsModule = await import('node:fs');
  expect(typeof fsModule.realpathSync).toBe('function');
});
