/** @file Validates snapshot bootstrap behaviour for bundler-agnostic runtime require. */
import {afterEach, expect, test} from 'bun:test';

type SnapshotResultShape = {
  customRequire: {
    (moduleName: string): unknown;
    cache: Record<string, {exports: unknown}>;
    definitions: Record<string, unknown>;
  };
  setGlobals: (...args: unknown[]) => void;
};

type ModuleContainer = {
  _load: (moduleName: string) => unknown;
};

const globalHost = globalThis as typeof globalThis & {
  snapshotResult?: SnapshotResultShape;
  require?: (moduleName: string) => unknown;
  document?: Document;
  window?: Window & {
    require?: (moduleName: string) => unknown;
  };
};

let importSuffix = 0;

const cleanupGlobals = () => {
  delete globalHost.snapshotResult;
  delete globalHost.require;
  delete globalHost.document;
  delete globalHost.window;
};

const createModuleContainer = (): ModuleContainer => {
  return {
    _load: (moduleName: string) => ({native: moduleName})
  };
};

const createRuntimeRequire = (moduleContainer: ModuleContainer) => {
  return (moduleName: string) => {
    if (moduleName === 'module') {
      return moduleContainer;
    }
    throw new Error(`Unexpected module request: ${moduleName}`);
  };
};

const createSnapshotResult = (
  definitions: Record<string, unknown>,
  setGlobalsCalls: unknown[][]
): SnapshotResultShape => {
  return {
    customRequire: Object.assign(
      (moduleName: string) => {
        return `custom:${moduleName}`;
      },
      {
        cache: {} as Record<string, {exports: unknown}>,
        definitions
      }
    ),
    setGlobals: (...args: unknown[]) => {
      setGlobalsCalls.push(args);
    }
  };
};

const setupSnapshotGlobals = ({
  snapshotResult,
  globalRequire,
  windowRequire
}: {
  snapshotResult?: SnapshotResultShape;
  globalRequire?: (moduleName: string) => unknown;
  windowRequire?: (moduleName: string) => unknown;
}) => {
  if (globalRequire) {
    globalHost.require = globalRequire;
  }
  globalHost.window = {
    require: windowRequire
  } as Window & {require?: (moduleName: string) => unknown};
  globalHost.document = {} as Document;
  if (snapshotResult) {
    globalHost.snapshotResult = snapshotResult;
  }
};

const importSnapshotUtil = async (testCase: string) => {
  importSuffix += 1;
  return import(`../../lib/v8-snapshot-util.ts?${testCase}_${importSuffix}`);
};

afterEach(() => {
  cleanupGlobals();
});

test('uses runtime require and snapshot cache/definitions when available', async () => {
  const moduleContainer = createModuleContainer();
  const runtimeRequire = createRuntimeRequire(moduleContainer);
  const setGlobalsCalls: unknown[][] = [];
  const snapshotResult = createSnapshotResult({'virtual:plugin': {}}, setGlobalsCalls);

  setupSnapshotGlobals({
    snapshotResult,
    globalRequire: runtimeRequire
  });

  await importSnapshotUtil('bootstrap_case');

  const loadedVirtualModule = moduleContainer._load('virtual:plugin');
  const loadedNativeModule = moduleContainer._load('native:module');

  expect(loadedVirtualModule).toBe('custom:virtual:plugin');
  expect(loadedNativeModule).toEqual({native: 'native:module'});
  expect(snapshotResult.customRequire.cache['virtual:plugin']).toEqual({
    exports: 'custom:virtual:plugin'
  });
  expect(setGlobalsCalls).toHaveLength(1);
  expect(setGlobalsCalls[0].at(-1)).toBe(runtimeRequire);
});

test('falls back to window.require when global require is unavailable', async () => {
  const moduleContainer = createModuleContainer();
  const windowRequire = createRuntimeRequire(moduleContainer);
  const setGlobalsCalls: unknown[][] = [];
  const snapshotResult = createSnapshotResult({'virtual:renderer': {}}, setGlobalsCalls);

  setupSnapshotGlobals({
    snapshotResult,
    windowRequire
  });

  await importSnapshotUtil('window_require_case');

  const loadedVirtualModule = moduleContainer._load('virtual:renderer');
  const loadedNativeModule = moduleContainer._load('native:module');

  expect(loadedVirtualModule).toBe('custom:virtual:renderer');
  expect(loadedNativeModule).toEqual({native: 'native:module'});
  expect(snapshotResult.customRequire.cache['virtual:renderer']).toEqual({
    exports: 'custom:virtual:renderer'
  });
  expect(setGlobalsCalls).toHaveLength(1);
  expect(setGlobalsCalls[0].at(-1)).toBe(windowRequire);
});

test('throws when snapshot bootstrap cannot find runtime require', async () => {
  setupSnapshotGlobals({
    snapshotResult: {
      customRequire: Object.assign(
        (_moduleName: string) => {
          return null;
        },
        {
          cache: {},
          definitions: {}
        }
      ),
      setGlobals: () => {}
    }
  });

  await expect(importSnapshotUtil('missing_require_case')).rejects.toThrow(
    'Expected a Node-compatible require function for snapshot initialization.'
  );
});

test('no-ops when snapshotResult is unavailable', async () => {
  globalHost.require = (_moduleName: string) => {
    throw new Error('runtime require should not be called without snapshotResult');
  };

  await expect(importSnapshotUtil('no_snapshot_result')).resolves.toBeDefined();
});
