#!/usr/bin/env bun

/**
 * Run the local electron-builder CLI with a sanitized environment.
 *
 * Bun sets npm-specific environment variables that cause electron-builder to
 * execute the Bun binary via Node (for example: `node /path/to/bun`), which
 * fails with a syntax error. Clearing these variables keeps the execution
 * path consistent and local to this repository.
 */
const {spawnSync} = require('node:child_process');
const {chmodSync, copyFileSync, existsSync, mkdirSync} = require('node:fs');
const {resolve} = require('node:path');

const electronBuilderCli = resolve(__dirname, '..', 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

const args = process.argv.slice(2);
const env = {...process.env};

delete env.npm_execpath;
delete env.npm_node_execpath;

const buildPlatformMap = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux'
};
const buildPlatform = buildPlatformMap[process.platform];
const bunBinaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';
const bunSource = process.execPath;
const isBunRuntime = Boolean(process.versions?.bun);

if (buildPlatform && isBunRuntime) {
  const bunTargetDir = resolve(__dirname, '..', 'build', buildPlatform);
  const bunTarget = resolve(bunTargetDir, bunBinaryName);

  try {
    mkdirSync(bunTargetDir, {recursive: true});
    if (!existsSync(bunSource)) {
      throw new Error(`Bun binary not found at ${bunSource}.`);
    }
    copyFileSync(bunSource, bunTarget);
    if (process.platform !== 'win32') {
      chmodSync(bunTarget, 0o755);
    }
  } catch (error) {
    console.warn('Failed to stage Bun binary for packaging:', error);
  }
} else if (buildPlatform && !isBunRuntime) {
  console.warn('Skipping Bun staging because the runner is not Bun.');
}

if (!existsSync(electronBuilderCli)) {
  console.error(`electron-builder CLI not found at ${electronBuilderCli}. Run bun install.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [electronBuilderCli, ...args], {
  stdio: 'inherit',
  env
});

if (result.error) {
  console.error('Failed to run electron-builder:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`electron-builder exited with code ${result.status ?? 'unknown'}.`);
  process.exit(result.status ?? 1);
}

process.exit(0);
