/** @file Marks legacy ignored imports as externals in esbuild. */
import type {Plugin} from 'esbuild';

import {ignoredImportPatterns} from '../constants';

/** Returns true when an import should be left unresolved/external. */
export const shouldIgnoreImportPath = (importPath: string): boolean => {
  return ignoredImportPatterns.some((pattern) => pattern.test(importPath));
};

/** Recreates webpack IgnorePlugin behaviour for source maps and `spawn-sync`. */
export const createIgnoreImportsPlugin = (): Plugin => {
  return {
    name: 'ignore-imports',
    setup(build) {
      build.onResolve({filter: /.*/}, ({path}) => {
        if (!shouldIgnoreImportPath(path)) {
          return null;
        }
        return {path, external: true};
      });
    }
  };
};
