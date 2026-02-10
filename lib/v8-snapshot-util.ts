if (typeof snapshotResult !== 'undefined') {
  const rendererWindow = window as Window & {require?: NodeRequire};
  const runtimeRequire =
    typeof global.require === 'function'
      ? global.require
      : typeof window !== 'undefined' && typeof rendererWindow.require === 'function'
        ? rendererWindow.require
        : null;

  if (!runtimeRequire) {
    throw new Error('Expected a Node-compatible require function for snapshot initialization.');
  }

  const Module = runtimeRequire('module') as {_load: (module: string, ...args: unknown[]) => unknown};
  const originalLoad = Module._load;

  Module._load = function _load(module: string, ...args: unknown[]): unknown {
    let cachedModule = snapshotResult.customRequire.cache[module];

    if (cachedModule) return cachedModule.exports;

    if (snapshotResult.customRequire.definitions[module]) {
      cachedModule = {exports: snapshotResult.customRequire(module)};
    } else {
      cachedModule = {exports: originalLoad(module, ...args)};
    }

    snapshotResult.customRequire.cache[module] = cachedModule;
    return cachedModule.exports;
  };

  snapshotResult.setGlobals(global, process, window, document, console, runtimeRequire);
}
