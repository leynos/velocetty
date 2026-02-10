/** @file Externalizes Node.js built-in modules for renderer and CLI builds. */
import {builtinModules} from 'node:module';

import type {Plugin} from 'esbuild';

const normalizedBuiltins = new Set(
  builtinModules.flatMap((moduleName) => {
    if (moduleName.startsWith('node:')) {
      return [moduleName, moduleName.slice('node:'.length)];
    }
    return [moduleName, `node:${moduleName}`];
  })
);

/** Returns true when an import references a Node.js built-in module. */
export const isNodeBuiltinImport = (importPath: string): boolean => {
  return normalizedBuiltins.has(importPath);
};

/** Marks Node.js built-ins as externals so runtime `require` resolves them. */
export const createNodeBuiltinsPlugin = (): Plugin => {
  return {
    name: 'node-builtins',
    setup(build) {
      build.onResolve({filter: /.*/}, ({path}) => {
        if (!isNodeBuiltinImport(path)) {
          return null;
        }
        return {
          path,
          external: true
        };
      });
    }
  };
};
