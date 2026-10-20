#!/usr/bin/env bun
/** @file Runs electron-builder with a sanitized environment. */
import {spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const electronBuilderCli = path.resolve(repositoryRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

const args = process.argv.slice(2);
const env = {...process.env};

delete env.npm_execpath;
delete env.npm_node_execpath;

const preserveNpmAuth = process.env.ELECTRON_BUILDER_PRESERVE_NPM_AUTH === '1';
if (!preserveNpmAuth) {
  // electron-builder install-app-deps can inherit CI tokens that fail against
  // public packages. Keep authenticated installs available by explicit opt-in.
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
  for (const key of npmAuthVars) delete env[key];
}

const buildPlatformMap = {darwin: 'mac', win32: 'win', linux: 'linux'};
const buildPlatform = buildPlatformMap[process.platform];
const bunBinaryName = process.platform === 'win32' ? 'bun.exe' : 'bun';
const isBunRuntime = Boolean(process.versions.bun);
const bunSource = isBunRuntime ? process.execPath : null;

const stageBunForPackaging = () => {
  if (!buildPlatform) return;
  if (!isBunRuntime) throw new Error('Bun staging requires running this script via Bun.');

  const bunTargetDir = path.resolve(repositoryRoot, 'build', buildPlatform);
  const bunTarget = path.resolve(bunTargetDir, bunBinaryName);
  mkdirSync(bunTargetDir, {recursive: true});
  if (!bunSource || !existsSync(bunSource)) {
    throw new Error(`Bun binary not found at ${bunSource ?? 'unknown path'}.`);
  }
  copyFileSync(bunSource, bunTarget);
  if (process.platform !== 'win32') chmodSync(bunTarget, 0o755);
};

const main = () => {
  stageBunForPackaging();
  if (!existsSync(electronBuilderCli)) {
    throw new Error(`electron-builder CLI not found at ${electronBuilderCli}. Run bun install.`);
  }

  const result = spawnSync(process.execPath, [electronBuilderCli, ...args], {stdio: 'inherit', env});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
};

main();
