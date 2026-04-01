/** @file Builds renderer/CLI bundles with esbuild and handles watch mode. */
import {copyFile, mkdir} from 'node:fs/promises';
import path from 'node:path';

import {build, context, type BuildContext, type BuildOptions} from 'esbuild';

import {ensureDirectoryPath} from '../../bin/shared/ensure-directory-path.js';
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

type TargetExecutionContext = {
  mode: BuildMode;
  rootDir: string;
};

type TargetDescriptor = {
  runOneShot: (context: TargetExecutionContext) => Promise<void>;
  runWatch: (context: TargetExecutionContext) => Promise<BuildContext | null>;
};

const isProductionMode = (mode: BuildMode) => mode === 'production';

const createBaseBuildOptions = (mode: BuildMode, rootDir: string): BuildOptions => {
  return {
    absWorkingDir: rootDir,
    bundle: true,
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
    // TypeScript path alias resolution matching tsconfig.json paths
    alias: {
      '@shared': path.join(rootDir, 'shared/src'),
      '@app': path.join(rootDir, 'app'),
      '@lib': path.join(rootDir, 'lib')
    }
  };
};

export const createRendererBuildOptions = (mode: BuildMode, rootDir: string): BuildOptions => {
  const baseBuildOptions = createBaseBuildOptions(mode, rootDir);

  return {
    ...baseBuildOptions,
    entryPoints: [path.join(rootDir, 'lib', 'index.tsx')],
    outfile: path.join(rootDir, 'dist', 'app', 'renderer', 'bundle.js'),
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    sourcemap: isProductionMode(mode) ? 'external' : 'linked',
    loader: {
      ...(baseBuildOptions.loader ?? {}),
      '.css': 'css'
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
  const baseBuildOptions = createBaseBuildOptions(mode, rootDir);

  return {
    ...baseBuildOptions,
    entryPoints: [path.join(rootDir, 'cli', 'index.ts')],
    outfile: path.join(rootDir, 'bin', 'cli.js'),
    platform: 'node',
    // CLI output must stay CommonJS because it is invoked in Node/Electron
    // contexts that load it via require semantics without ESM package mode.
    format: 'cjs',
    target: ['node24'],
    sourcemap: isProductionMode(mode) ? false : 'linked',
    plugins: [createNodeBuiltinsPlugin(), createIgnoreImportsPlugin()]
  };
};

const targetExecutionOrder: BuildTarget[] = ['hyper-app', 'renderer', 'cli'];

const watchBuild = async (options: BuildOptions): Promise<BuildContext> => {
  const buildContext = await context(options);
  await buildContext.watch();
  return buildContext;
};

const mirrorRendererBundleToDistLib = async (rootDir: string) => {
  const rendererOutputDir = path.join(rootDir, 'dist', 'app', 'renderer');
  const distLibDir = path.join(rootDir, 'dist', 'lib');
  const rendererBundleFiles = ['bundle.js', 'bundle.js.map', 'bundle.css', 'bundle.css.map'];
  const optionalRendererBundleFiles = new Set(['bundle.js.map', 'bundle.css', 'bundle.css.map']);

  await mkdir(distLibDir, {recursive: true});
  await Promise.all(
    rendererBundleFiles.map(async (fileName) => {
      try {
        await copyFile(path.join(rendererOutputDir, fileName), path.join(distLibDir, fileName));
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        if (errorCode === 'ENOENT' && optionalRendererBundleFiles.has(fileName)) {
          return;
        }

        throw error;
      }
    })
  );
};

const createTargetDescriptors = (): Record<BuildTarget, TargetDescriptor> => {
  return {
    'hyper-app': {
      runOneShot: async ({rootDir}) => {
        await copyHyperAppArtifacts({rootDir});
      },
      runWatch: async ({rootDir}) => {
        await copyHyperAppArtifacts({rootDir});
        return null;
      }
    },
    renderer: {
      runOneShot: async ({mode, rootDir}) => {
        await copyRendererArtifacts({rootDir});
        await build(createRendererBuildOptions(mode, rootDir));
        await mirrorRendererBundleToDistLib(rootDir);
      },
      runWatch: async ({mode, rootDir}) => {
        await copyRendererArtifacts({rootDir});
        return watchBuild(createRendererBuildOptions(mode, rootDir));
      }
    },
    cli: {
      runOneShot: async ({mode, rootDir}) => {
        await build(createCliBuildOptions(mode, rootDir));
      },
      runWatch: async ({mode, rootDir}) => {
        return watchBuild(createCliBuildOptions(mode, rootDir));
      }
    }
  };
};

const runTargets = async (options: RunEsbuildOptions) => {
  const rootDir = options.rootDir ?? process.cwd();
  await ensureDirectoryPath(path.join(rootDir, 'dist'));
  const targetSet = new Set(options.targets);
  const descriptors = createTargetDescriptors();

  if (!options.watch) {
    const oneShotBuilds = targetExecutionOrder
      .filter((target) => targetSet.has(target))
      .map((target) => descriptors[target].runOneShot({mode: options.mode, rootDir}));
    await Promise.all(oneShotBuilds);
    return;
  }

  const contexts: BuildContext[] = [];
  for (const target of targetExecutionOrder) {
    if (!targetSet.has(target)) {
      continue;
    }
    const watchContext = await descriptors[target].runWatch({mode: options.mode, rootDir});
    if (watchContext) {
      contexts.push(watchContext);
    }
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

/** Runs the selected esbuild targets in watch or one-shot mode. */
export const runEsbuild = async (options: RunEsbuildOptions) => {
  await runTargets(options);
};
