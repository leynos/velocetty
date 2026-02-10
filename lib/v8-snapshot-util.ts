/** @file Initializes snapshot module loading hooks for renderer runtime execution. */
if (typeof snapshotResult !== 'undefined') {
  const runtimeWindow = typeof window !== 'undefined' ? window : undefined;
  const runtimeDocument = typeof document !== 'undefined' ? document : undefined;
  const rendererWindow = runtimeWindow as (Window & {require?: NodeRequire}) | undefined;
  const runtimeRequire =
    typeof global.require === 'function'
      ? global.require
      : typeof rendererWindow?.require === 'function'
        ? rendererWindow.require
        : null;

  if (!runtimeRequire) {
    throw new Error('Expected a Node-compatible require function for snapshot initialization.');
  }
  if (!runtimeWindow || !runtimeDocument) {
    throw new Error('Expected window and document globals for snapshot initialization.');
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

  snapshotResult.setGlobals(global, process, runtimeWindow, runtimeDocument, console, runtimeRequire);
}
