#!/usr/bin/env bun

/**
 * @file Ensures development Electron target artefacts exist before fast E2E runs.
 * Invariant: `dist/app/` must contain runnable app entrypoints for direct
 * Electron CLI launches used by development-lane E2E tests.
 */

const {cpSync, existsSync, rmSync, symlinkSync} = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const requiredTargetFiles = [
  'dist/app/index.js',
  'dist/app/index.html',
  'dist/app/package.json',
  'dist/app/renderer/bundle.js'
];

const tsBuildInfoPath = path.join(repositoryRoot, 'dist/app/tsconfig.tsbuildinfo');

const targetNodeModulesPath = path.join(repositoryRoot, 'dist/app/node_modules');
const appNodeModulesPath = path.join(repositoryRoot, 'app/node_modules');

const clearStaleTsBuildInfo = () => {
  if (existsSync(tsBuildInfoPath)) {
    rmSync(tsBuildInfoPath);
  }
};

const ensureTargetNodeModules = () => {
  if (existsSync(targetNodeModulesPath)) {
    return;
  }

  if (!existsSync(appNodeModulesPath)) {
    throw new Error('[e2e:prepare] app/node_modules is required to run the development Electron target.');
  }

  const symlinkTarget = path.relative(path.dirname(targetNodeModulesPath), appNodeModulesPath);

  try {
    symlinkSync(symlinkTarget, targetNodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');
    console.log('[e2e:prepare] Linked dist/app/node_modules to app/node_modules.');
    return;
  } catch (error) {
    console.warn('[e2e:prepare] Could not create node_modules symlink, falling back to copy.', error);
  }

  cpSync(appNodeModulesPath, targetNodeModulesPath, {recursive: true, dereference: false});
  console.log('[e2e:prepare] Copied app/node_modules into dist/app/node_modules.');
};

const getMissingTargetFiles = () => {
  return requiredTargetFiles.filter((relativePath) => !existsSync(path.join(repositoryRoot, relativePath)));
};

const runBunCommand = (description, args) => {
  console.log(`[e2e:prepare] ${description}`);
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed (${description}) with exit code ${result.status ?? 1}.`);
  }
};

const ensureDevelopmentTarget = () => {
  const missingBeforeBuild = getMissingTargetFiles();
  if (missingBeforeBuild.length === 0) {
    ensureTargetNodeModules();
    console.log('[e2e:prepare] Development app output already present.');
    return;
  }

  console.log(
    `[e2e:prepare] Missing development app output artefacts (${missingBeforeBuild.join(', ')}). Rebuilding dist/app for E2E.`
  );

  runBunCommand('Build Hyper app and renderer artefacts', [
    './build/esbuild/build.ts',
    '--mode=production',
    '--target=hyper-app,renderer'
  ]);

  clearStaleTsBuildInfo();

  runBunCommand('Compile Electron main-process output', ['x', 'tsgo', '--project', 'app/tsconfig.json']);

  ensureTargetNodeModules();

  const missingAfterBuild = getMissingTargetFiles();
  if (missingAfterBuild.length > 0) {
    throw new Error(
      `[e2e:prepare] Development app output is still incomplete after rebuild. Missing: ${missingAfterBuild.join(', ')}`
    );
  }

  console.log('[e2e:prepare] Development app output rebuild complete.');
};

ensureDevelopmentTarget();
