/**
 * Ensure Bun's test runner can load AVA-based test files without aborting.
 *
 * AVA checks for a child-process IPC channel or a worker thread. Bun's test
 * runner does not provide `process.send`, so provide a benign stub during Bun
 * test runs only.
 */
if (typeof Bun !== 'undefined' && typeof process.send !== 'function') {
  process.send = () => {};
}
