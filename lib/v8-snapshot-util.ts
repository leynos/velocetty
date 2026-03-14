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

type SnapshotRuntimeHost = typeof globalThis & {
  document?: Document;
  require?: NodeRequire;
  snapshotResult?: SnapshotResult;
  window?: SnapshotRuntimeWindow;
};

export type SnapshotBootstrapHandle = {
  readonly module: SnapshotModuleLoader;
  readonly runtimeRequire: NodeRequire;
  restore(): void;
};

const resolveRuntimeRequire = (
  runtimeHost: SnapshotRuntimeHost,
  runtimeWindow: SnapshotRuntimeWindow | undefined
): NodeRequire | null => {
  if (typeof runtimeHost.require === 'function') {
    return runtimeHost.require;
  }

  if (typeof runtimeWindow?.require === 'function') {
    return runtimeWindow.require;
  }

  return null;
};

export const bootstrapSnapshotRuntime = (
  runtimeHost: SnapshotRuntimeHost = globalThis as SnapshotRuntimeHost
): SnapshotBootstrapHandle | null => {
  const runtimeSnapshotResult = runtimeHost.snapshotResult;
  if (runtimeSnapshotResult === undefined) {
    return null;
  }

  const runtimeWindow = runtimeHost.window;
  const runtimeDocument = runtimeHost.document;
  const runtimeRequire = resolveRuntimeRequire(runtimeHost, runtimeWindow);

  if (!runtimeRequire) {
    throw new Error('Expected a Node-compatible require function for snapshot initialization.');
  }

  if (!runtimeWindow || !runtimeDocument) {
    throw new Error('Expected window and document globals for snapshot initialization.');
  }

  const moduleLoader = runtimeRequire('module') as SnapshotModuleLoader;
  const originalLoad = moduleLoader._load;

  const snapshotAwareLoad = function _load(moduleName: string, ...args: unknown[]): unknown {
    let cachedModule = runtimeSnapshotResult.customRequire.cache[moduleName];

    if (cachedModule) {
      return cachedModule.exports;
    }

    if (runtimeSnapshotResult.customRequire.definitions[moduleName]) {
      cachedModule = {exports: runtimeSnapshotResult.customRequire(moduleName)};
    } else {
      cachedModule = {exports: originalLoad(moduleName, ...args)};
    }

    runtimeSnapshotResult.customRequire.cache[moduleName] = cachedModule;
    return cachedModule.exports;
  };

  moduleLoader._load = snapshotAwareLoad;
  runtimeSnapshotResult.setGlobals(global, process, runtimeWindow, runtimeDocument, console, runtimeRequire);

  return {
    module: moduleLoader,
    runtimeRequire,
    restore() {
      if (moduleLoader._load === snapshotAwareLoad) {
        moduleLoader._load = originalLoad;
      }
    }
  };
};

bootstrapSnapshotRuntime();
