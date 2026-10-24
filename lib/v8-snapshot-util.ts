/** @file Initializes snapshot module loading hooks for renderer runtime execution. */
import {isFunction, isObject} from '@shared/types/guards';

/** A module whose export is itself a function, such as `require('module')`. */
export type SnapshotModuleCallable = (...args: never[]) => SnapshotModuleExport;

export type SnapshotModuleExport =
  | SnapshotModuleObject
  | SnapshotModuleCallable
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined;

/**
 * A module namespace object: named exports, which may be null-prototype
 * objects without inherited methods.
 *
 * The index signature is what makes this a module object rather than an empty
 * one. Without it the type admitted only the optional `toString`, so no real
 * `require` result could be described: `require('module')` returns a callable
 * carrying `_load`, and ordinary modules expose whatever names they export.
 */
export interface SnapshotModuleObject {
  [exportName: string]: SnapshotModuleExport;
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

// Declared beside the type it holds so the shared typings file stays free of
// imports. `app/tsconfig.build.json` includes `typings/runtime-globals.d.ts`,
// and a type import from there reaches into this project, which the compiler
// then emits in place instead of into `dist/app`. See the alias rule in
// `docs/developers-guide.md`.
declare global {
  var snapshotResult: SnapshotRuntimeResult | undefined;
}

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

/**
 * Recognizes the module loader returned by `require('module')`.
 *
 * That value is the `Module` constructor with `_load` attached to it, so
 * `typeof` reports `'function'` rather than `'object'`. Admitting only objects
 * rejects the real loader while still accepting the object literals that test
 * doubles tend to use, which is the combination that let this fault reach the
 * renderer. Callables are therefore accepted alongside objects.
 */
const isSnapshotModuleLoader = (candidate: unknown): candidate is SnapshotModuleLoader => {
  if (!isObject(candidate) && !isFunction(candidate)) {
    return false;
  }
  // SAFETY: the guards above already rejected non-null objects and functions, so
  // `candidate` is safe to read from; the assertion only names the shape probed,
  // and `isFunction` accepts `undefined` in case the property is absent.
  return isFunction((candidate as {_load?: unknown})._load);
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

/**
 * Finds the `require` the snapshot runtime should use.
 *
 * The host's own require wins when it is Node-compatible; a window-scoped one
 * is the fallback because some hosts expose it only there.
 */
const resolveSnapshotRequire = (
  runtimeHost: SnapshotRuntimeEnvironment,
  runtimeWindow: SnapshotRuntimeEnvironment['window']
): SnapshotModuleRequire | null => {
  if (isSnapshotRequire(runtimeHost.require)) {
    return runtimeHost.require;
  }
  return isSnapshotRequire(runtimeWindow?.require) ? runtimeWindow.require : null;
};

/** Returns the host's usable `require`, or throws explaining what was missing. */
const requireSnapshotRequire = (
  runtimeHost: SnapshotRuntimeEnvironment,
  runtimeWindow: SnapshotRuntimeEnvironment['window']
): SnapshotModuleRequire => {
  const runtimeRequire = resolveSnapshotRequire(runtimeHost, runtimeWindow);
  if (!runtimeRequire) {
    throw new Error('Expected a Node-compatible require function for snapshot initialization.');
  }
  return runtimeRequire;
};

/** Loads the `module` builtin and checks it exposes the loader hook. */
const loadSnapshotModuleLoader = (runtimeRequire: SnapshotModuleRequire): SnapshotModuleLoader => {
  const loadedModule = runtimeRequire('module');
  if (!isSnapshotModuleLoader(loadedModule)) {
    throw new TypeError('Expected the runtime module loader to expose `_load`.');
  }
  return loadedModule;
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
  const runtimeRequire = requireSnapshotRequire(runtimeHost, runtimeWindow);

  if (!runtimeWindow || !runtimeDocument) {
    throw new Error('Expected window and document globals for snapshot initialization.');
  }

  const moduleLoader = loadSnapshotModuleLoader(runtimeRequire);
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
