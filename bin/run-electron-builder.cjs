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

const preserveNpmAuth = process.env.ELECTRON_BUILDER_PRESERVE_NPM_AUTH === '1';
if (!preserveNpmAuth) {
  // electron-builder install-app-deps shells out to npm and can inherit auth tokens
  // from the CI environment. Invalid tokens trigger 403 when fetching public packages
  // such as p-finally. Drop the auth variables by default so the CLI reads from the
  // public registry anonymously; set ELECTRON_BUILDER_PRESERVE_NPM_AUTH=1 to keep them
  // if you need a private registry.
  const npmAuthVars = [
    'NPM_TOKEN',
    'npm_token',
    'NPM_CONFIG__AUTH',
    'NPM_CONFIG__AUTH_TOKEN',
    'NPM_CONFIG_AUTH_TOKEN',
    'npm_config__auth',
    'npm_config__authToken',
    'npm_config_auth',
    'npm_config_auth_token'
  ];
  for (const key of npmAuthVars) {
    delete env[key];
  }
}

const buildPlatformMap = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux'
};
const buildPlatform = buildPlatformMap[process.platform];
const bunBinaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';
const isBunRuntime = Boolean(process.versions?.bun);
const bunSource = isBunRuntime ? process.execPath : null;

if (buildPlatform && !isBunRuntime) {
  console.error('Bun staging requires running this script via Bun.');
  process.exit(1);
}

if (buildPlatform && isBunRuntime) {
  const bunTargetDir = resolve(__dirname, '..', 'build', buildPlatform);
  const bunTarget = resolve(bunTargetDir, bunBinaryName);

  try {
    mkdirSync(bunTargetDir, {recursive: true});
    if (!bunSource || !existsSync(bunSource)) {
      throw new Error(`Bun binary not found at ${bunSource ?? 'unknown path'}.`);
    }
    copyFileSync(bunSource, bunTarget);
    if (process.platform !== 'win32') {
      chmodSync(bunTarget, 0o755);
    }
  } catch (error) {
    console.error('Failed to stage Bun binary for packaging:', error);
    process.exit(1);
  }
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
