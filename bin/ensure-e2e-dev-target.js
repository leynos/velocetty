#!/usr/bin/env bun

/**
 * @file Ensures development Electron target artefacts exist before fast E2E runs.
 * Invariant: `target/` must contain runnable app entrypoints for direct Electron
 * CLI launches used by development-lane E2E tests.
 */

const {existsSync} = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const requiredTargetFiles = [
  'target/index.js',
  'target/index.html',
  'target/package.json',
  'target/renderer/bundle.js'
];

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
    console.log('[e2e:prepare] Development target already present.');
    return;
  }

  console.log(
    `[e2e:prepare] Missing development target artefacts (${missingBeforeBuild.join(', ')}). Rebuilding target for E2E.`
  );

  runBunCommand('Build Hyper app and renderer artefacts', [
    './build/esbuild/build.ts',
    '--mode=production',
    '--target=hyper-app,renderer'
  ]);

  runBunCommand('Compile Electron main-process target', ['x', 'tsgo', '--project', 'app/tsconfig.json', '-v']);

  const missingAfterBuild = getMissingTargetFiles();
  if (missingAfterBuild.length > 0) {
    throw new Error(
      `[e2e:prepare] Development target is still incomplete after rebuild. Missing: ${missingAfterBuild.join(', ')}`
    );
  }

  console.log('[e2e:prepare] Development target rebuild complete.');
};

ensureDevelopmentTarget();
