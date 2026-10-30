/** @file Shared harness helpers for config-import unit tests. */
import {mock} from 'bun:test';

import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {mkdirpSync, removeSync} from 'fs-extra';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';
import {isString} from '@shared/types/guards';

import {createConfigImportModule, type ConfigImportPaths} from '../../app/config/import';
import {_init} from '../../app/config/init';
import {createKeybindingsService} from '../../app/config/keybindings';
import {createFileKeybindingsStore} from '../../app/config/keybindings-store';
import type {configValidationDiagnostic} from '@shared/types/config';

type ConfigInit = Parameters<typeof createConfigImportModule>[0]['_init'];
type ConfigNotify = Parameters<typeof createConfigImportModule>[0]['notify'];

export type ConfigImportHarness = {
  _import: ReturnType<typeof createConfigImportModule>['_import'];
  getDefaultConfig: ReturnType<typeof createConfigImportModule>['getDefaultConfig'];
  cleanup: () => void;
  initMock: ReturnType<typeof mock<ConfigInit>>;
  /** The real service the importer drives, over a real temporary directory. */
  keybindings: ReturnType<typeof createKeybindingsService>;
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

/** How the harness lays out the configuration trees. */
export type ConfigImportHarnessOptions = {
  /**
   * Model an active Hyper tree: `config.json5` lives outside the Velocetty
   * tree, which owns `keybindings.json5` and every new file.
   */
  readonly hyperTree?: boolean;
};

const createMockPaths = (workspaceRoot: string, options: ConfigImportHarnessOptions): ConfigImportPaths => {
  const velocettyDir = path.join(workspaceRoot, options.hyperTree ? 'velocetty' : 'user-config');
  const userConfigDir = options.hyperTree ? path.join(workspaceRoot, 'hyper') : velocettyDir;
  return {
    cfgDir: userConfigDir,
    cfgPath: path.join(userConfigDir, 'config.json5'),
    defaultCfg: path.join(workspaceRoot, 'defaults', 'config-default.json'),
    keybindingsDir: velocettyDir,
    keybindingsPath: path.join(velocettyDir, 'keybindings.json5'),
    keybindingsSchemaFile: 'keybindings.schema.json',
    keybindingsSchemaPath: path.join(workspaceRoot, 'defaults', 'keybindings.schema.json'),
    defaultPlatformKeyPath: () => path.join(workspaceRoot, 'defaults', 'linux.json'),
    plugs: {
      base: path.join(userConfigDir, 'plugins'),
      local: path.join(userConfigDir, 'plugins', 'local')
    },
    schemaFile: 'schema.json',
    schemaPath: path.join(workspaceRoot, 'defaults', 'schema.json'),
    shadowedConfigPaths: [],
    velocettyDir
  };
};

/** Captures `config.json5` bytes so a reload can be proved to leave them untouched. */
export const snapshotConfigBytes = (mockPaths: ConfigImportPaths): Buffer => readFileSync(mockPaths.cfgPath);

/** Whether `config.json5` still holds the bytes captured by {@link snapshotConfigBytes}. */
export const configBytesUnchanged = (mockPaths: ConfigImportPaths, before: Buffer): boolean =>
  readFileSync(mockPaths.cfgPath).equals(before);

export const createConfigImportHarness = async (
  options: ConfigImportHarnessOptions = {}
): Promise<ConfigImportHarness> => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'velocetty-config-import-'));
  const mockPaths = createMockPaths(workspaceRoot, options);
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
    // The composition root creates the Velocetty tree before importing, so the
    // seed write has somewhere to land even when the active tree is Hyper's.
    mkdirpSync(mockPaths.velocettyDir);
    // Both schemas are bundled with the application, so the harness supplies
    // both; a missing one would make every import report a copy failure.
    writeFileSync(mockPaths.keybindingsSchemaPath, '{"title":"keybindings-schema"}', 'utf8');
    const store = createFileKeybindingsStore({filePath: mockPaths.keybindingsPath, warn: warnMock});
    const keybindings = createKeybindingsService({notify: notifyMock, store, warn: warnMock});
    const configModule = createConfigImportModule({
      _init: initMock,
      keybindings,
      notify: notifyMock,
      paths: mockPaths,
      warn: warnMock
    });

    return {
      _import: configModule._import,
      getDefaultConfig: configModule.getDefaultConfig,
      cleanup,
      initMock,
      keybindings,
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
