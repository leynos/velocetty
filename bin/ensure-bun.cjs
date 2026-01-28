#!/usr/bin/env bun

/**
 * Guard postinstall scripts that rely on Bun being available.
 *
 * This runs during `preinstall`, which executes before dependencies are
 * installed. It therefore avoids third-party modules and reads the pinned Bun
 * version directly from package.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function readPinnedBunVersion() {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const packageManager = packageJson.packageManager;

  if (typeof packageManager !== 'string') {
    return null;
  }

  const match = /^bun@(.+)$/.exec(packageManager);
  return match?.[1] ?? null;
}

function getMajor(version) {
  const major = version.split('.')[0];
  return Number.parseInt(major, 10);
}

const bunCheck = spawnSync('bun', ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

if (bunCheck.error || bunCheck.status !== 0) {
  console.error('Bun is required for this repository.');
  console.error('Install Bun, then run `bun install`.');
  process.exit(1);
}

const bunVersion = bunCheck.stdout.trim();
const pinnedVersion = readPinnedBunVersion();

if (!pinnedVersion) {
  process.exit(0);
}

if (Number.isNaN(getMajor(bunVersion)) || Number.isNaN(getMajor(pinnedVersion))) {
  console.warn(`Unable to compare Bun versions (found "${bunVersion}", pinned "${pinnedVersion}").`);
  process.exit(0);
}

if (getMajor(bunVersion) !== getMajor(pinnedVersion)) {
  console.error(`Bun ${pinnedVersion} is pinned in package.json, but Bun ${bunVersion} was found.`);
  console.error('Install the pinned Bun version to avoid toolchain drift.');
  process.exit(1);
}

if (bunVersion !== pinnedVersion) {
  console.warn(`Bun ${pinnedVersion} is pinned in package.json, but Bun ${bunVersion} was found.`);
}
