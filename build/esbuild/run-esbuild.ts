/** @file Builds renderer/CLI bundles with esbuild and handles watch mode. */
import path from 'node:path';

import {build, context, type BuildContext, type BuildOptions} from 'esbuild';

import {copyHyperAppArtifacts, copyRendererArtifacts} from './copy-artifacts';
import {createIgnoreImportsPlugin} from './esbuild-plugins/ignore-imports-plugin';
import {createNodeBuiltinsPlugin} from './esbuild-plugins/node-builtins-plugin';
import {createRendererExternalsPlugin} from './esbuild-plugins/renderer-externals-plugin';
import {createStyledJsxBabelBridgePlugin} from './esbuild-plugins/styled-jsx-babel-bridge-plugin';

export type BuildMode = 'development' | 'production';
export type BuildTarget = 'hyper-app' | 'renderer' | 'cli';

type RunEsbuildOptions = {
  mode: BuildMode;
  watch: boolean;
  targets: BuildTarget[];
  rootDir?: string;
};

const isProductionMode = (mode: BuildMode) => mode === 'production';

export const createRendererBuildOptions = (mode: BuildMode, rootDir: string): BuildOptions => {
  return {
    absWorkingDir: rootDir,
    entryPoints: [path.join(rootDir, 'lib', 'index.tsx')],
    outfile: path.join(rootDir, 'target', 'renderer', 'bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    sourcemap: isProductionMode(mode) ? 'external' : 'linked',
    minify: isProductionMode(mode),
    legalComments: isProductionMode(mode) ? 'none' : 'inline',
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.d.ts', '.json'],
    loader: {
      '.d.ts': 'ts',
      '.json': 'json',
      '.css': 'css'
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode)
    },
    plugins: [
      createStyledJsxBabelBridgePlugin(),
      createRendererExternalsPlugin(),
      createNodeBuiltinsPlugin(),
      createIgnoreImportsPlugin()
    ]
  };
};

export const createCliBuildOptions = (mode: BuildMode, rootDir: string): BuildOptions => {
  return {
    absWorkingDir: rootDir,
    entryPoints: [path.join(rootDir, 'cli', 'index.ts')],
    outfile: path.join(rootDir, 'bin', 'cli.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node24'],
    sourcemap: isProductionMode(mode) ? false : 'linked',
    minify: isProductionMode(mode),
    legalComments: isProductionMode(mode) ? 'none' : 'inline',
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.d.ts', '.json'],
    loader: {
      '.d.ts': 'ts',
      '.json': 'json'
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode)
    },
    plugins: [createNodeBuiltinsPlugin(), createIgnoreImportsPlugin()]
  };
};

const containsTarget = (targets: BuildTarget[], target: BuildTarget) => {
  return targets.includes(target);
};

const watchBuild = async (options: BuildOptions): Promise<BuildContext> => {
  const buildContext = await context(options);
  await buildContext.watch();
  return buildContext;
};

const runWatchBuilds = async (options: RunEsbuildOptions) => {
  const rootDir = options.rootDir ?? process.cwd();
  const contexts: BuildContext[] = [];

  if (containsTarget(options.targets, 'hyper-app')) {
    await copyHyperAppArtifacts({rootDir});
  }

  if (containsTarget(options.targets, 'renderer')) {
    await copyRendererArtifacts({rootDir});
    contexts.push(await watchBuild(createRendererBuildOptions(options.mode, rootDir)));
  }

  if (containsTarget(options.targets, 'cli')) {
    contexts.push(await watchBuild(createCliBuildOptions(options.mode, rootDir)));
  }

  const closeAllContexts = async () => {
    await Promise.all(contexts.map((buildContext) => buildContext.dispose()));
  };

  process.on('SIGINT', () => {
    void closeAllContexts().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void closeAllContexts().finally(() => process.exit(0));
  });

  await new Promise<void>(() => {
    // Keep process alive for watch mode.
  });
};

const runOneShotBuilds = async (options: RunEsbuildOptions) => {
  const rootDir = options.rootDir ?? process.cwd();
  const buildOperations: Promise<unknown>[] = [];

  if (containsTarget(options.targets, 'hyper-app')) {
    buildOperations.push(copyHyperAppArtifacts({rootDir}));
  }

  if (containsTarget(options.targets, 'renderer')) {
    buildOperations.push(
      (async () => {
        await copyRendererArtifacts({rootDir});
        await build(createRendererBuildOptions(options.mode, rootDir));
      })()
    );
  }

  if (containsTarget(options.targets, 'cli')) {
    buildOperations.push(build(createCliBuildOptions(options.mode, rootDir)));
  }

  await Promise.all(buildOperations);
};

/** Runs the selected esbuild targets in watch or one-shot mode. */
export const runEsbuild = async (options: RunEsbuildOptions) => {
  if (options.watch) {
    await runWatchBuilds(options);
    return;
  }

  await runOneShotBuilds(options);
};
