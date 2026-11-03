/** @file Shared harness helpers for config-import unit tests. */
import {mock} from 'bun:test';

import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {mkdirpSync, removeSync} from 'fs-extra';
import {isJsonObject, type JsonObject, type JsonValue} from '@shared/types/json';
import {isString} from '@shared/types/guards';

import {createConfigImportModule, type ConfigImportKeybindings, type ConfigImportPaths} from '../../app/config/import';
import {_init} from '../../app/config/init';
import {createKeybindingsService} from '../../app/config/keybindings';
import {keybindingsCodec} from '../../app/config/keybindings-codec';
import {createKeybindingsNotifier} from '../../app/config/keybindings-notifier';
import {createFileKeybindingsStore} from '../../app/config/keybindings-store';
import type {ConfigImportFileSystem} from '../../app/config/import-sources';
import type {configValidationDiagnostic} from '@shared/types/config';

type ConfigInit = Parameters<typeof createConfigImportModule>[0]['_init'];
type ConfigNotify = Parameters<typeof createConfigImportModule>[0]['notify'];

export type ConfigImportHarness = {
  _import: ReturnType<typeof createConfigImportModule>['_import'];
  getDefaultConfig: ReturnType<typeof createConfigImportModule>['getDefaultConfig'];
  cleanup: () => void;
  initMock: ReturnType<typeof mock<ConfigInit>>;
  /** The service the importer drives: the real one, or an injected double. */
  keybindings: ConfigImportKeybindings;
  mockPaths: ConfigImportPaths;
  notifyMock: ReturnType<typeof mock<ConfigNotify>>;
  warnMock: ReturnType<typeof mock<(_message?: string, ..._rest: Error[]) => void>>;
  workspaceRoot: string;
};

/** Narrows a fixture value to a JSON object, failing the test rather than returning a bad shape. */
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

/** Reads the `diagnostics` field from a logged entry, or null when the entry is not a payload. */
const extractDiagnostics = (entry: JsonObject) => ('diagnostics' in entry ? entry.diagnostics : null);

/** Guards that a logged value carries the fields every validation diagnostic must expose. */
const isConfigValidationDiagnostic = (value: JsonValue): value is JsonObject & configValidationDiagnostic =>
  isJsonObject(value) &&
  isString(value.path) &&
  isString(value.message) &&
  isString(value.suggestedFix) &&
  (value.docHint === undefined || isString(value.docHint)) &&
  (value.defaultHint === undefined || isString(value.defaultHint));

/** Requires a non-empty array of well-formed diagnostics, so an empty payload is not a hit. */
const isValidDiagnosticsArray = (diagnostics: JsonValue): diagnostics is configValidationDiagnostic[] =>
  Array.isArray(diagnostics) &&
  diagnostics.length > 0 &&
  diagnostics.every((entry) => isConfigValidationDiagnostic(entry));

/** Finds the structured diagnostics payload among recorded warnings, throwing when none appears. */
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
  /**
   * Models a store whose writes always fail, so the importer sees an unsaved
   * seed rather than a completed migration.
   */
  readonly failSeedWrite?: boolean;
  /**
   * Replaces the loader's filesystem functions. A recording double lets a test
   * prove the default-config query performs no writes.
   */
  /**
   * Replaces the loader's error sink, so a test can observe a refused schema
   * copy without writing to the test runner's own standard error.
   */
  readonly error?: typeof console.error;
  readonly fs?: ConfigImportFileSystem;
  /**
   * Replaces the keybindings service, so a test can repeat one outcome across
   * imports and prove the notice guards, not the service, suppress repeats.
   */
  readonly keybindings?: ConfigImportKeybindings;
  /**
   * Lower-priority config files the active tree hides. Supplying one lets a
   * test observe the shadowed-copy notice, which is silent when empty.
   */
  readonly shadowedConfigPaths?: readonly string[];
};

/** Lays out the path map for an isolated workspace, modelling either tree the importer supports. */
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
    shadowedConfigPaths: options.shadowedConfigPaths ?? [],
    velocettyDir
  };
};

/** Captures `config.json5` bytes so a reload can be proved to leave them untouched. */
export const snapshotConfigBytes = (mockPaths: ConfigImportPaths): Buffer => readFileSync(mockPaths.cfgPath);

/** Whether `config.json5` still holds the bytes captured by {@link snapshotConfigBytes}. */
export const configBytesUnchanged = (mockPaths: ConfigImportPaths, before: Buffer): boolean =>
  readFileSync(mockPaths.cfgPath).equals(before);

/** Builds an isolated import module over a temporary workspace so a test can drive it safely. */
export const createConfigImportHarness = async (
  options: ConfigImportHarnessOptions = {}
): Promise<ConfigImportHarness> => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'velocetty-config-import-'));
  const mockPaths = createMockPaths(workspaceRoot, options);
  const notifyMock = mock<ConfigNotify>(() => {});
  const initMock = mock<ConfigInit>((userCfg, defaultCfg, notify) => _init(userCfg, defaultCfg, notify));
  const warnMock = mock((_message?: string, ..._rest: Error[]) => {});
  let cleanupCalled = false;

  /** Removes the temporary workspace once; repeat calls are no-ops for shared fixtures. */
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
    const fileStore = createFileKeybindingsStore({filePath: mockPaths.keybindingsPath, warn: warnMock});
    const store =
      options.failSeedWrite === true
        ? {...fileStore, write: () => ({failure: 'other' as const, kind: 'failed' as const})}
        : fileStore;
    const keybindings =
      options.keybindings ??
      createKeybindingsService({
        codec: keybindingsCodec,
        report: createKeybindingsNotifier(notifyMock, warnMock),
        store
      });
    const configDependencies = {
      _init: initMock,
      keybindings,
      notify: notifyMock,
      paths: mockPaths,
      warn: warnMock
    };
    if (options.error !== undefined) {
      Object.assign(configDependencies, {error: options.error});
    }
    if (options.fs !== undefined) {
      Object.assign(configDependencies, {fs: options.fs});
    }
    const configModule = createConfigImportModule(configDependencies);

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
