/**
 * @file Verifies the snapshot bootstrap contract in `lib/v8-snapshot-util.ts`.
 *
 * Responsibilities:
 * - Exercise bundler-agnostic runtime `require` lookup through explicit test
 *   fixtures instead of process-global state.
 * - Validate snapshot cache/definition wiring and loader restoration performed
 *   during bootstrap.
 *
 * Invariants:
 * - Bootstrap resolves virtual modules via `customRequire` and falls back to
 *   native module loading for other imports.
 * - `setGlobals` receives the resolved runtime `require` exactly once per
 *   bootstrap run.
 * - Missing runtime `require` throws the expected initialization error, while
 *   an absent `snapshotResult` remains a no-op.
 *
 * Cross-link: `lib/v8-snapshot-util.ts`.
 */
import {expect, test} from 'bun:test';

import {bootstrapSnapshotRuntime} from '../../lib/v8-snapshot-util';

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

type SnapshotHarness = {
  moduleContainer: ModuleContainer;
  restoreBootstrap: () => void;
  runtimeRequire: NodeRequire;
  setGlobalsCalls: unknown[][];
  snapshotResult: SnapshotResultShape;
};

const createModuleContainer = (): ModuleContainer => {
  return {
    _load: (moduleName: string) => ({native: moduleName})
  };
};

const createRuntimeRequire = (moduleContainer: ModuleContainer): NodeRequire => {
  return ((moduleName: string) => {
    if (moduleName === 'module') {
      return moduleContainer;
    }
    throw new Error(`Unexpected module request: ${moduleName}`);
  }) as NodeRequire;
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

const createSnapshotHarness = (virtualModuleName: string, requireLocation: 'global' | 'window'): SnapshotHarness => {
  const moduleContainer = createModuleContainer();
  const originalLoad = moduleContainer._load;
  const runtimeRequire = createRuntimeRequire(moduleContainer);
  const runtimeWindow = {} as Window & {require?: NodeRequire};

  if (requireLocation === 'window') {
    runtimeWindow.require = runtimeRequire;
  }

  const setGlobalsCalls: unknown[][] = [];
  const snapshotResult = createSnapshotResult({[virtualModuleName]: {}}, setGlobalsCalls);
  const bootstrapHandle = bootstrapSnapshotRuntime({
    document: {} as Document,
    require: requireLocation === 'global' ? runtimeRequire : undefined,
    snapshotResult,
    window: runtimeWindow
  });

  if (!bootstrapHandle) {
    throw new Error('Expected snapshot bootstrap to install a runtime handle.');
  }

  expect(moduleContainer._load).not.toBe(originalLoad);

  return {
    moduleContainer,
    restoreBootstrap: () => {
      bootstrapHandle.restore();
    },
    runtimeRequire,
    setGlobalsCalls,
    snapshotResult
  };
};

const assertSnapshotBootstrapResult = ({
  moduleContainer,
  restoreBootstrap,
  runtimeRequire,
  snapshotResult,
  setGlobalsCalls,
  virtualModuleName
}: SnapshotHarness & {
  virtualModuleName: string;
}) => {
  const installedLoad = moduleContainer._load;
  const loadedVirtualModule = moduleContainer._load(virtualModuleName);
  const loadedNativeModule = moduleContainer._load('native:module');

  expect(loadedVirtualModule).toBe(`custom:${virtualModuleName}`);
  expect(loadedNativeModule).toEqual({native: 'native:module'});
  expect(snapshotResult.customRequire.cache[virtualModuleName]).toEqual({
    exports: `custom:${virtualModuleName}`
  });
  expect(setGlobalsCalls).toHaveLength(1);
  expect(setGlobalsCalls[0].at(-1)).toBe(runtimeRequire);

  restoreBootstrap();
  expect(moduleContainer._load).not.toBe(installedLoad);
  expect(moduleContainer._load('native:module')).toEqual({native: 'native:module'});
};

const snapshotBootstrapCases = [
  {
    testName: 'uses runtime require and snapshot cache/definitions when available',
    virtualModuleName: 'virtual:plugin',
    requireLocation: 'global' as const
  },
  {
    testName: 'falls back to window.require when global require is unavailable',
    virtualModuleName: 'virtual:renderer',
    requireLocation: 'window' as const
  }
];

for (const snapshotBootstrapCase of snapshotBootstrapCases) {
  test(snapshotBootstrapCase.testName, () => {
    const snapshotBootstrapResult = createSnapshotHarness(
      snapshotBootstrapCase.virtualModuleName,
      snapshotBootstrapCase.requireLocation
    );

    assertSnapshotBootstrapResult({
      ...snapshotBootstrapResult,
      virtualModuleName: snapshotBootstrapCase.virtualModuleName
    });
  });
}

test('restores the original module loader after bootstrap cleanup', () => {
  const moduleContainer = createModuleContainer();
  const originalLoad = moduleContainer._load;
  const runtimeRequire = createRuntimeRequire(moduleContainer);
  const bootstrapHandle = bootstrapSnapshotRuntime({
    document: {} as Document,
    require: runtimeRequire,
    snapshotResult: createSnapshotResult({'virtual:plugin': {}}, []),
    window: {} as Window & {require?: NodeRequire}
  });

  if (!bootstrapHandle) {
    throw new Error('Expected snapshot bootstrap to install a runtime handle.');
  }

  expect(moduleContainer._load).not.toBe(originalLoad);
  bootstrapHandle.restore();
  expect(moduleContainer._load).toBe(originalLoad);
});

test('throws when snapshot bootstrap cannot find runtime require', () => {
  expect(() =>
    bootstrapSnapshotRuntime({
      document: {} as Document,
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
      },
      window: {} as Window & {require?: NodeRequire}
    })
  ).toThrow('Expected a Node-compatible require function for snapshot initialization.');
});

test('no-ops when snapshotResult is unavailable', () => {
  const runtimeRequire = ((moduleName: string) => {
    throw new Error(`runtime require should not be called without snapshotResult: ${moduleName}`);
  }) as NodeRequire;

  expect(
    bootstrapSnapshotRuntime({
      require: runtimeRequire,
      window: {} as Window & {require?: NodeRequire}
    })
  ).toBeNull();
});
