#!/usr/bin/env bun

/**
 * Guard postinstall scripts that rely on Bun being available.
 *
 * This runs during `preinstall`, which executes before dependencies are
 * installed. It therefore avoids third-party modules and reads the pinned Bun
 * version directly from package.json.
 */
import {spawnSync} from 'node:child_process';
import packageMetadata from '../package.json' with {type: 'json'};

function readPinnedBunVersion() {
  const packageManager = packageMetadata.packageManager;
  const match = /^bun@(.+)$/.exec(packageManager);
  return match?.[1] ?? null;
}

function getMajor(version) {
  const major = version.split('.')[0];
  return Math.trunc(Number(major));
}

/**
 * Reads the installed Bun version, failing the install if Bun is unusable.
 *
 * A non-zero status and a spawn error are the two ways the probe can fail, and
 * both mean the same thing to the caller: there is no usable Bun to compare.
 */
function readInstalledBunVersion() {
  const bunCheck = spawnSync('bun', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (bunCheck.error || bunCheck.status !== 0) {
    throw new Error('Bun is required for this repository. Install Bun, then run `bun install`.');
  }

  return bunCheck.stdout.trim();
}

/** Reports whether a version string yields a numeric major component. */
function isComparableVersion(version) {
  return !Number.isNaN(getMajor(version));
}

function main() {
  const bunVersion = readInstalledBunVersion();
  const pinnedVersion = readPinnedBunVersion();

  if (!pinnedVersion) {
    return;
  }

  if (!isComparableVersion(bunVersion) || !isComparableVersion(pinnedVersion)) {
    console.warn(`Unable to compare Bun versions (found "${bunVersion}", pinned "${pinnedVersion}").`);
    return;
  }

  if (getMajor(bunVersion) !== getMajor(pinnedVersion)) {
    throw new Error(`Bun ${pinnedVersion} is pinned in package.json, but Bun ${bunVersion} was found.`);
  }

  if (bunVersion !== pinnedVersion) {
    console.warn(`Bun ${pinnedVersion} is pinned in package.json, but Bun ${bunVersion} was found.`);
  }
}

main();
