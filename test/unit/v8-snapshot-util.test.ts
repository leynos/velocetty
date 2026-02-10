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

const globalHost = globalThis as typeof globalThis & {
  snapshotResult?: SnapshotResultShape;
  require?: (moduleName: string) => unknown;
  document?: Document;
  window?: Window & {
    require?: (moduleName: string) => unknown;
  };
};

const cleanupGlobals = () => {
  delete globalHost.snapshotResult;
  delete globalHost.require;
  delete globalHost.document;
  delete globalHost.window;
};

afterEach(() => {
  cleanupGlobals();
});

test('uses runtime require and snapshot cache/definitions when available', async () => {
  const moduleContainer = {
    _load: (moduleName: string) => ({native: moduleName})
  };
  const runtimeRequire = (moduleName: string) => {
    if (moduleName === 'module') {
      return moduleContainer;
    }
    throw new Error(`Unexpected module request: ${moduleName}`);
  };

  const setGlobalsCalls: unknown[][] = [];
  const snapshotResult = {
    customRequire: Object.assign(
      (moduleName: string) => {
        return `custom:${moduleName}`;
      },
      {
        cache: {} as Record<string, {exports: unknown}>,
        definitions: {
          'virtual:plugin': {}
        }
      }
    ),
    setGlobals: (...args: unknown[]) => {
      setGlobalsCalls.push(args);
    }
  };

  globalHost.require = runtimeRequire;
  globalHost.window = {} as Window & {require?: (moduleName: string) => unknown};
  globalHost.document = {} as Document;
  globalHost.snapshotResult = snapshotResult;

  await import(`../../lib/v8-snapshot-util.ts?bootstrap_case=${Date.now()}`);

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

test('throws when snapshot bootstrap cannot find runtime require', async () => {
  globalHost.window = {} as Window;
  globalHost.document = {} as Document;
  globalHost.snapshotResult = {
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
  };

  await expect(import(`../../lib/v8-snapshot-util.ts?missing_require_case=${Date.now()}`)).rejects.toThrow(
    'Expected a Node-compatible require function for snapshot initialization.'
  );
});
