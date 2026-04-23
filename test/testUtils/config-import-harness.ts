/** @file Shared harness helpers for config-import unit tests. */
import {mock} from 'bun:test';

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {mkdirpSync, removeSync} from 'fs-extra';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';
import {isString} from '@shared/types/guards';

import {createConfigImportModule, type ConfigImportPaths} from '../../app/config/import';
import {_init} from '../../app/config/init';
import type {configValidationDiagnostic} from '@shared/types/config';

type ConfigInit = Parameters<typeof createConfigImportModule>[0]['_init'];
type ConfigNotify = Parameters<typeof createConfigImportModule>[0]['notify'];

export type ConfigImportHarness = {
  _import: ReturnType<typeof createConfigImportModule>['_import'];
  getDefaultConfig: ReturnType<typeof createConfigImportModule>['getDefaultConfig'];
  cleanup: () => void;
  initMock: ReturnType<typeof mock<ConfigInit>>;
  mockPaths: ConfigImportPaths;
  notifyMock: ReturnType<typeof mock<ConfigNotify>>;
  warnMock: ReturnType<typeof mock<(_message?: string, ..._rest: Error[]) => void>>;
  workspaceRoot: string;
};

export const ensureObject = (value: unknown): JsonObject => {
  if (!isJsonObject(value)) {
    throw new Error('Expected object value.');
  }
  return value;
};

export type ParsedDiagnosticsPayload = Readonly<{
  diagnostics: ReadonlyArray<configValidationDiagnostic>;
}>;

const isValidObject = isJsonObject;

const extractDiagnostics = (entry: JsonObject) => ('diagnostics' in entry ? entry.diagnostics : null);

const isConfigValidationDiagnostic = (value: JsonValue): value is JsonObject & configValidationDiagnostic =>
  isJsonObject(value) &&
  isString(value.path) &&
  isString(value.message) &&
  isString(value.suggestedFix) &&
  (value.docHint === undefined || isString(value.docHint)) &&
  (value.defaultHint === undefined || isString(value.defaultHint));

const isValidDiagnosticsArray = (diagnostics: JsonValue): diagnostics is configValidationDiagnostic[] =>
  Array.isArray(diagnostics) &&
  diagnostics.length > 0 &&
  diagnostics.every((entry) => isConfigValidationDiagnostic(entry));

export const findDiagnosticsPayloadFromWarnMock = (
  warnMock: ReturnType<typeof mock<(_message?: string, ..._rest: Error[]) => void>>
): ParsedDiagnosticsPayload => {
  for (const call of warnMock.mock.calls) {
    for (const entry of call) {
      if (!isValidObject(entry)) {
        continue;
      }
      const diagnostics = extractDiagnostics(entry);
      if (!isValidDiagnosticsArray(diagnostics)) {
        continue;
      }
      return {diagnostics};
    }
  }

  throw new Error('Expected a structured diagnostics payload in warning logs.');
};

const createMockPaths = (workspaceRoot: string): ConfigImportPaths => ({
  cfgDir: path.join(workspaceRoot, 'user-config'),
  cfgPath: path.join(workspaceRoot, 'user-config', 'config.json5'),
  defaultCfg: path.join(workspaceRoot, 'defaults', 'config-default.json'),
  keybindingsPath: path.join(workspaceRoot, 'user-config', 'keybindings.json5'),
  defaultPlatformKeyPath: () => path.join(workspaceRoot, 'defaults', 'linux.json'),
  plugs: {
    base: path.join(workspaceRoot, 'user-config', 'plugins'),
    local: path.join(workspaceRoot, 'user-config', 'plugins', 'local')
  },
  schemaFile: 'schema.json',
  schemaPath: path.join(workspaceRoot, 'defaults', 'schema.json')
});

export const createConfigImportHarness = async (): Promise<ConfigImportHarness> => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'velocetty-config-import-'));
  const mockPaths = createMockPaths(workspaceRoot);
  const notifyMock = mock<ConfigNotify>(() => {});
  const initMock = mock<ConfigInit>((userCfg, defaultCfg, notify) => _init(userCfg, defaultCfg, notify));
  const warnMock = mock((_message?: string, ..._rest: Error[]) => {});
  let cleanupCalled = false;

  const cleanup = () => {
    if (cleanupCalled) {
      return;
    }
    cleanupCalled = true;
    // Do not call mock.restore() — this harness uses no mock.module()
    // registrations. A global restore would tear down module mocks from
    // other suites running concurrently and cause nondeterministic failures.
    removeSync(workspaceRoot);
  };

  try {
    mkdirpSync(path.join(workspaceRoot, 'defaults'));
    const configModule = createConfigImportModule({
      _init: initMock,
      notify: notifyMock,
      paths: mockPaths,
      warn: warnMock
    });

    return {
      _import: configModule._import,
      getDefaultConfig: configModule.getDefaultConfig,
      cleanup,
      initMock,
      mockPaths,
      notifyMock,
      warnMock,
      workspaceRoot
    };
  } catch (error) {
    cleanup();
    throw error;
  }
};

export const sharedDefaultConfigFixture = `{
  config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
  plugins: [],
  localPlugins: [],
  keymaps: {}
}`;
