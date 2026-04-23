/** @file Shared harness helpers for config-import unit tests. */
import {mock} from 'bun:test';

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {mkdirpSync, removeSync} from 'fs-extra';

import {createConfigImportModule, type ConfigImportPaths} from '../../app/config/import';

type ConfigInit = Parameters<typeof createConfigImportModule>[0]['_init'];

export type ConfigImportHarness = {
  _import: ReturnType<typeof createConfigImportModule>['_import'];
  getDefaultConfig: ReturnType<typeof createConfigImportModule>['getDefaultConfig'];
  cleanup: () => void;
  initMock: ReturnType<typeof mock<(userCfg: unknown, defaultCfg: unknown) => {userCfg: unknown; defaultCfg: unknown}>>;
  mockPaths: ConfigImportPaths;
  notifyMock: ReturnType<typeof mock<(_message: string) => void>>;
  warnMock: ReturnType<typeof mock<(_message?: unknown, ..._rest: unknown[]) => void>>;
  workspaceRoot: string;
};

export type ParsedDiagnosticsPayload = Readonly<{
  diagnostics: ReadonlyArray<Record<string, unknown>>;
}>;

export const sharedDefaultConfigFixture = `{
  config: { defaultProfile: 'default', profiles: [{ name: 'default', config: {} }] },
  plugins: [],
  localPlugins: [],
  keymaps: {}
}`;

export const ensureObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected object value.');
  }
  return value as Record<string, unknown>;
};

const isValidObject = (entry: unknown): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null;

const extractDiagnostics = (entry: Record<string, unknown>): unknown =>
  'diagnostics' in entry ? entry.diagnostics : null;

const isValidDiagnosticsArray = (diagnostics: unknown): diagnostics is Array<Record<string, unknown>> =>
  Array.isArray(diagnostics) && diagnostics.length > 0;

export const findDiagnosticsPayloadFromWarnMock = (
  warnMock: ReturnType<typeof mock<(_message?: unknown, ..._rest: unknown[]) => void>>
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
  cfgDir: join(workspaceRoot, 'user-config'),
  cfgPath: join(workspaceRoot, 'user-config', 'config.json5'),
  defaultCfg: join(workspaceRoot, 'defaults', 'config-default.json'),
  keybindingsPath: join(workspaceRoot, 'user-config', 'keybindings.json5'),
  defaultPlatformKeyPath: () => join(workspaceRoot, 'defaults', 'linux.json'),
  plugs: {
    base: join(workspaceRoot, 'user-config', 'plugins'),
    local: join(workspaceRoot, 'user-config', 'plugins', 'local')
  },
  schemaFile: 'schema.json',
  schemaPath: join(workspaceRoot, 'defaults', 'schema.json')
});

export const createConfigImportHarness = async (): Promise<ConfigImportHarness> => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'velocetty-config-import-'));
  const mockPaths = createMockPaths(workspaceRoot);
  const notifyMock = mock((_message: string) => {});
  const initMock = mock((userCfg: unknown, defaultCfg: unknown) => ({userCfg, defaultCfg}));
  const warnMock = mock((_message?: unknown, ..._rest: unknown[]) => {});
  let cleanupCalled = false;

  const cleanup = () => {
    if (cleanupCalled) {
      return;
    }
    cleanupCalled = true;
    removeSync(workspaceRoot);
  };

  try {
    mkdirpSync(join(workspaceRoot, 'defaults'));
    const configModule = createConfigImportModule({
      _init: initMock as ConfigInit,
      notify: notifyMock as typeof import('../../app/notify').default,
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
