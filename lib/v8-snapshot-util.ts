/** @file Initializes snapshot module loading hooks for renderer runtime execution. */
type SnapshotCustomRequire = {
  (moduleName: string): unknown;
  cache: Record<string, {exports: unknown}>;
  definitions: Record<string, unknown>;
};

type SnapshotResult = {
  customRequire: SnapshotCustomRequire;
  setGlobals: (...args: unknown[]) => void;
};

type SnapshotModuleLoader = {
  _load: (moduleName: string, ...args: unknown[]) => unknown;
};

type SnapshotRuntimeWindow = Window & {require?: NodeRequire};

type SnapshotRuntimeEnvironment = {
  document?: Document;
  require?: NodeRequire;
  snapshotResult?: SnapshotResult;
  window?: SnapshotRuntimeWindow;
};

export type SnapshotBootstrapHandle = {
  restore(): void;
};

type SnapshotLoaderEntry = {
  isActive: boolean;
  setFallbackLoad: (load: SnapshotModuleLoader['_load']) => void;
  wrapper: SnapshotModuleLoader['_load'];
};

type SnapshotLoaderState = {
  baseLoad: SnapshotModuleLoader['_load'];
  entries: SnapshotLoaderEntry[];
};

declare const snapshotResult: SnapshotResult | undefined;

const snapshotLoaderStates = new WeakMap<SnapshotModuleLoader, SnapshotLoaderState>();

const resolveBoundSnapshotResult = (): SnapshotResult | undefined =>
  typeof snapshotResult === 'undefined' ? undefined : snapshotResult;

const isManagedSnapshotLoad = (loaderState: SnapshotLoaderState, load: SnapshotModuleLoader['_load']): boolean => {
  return load === loaderState.baseLoad || loaderState.entries.some(({wrapper}) => wrapper === load);
};

const getOrCreateLoaderState = (moduleLoader: SnapshotModuleLoader): SnapshotLoaderState => {
  const existingState = snapshotLoaderStates.get(moduleLoader);

  if (existingState && isManagedSnapshotLoad(existingState, moduleLoader._load)) {
    return existingState;
  }

  const loaderState: SnapshotLoaderState = {
    baseLoad: moduleLoader._load,
    entries: []
  };
  snapshotLoaderStates.set(moduleLoader, loaderState);
  return loaderState;
};

const rebuildSnapshotLoaderChain = (
  moduleLoader: SnapshotModuleLoader,
  loaderState: SnapshotLoaderState
): SnapshotModuleLoader['_load'] => {
  let nextLoad = loaderState.baseLoad;
  const activeEntries = loaderState.entries.filter(({isActive}) => isActive);

  if (activeEntries.length === 0) {
    snapshotLoaderStates.delete(moduleLoader);
    return nextLoad;
  }

  for (const entry of activeEntries) {
    entry.setFallbackLoad(nextLoad);
    nextLoad = entry.wrapper;
  }

  return nextLoad;
};

export const bootstrapSnapshotRuntime = (
  runtimeHost: SnapshotRuntimeEnvironment = globalThis as SnapshotRuntimeEnvironment
): SnapshotBootstrapHandle | null => {
  const runtimeSnapshotResult = runtimeHost.snapshotResult ?? resolveBoundSnapshotResult();
  if (runtimeSnapshotResult === undefined) {
    return null;
  }

  const runtimeWindow = runtimeHost.window;
  const runtimeDocument = runtimeHost.document;
  const runtimeRequire =
    typeof runtimeHost.require === 'function'
      ? runtimeHost.require
      : typeof runtimeWindow?.require === 'function'
        ? runtimeWindow.require
        : null;

  if (!runtimeRequire) {
    throw new Error('Expected a Node-compatible require function for snapshot initialization.');
  }

  if (!runtimeWindow || !runtimeDocument) {
    throw new Error('Expected window and document globals for snapshot initialization.');
  }

  const moduleLoader = runtimeRequire('module') as SnapshotModuleLoader;
  const loaderState = getOrCreateLoaderState(moduleLoader);
  let fallbackLoad = moduleLoader._load;

  const snapshotAwareLoad = function _load(moduleName: string, ...args: unknown[]): unknown {
    let cachedModule = runtimeSnapshotResult.customRequire.cache[moduleName];

    if (cachedModule) {
      return cachedModule.exports;
    }

    if (runtimeSnapshotResult.customRequire.definitions[moduleName]) {
      cachedModule = {exports: runtimeSnapshotResult.customRequire(moduleName)};
    } else {
      cachedModule = {exports: fallbackLoad(moduleName, ...args)};
    }

    runtimeSnapshotResult.customRequire.cache[moduleName] = cachedModule;
    return cachedModule.exports;
  };

  const loaderEntry: SnapshotLoaderEntry = {
    isActive: true,
    setFallbackLoad(load) {
      fallbackLoad = load;
    },
    wrapper: snapshotAwareLoad
  };

  loaderState.entries.push(loaderEntry);
  moduleLoader._load = rebuildSnapshotLoaderChain(moduleLoader, loaderState);
  try {
    runtimeSnapshotResult.setGlobals(global, process, runtimeWindow, runtimeDocument, console, runtimeRequire);
  } catch (error) {
    loaderEntry.isActive = false;
    const currentLoad = moduleLoader._load;
    const restoredLoad = rebuildSnapshotLoaderChain(moduleLoader, loaderState);

    if (isManagedSnapshotLoad(loaderState, currentLoad)) {
      moduleLoader._load = restoredLoad;
    }

    throw error;
  }

  return {
    restore() {
      if (!loaderEntry.isActive) {
        return;
      }

      loaderEntry.isActive = false;
      const currentLoad = moduleLoader._load;
      const restoredLoad = rebuildSnapshotLoaderChain(moduleLoader, loaderState);

      if (isManagedSnapshotLoad(loaderState, currentLoad)) {
        moduleLoader._load = restoredLoad;
      }
    }
  };
};

bootstrapSnapshotRuntime();
