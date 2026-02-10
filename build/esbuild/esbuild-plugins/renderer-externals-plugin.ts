/** @file Resolves renderer externals to runtime `require()` paths. */
import type {Plugin} from 'esbuild';

import {rendererExternalRequireMap, type RendererExternalModule} from '../constants';

/** Narrows arbitrary module ids to known renderer external mappings. */
const isRendererExternalModule = (moduleName: string): moduleName is RendererExternalModule => {
  return Object.hasOwn(rendererExternalRequireMap, moduleName);
};

/**
 * Returns the runtime `require()` path for renderer externals, or `null`
 * when the module should be bundled normally.
 */
export const resolveRendererExternalPath = (moduleName: string): string | null => {
  return isRendererExternalModule(moduleName) ? rendererExternalRequireMap[moduleName] : null;
};

/**
 * Reproduces webpack renderer externals via virtual modules that call
 * `require()` with the same runtime paths used today.
 */
export const createRendererExternalsPlugin = (): Plugin => {
  return {
    name: 'renderer-externals',
    setup(build) {
      build.onResolve({filter: /.*/}, ({path}) => {
        const runtimeRequirePath = resolveRendererExternalPath(path);
        if (!runtimeRequirePath) {
          return null;
        }
        return {
          path: runtimeRequirePath,
          external: true
        };
      });
    }
  };
};
