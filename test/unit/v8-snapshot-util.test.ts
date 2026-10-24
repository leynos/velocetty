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
import type {SnapshotModuleExport, SnapshotModuleRequire, SnapshotRuntimeResult} from '../../lib/v8-snapshot-util';

type ModuleContainer = {
  _load: (moduleName: string) => SnapshotModuleExport;
};

type SnapshotHarness = {
  moduleContainer: ModuleContainer;
  restoreBootstrap: () => void;
  runtimeRequire: SnapshotModuleRequire;
  setGlobalsCalls: unknown[][];
  snapshotResult: SnapshotRuntimeResult;
};

type SnapshotWindow = {require?: SnapshotModuleRequire};

const overriddenModuleLoad = (_moduleName: string) => 'overridden';
const failIfRuntimeRequireCalled = (moduleName: string): never => {
  throw new Error(`runtime require should not be called without snapshotResult: ${moduleName}`);
};

type BootstrapFixture = {
  moduleContainer: ModuleContainer;
  originalLoad: (moduleName: string) => SnapshotModuleExport;
  bootstrapHandle: {restore: () => void};
};

// SAFETY: Bootstrap only checks this sentinel's presence; these tests never call DOM methods.
const documentStub = {} as Document;

const createModuleContainer = (): ModuleContainer => {
  return {
    _load: (moduleName: string) => ({native: moduleName})
  };
};

type CallableModuleContainer = ModuleContainer & ((moduleName: string) => SnapshotModuleExport);

/**
 * Builds a loader shaped like the value `require('module')` actually returns.
 *
 * Node hands back the `Module` constructor with `_load` attached to it, so the
 * loader is callable and `typeof` reports `'function'`. The plain object
 * literal above is the more convenient double, but it is not the real shape,
 * which is how a guard that rejected callables once shipped unnoticed.
 */
const loadNativeModule = (moduleName: string): SnapshotModuleExport => ({toString: () => `native:${moduleName}`});

const createCallableModuleContainer = (): CallableModuleContainer => {
  // A distinct callable per call, rather than the shared module-scope one:
  // bootstrap swaps `_load` on the value it is handed, so a single shared
  // instance would let one test's wrapper leak into the next.
  const load = (moduleName: string): SnapshotModuleExport => loadNativeModule(moduleName);
  return Object.assign(load, {_load: load});
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
  definitions: SnapshotRuntimeResult['customRequire']['definitions'],
  setGlobalsCalls: unknown[][]
): SnapshotRuntimeResult => {
  const cache: SnapshotRuntimeResult['customRequire']['cache'] = {};
  return {
    customRequire: Object.assign(
      (moduleName: string) => {
        return `custom:${moduleName}`;
      },
      {
        cache,
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
  const runtimeWindow: SnapshotWindow = requireLocation === 'window' ? {require: runtimeRequire} : {};

  const setGlobalsCalls: unknown[][] = [];
  const snapshotResult = createSnapshotResult({[virtualModuleName]: () => {}}, setGlobalsCalls);
  const bootstrapHandle = bootstrapSnapshotRuntime({
    document: documentStub,
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

const createBootstrapFixture = (): BootstrapFixture => {
  const moduleContainer = createModuleContainer();
  const originalLoad = moduleContainer._load;
  const runtimeRequire = createRuntimeRequire(moduleContainer);
  const bootstrapHandle = bootstrapSnapshotRuntime({
    document: documentStub,
    require: runtimeRequire,
    snapshotResult: createSnapshotResult({'virtual:plugin': () => {}}, []),
    window: {}
  });

  if (!bootstrapHandle) {
    throw new Error('Expected snapshot bootstrap to install a runtime handle.');
  }

  expect(moduleContainer._load).not.toBe(originalLoad);

  return {moduleContainer, originalLoad, bootstrapHandle};
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
  const {moduleContainer, originalLoad, bootstrapHandle} = createBootstrapFixture();
  bootstrapHandle.restore();
  expect(moduleContainer._load).toBe(originalLoad);
});

test('throws when snapshot bootstrap cannot find runtime require', () => {
  expect(() =>
    bootstrapSnapshotRuntime({
      document: documentStub,
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
      window: {}
    })
  ).toThrow('Expected a Node-compatible require function for snapshot initialization.');
});

test('throws when snapshot bootstrap cannot find window or document globals', () => {
  const runtimeRequire = createRuntimeRequire(createModuleContainer());
  const validRequire = Object.assign(
    (_moduleName: string) => {
      return null;
    },
    {
      cache: {},
      definitions: {}
    }
  );

  expect(() =>
    bootstrapSnapshotRuntime({
      document: documentStub,
      require: runtimeRequire,
      snapshotResult: {
        customRequire: validRequire,
        setGlobals: () => {}
      },
      window: undefined
    })
  ).toThrow('Expected window and document globals for snapshot initialization.');

  expect(() =>
    bootstrapSnapshotRuntime({
      document: undefined,
      snapshotResult: {
        customRequire: validRequire,
        setGlobals: () => {}
      },
      window: {},
      require: runtimeRequire
    })
  ).toThrow('Expected window and document globals for snapshot initialization.');
});

test('restore is idempotent when the module loader has changed', () => {
  const {moduleContainer, originalLoad, bootstrapHandle} = createBootstrapFixture();

  const overriddenLoad = overriddenModuleLoad;
  moduleContainer._load = overriddenLoad;

  bootstrapHandle.restore();

  expect(moduleContainer._load).toBe(overriddenLoad);
  expect(moduleContainer._load).not.toBe(originalLoad);
});

test('restore removes stale wrappers when snapshot bootstraps overlap', () => {
  const moduleContainer = createModuleContainer();
  const originalLoad = moduleContainer._load;
  const runtimeRequire = createRuntimeRequire(moduleContainer);
  const firstHandle = bootstrapSnapshotRuntime({
    document: documentStub,
    require: runtimeRequire,
    snapshotResult: createSnapshotResult({'virtual:first': () => {}}, []),
    window: {}
  });

  if (!firstHandle) {
    throw new Error('Expected the first snapshot bootstrap to install a runtime handle.');
  }

  const secondHandle = bootstrapSnapshotRuntime({
    document: documentStub,
    require: runtimeRequire,
    snapshotResult: createSnapshotResult({'virtual:second': () => {}}, []),
    window: {}
  });

  if (!secondHandle) {
    throw new Error('Expected the second snapshot bootstrap to install a runtime handle.');
  }

  firstHandle.restore();
  expect(moduleContainer._load('virtual:first')).toEqual({native: 'virtual:first'});
  expect(moduleContainer._load('virtual:second')).toBe('custom:virtual:second');
  expect(moduleContainer._load('native:module')).toEqual({native: 'native:module'});

  secondHandle.restore();
  expect(moduleContainer._load).toBe(originalLoad);
});

test('accepts the callable module loader that `require("module")` returns', () => {
  // Regression: `require('module')` is the `Module` constructor with `_load`
  // attached, so it is a function, not an object literal. A guard that admitted
  // only object literals rejected the real loader and threw at renderer module
  // scope, which surfaced as a single critical renderer error in every E2E lane.
  const moduleContainer = createCallableModuleContainer();
  const originalLoad = moduleContainer._load;
  const runtimeRequire = createRuntimeRequire(moduleContainer);

  const bootstrapHandle = bootstrapSnapshotRuntime({
    document: documentStub,
    require: runtimeRequire,
    snapshotResult: createSnapshotResult({'virtual:callable': () => {}}, []),
    window: {}
  });

  if (!bootstrapHandle) {
    throw new Error('Expected snapshot bootstrap to install a runtime handle.');
  }

  expect(moduleContainer._load).not.toBe(originalLoad);
  expect(moduleContainer._load('virtual:callable')).toBe('custom:virtual:callable');

  bootstrapHandle.restore();
  expect(moduleContainer._load).toBe(originalLoad);
});

test('no-ops when snapshotResult is unavailable', () => {
  const runtimeRequire = failIfRuntimeRequireCalled;

  expect(
    bootstrapSnapshotRuntime({
      require: runtimeRequire,
      window: {}
    })
  ).toBeNull();
});
