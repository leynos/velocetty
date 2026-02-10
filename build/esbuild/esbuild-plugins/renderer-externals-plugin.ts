/** @file Resolves renderer externals to runtime `require()` paths. */
import type {Plugin} from 'esbuild';

import {rendererExternalRequireMap, type RendererExternalModule} from '../constants';

const RENDERER_EXTERNAL_VIRTUAL_NAMESPACE = 'renderer-external-virtual';

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
      build.onResolve({filter: /.*/}, ({path: importPath}) => {
        const runtimeRequirePath = resolveRendererExternalPath(importPath);
        if (!runtimeRequirePath) {
          return null;
        }
        return {
          path: runtimeRequirePath,
          namespace: RENDERER_EXTERNAL_VIRTUAL_NAMESPACE
        };
      });

      build.onLoad({filter: /.*/, namespace: RENDERER_EXTERNAL_VIRTUAL_NAMESPACE}, ({path: runtimeRequirePath}) => {
        return {
          contents: [
            'const rendererRequire =',
            "  typeof global !== 'undefined' && typeof global.require === 'function'",
            '    ? global.require',
            "    : typeof window !== 'undefined' && typeof window.require === 'function'",
            '      ? window.require',
            '      : null;',
            'if (!rendererRequire) {',
            `  throw new Error(${JSON.stringify(`Expected require() for renderer external: ${runtimeRequirePath}`)});`,
            '}',
            `module.exports = rendererRequire(${JSON.stringify(runtimeRequirePath)});`
          ].join('\n'),
          loader: 'js'
        };
      });
    }
  };
};
