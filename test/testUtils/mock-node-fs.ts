/** @file Helper for passthrough mocks of the `node:fs` module in tests. */
import * as nodeFs from 'node:fs';

type NodeFsOverrides = Partial<typeof nodeFs>;

/**
 * Builds a `node:fs` mock that preserves all original exports by default.
 *
 * Tests can override only the functions they need, while unchanged exports
 * remain available to other suites running in the same Bun process.
 */
export const buildNodeFsModuleMock = (overrides: NodeFsOverrides) => {
  const moduleExports = {
    ...nodeFs,
    ...overrides
  };

  return {
    ...moduleExports,
    default: moduleExports
  };
};
