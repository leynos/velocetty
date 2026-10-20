/** @file Initializes snapshot module loading hooks for renderer runtime execution. */
import {isFunction} from '@shared/types/guards';

export type SnapshotModuleExport =
  | SnapshotModuleObject
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined;

/** Module exports may be null-prototype objects without inherited methods. */
export interface SnapshotModuleObject {
  toString?(): string;
}

type SnapshotModuleContainer = {exports: SnapshotModuleExport};
type SnapshotModuleDefinition = (
  exports: SnapshotModuleExport,
  module: SnapshotModuleContainer,
  modulePath: string,
  dirname: string,
  require: SnapshotModuleRequire,
  define: (
    callback: (require: SnapshotModuleRequire, exports: SnapshotModuleExport, module: SnapshotModuleContainer) => void
  ) => void
) => void;

export type SnapshotModuleRequire = (moduleName: string) => SnapshotModuleExport;

export type SnapshotCustomRequire = {
  (moduleName: string): SnapshotModuleExport;
  cache: Partial<Record<string, SnapshotModuleContainer>>;
  definitions: Partial<Record<string, SnapshotModuleDefinition>>;
};

export type SnapshotRuntimeResult = {
  customRequire: SnapshotCustomRequire;
  setGlobals: (...args: unknown[]) => void;
};

type SnapshotModuleLoader = {
  _load: (moduleName: string, ...args: unknown[]) => SnapshotModuleExport;
};

type SnapshotRuntimeEnvironment = {
  document?: Document | undefined;
  require?: SnapshotModuleRequire;
  snapshotResult?: SnapshotRuntimeResult;
  window?: {require?: SnapshotModuleRequire} | undefined;
};

const isSnapshotRequire = (candidate: unknown): candidate is SnapshotModuleRequire => isFunction(candidate);

const isSnapshotModuleLoader = (candidate: unknown): candidate is SnapshotModuleLoader =>
  typeof candidate === 'object' && candidate !== null && '_load' in candidate && typeof candidate._load === 'function';

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

const snapshotLoaderStates = new WeakMap<SnapshotModuleLoader, SnapshotLoaderState>();

const resolveBoundSnapshotResult = (): SnapshotRuntimeResult | undefined => globalThis.snapshotResult;

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
  // SAFETY: The runtime host is globalThis, whose window and document are optional at bootstrap time.
  runtimeHost: SnapshotRuntimeEnvironment = globalThis
): SnapshotBootstrapHandle | null => {
  const runtimeSnapshotResult = runtimeHost.snapshotResult ?? resolveBoundSnapshotResult();
  if (runtimeSnapshotResult === undefined) {
    return null;
  }

  const runtimeWindow = runtimeHost.window;
  const runtimeDocument = runtimeHost.document;
  let runtimeRequire: SnapshotModuleRequire | null = null;
  if (isSnapshotRequire(runtimeHost.require)) {
    runtimeRequire = runtimeHost.require;
  } else if (isSnapshotRequire(runtimeWindow?.require)) {
    runtimeRequire = runtimeWindow.require;
  }

  if (!runtimeRequire) {
    throw new Error('Expected a Node-compatible require function for snapshot initialization.');
  }

  if (!runtimeWindow || !runtimeDocument) {
    throw new Error('Expected window and document globals for snapshot initialization.');
  }

  const loadedModule = runtimeRequire('module');
  if (!isSnapshotModuleLoader(loadedModule)) {
    throw new TypeError('Expected the runtime module loader to expose `_load`.');
  }
  const moduleLoader = loadedModule;
  const loaderState = getOrCreateLoaderState(moduleLoader);
  let fallbackLoad = moduleLoader._load;

  const snapshotAwareLoad = function _load(moduleName: string, ...args: unknown[]): SnapshotModuleExport {
    let cachedModule = runtimeSnapshotResult.customRequire.cache[moduleName];

    if (cachedModule) {
      return cachedModule.exports;
    }

    cachedModule = runtimeSnapshotResult.customRequire.definitions[moduleName]
      ? {exports: runtimeSnapshotResult.customRequire(moduleName)}
      : {exports: fallbackLoad(moduleName, ...args)};

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
    runtimeSnapshotResult.setGlobals(globalThis, process, runtimeWindow, runtimeDocument, console, runtimeRequire);
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
