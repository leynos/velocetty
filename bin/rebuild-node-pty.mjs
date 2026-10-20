import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const moduleRoot = path.join(repoRoot, 'dist', 'app', 'node_modules', 'node-pty');
const nodeGypPath = path.join(repoRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const packageJsonPath = path.join(repoRoot, 'package.json');
const nodeExecutable = process.env.NODE || 'node';

/** @param {unknown} value @returns {value is string} */
const isString = (value) => String(value) === value;

const normalizeVersion = (value) => {
  if (!isString(value)) {
    return '';
  }

  // npm ranges like ^40.2.1 are invalid for node-gyp --target.
  return value.replace(/^[^\d]*/, '');
};

const readElectronTargetFromPackageJson = () => {
  if (!fs.existsSync(packageJsonPath)) {
    return '';
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return normalizeVersion(packageJson?.devDependencies?.electron);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse ${packageJsonPath}: ${details}`);
    return '';
  }
};

const electronTarget =
  normalizeVersion(process.env.npm_package_devDependencies_electron) || readElectronTargetFromPackageJson();

const main = () => {
  if (process.env.SKIP_NODE_PTY_REBUILD === '1') {
    console.log('Skipping node-pty rebuild because SKIP_NODE_PTY_REBUILD=1.');
    return;
  }

  if (!fs.existsSync(moduleRoot)) {
    throw new Error(`node-pty module not found at ${moduleRoot}. Run bun install first.`);
  }

  if (!fs.existsSync(nodeGypPath)) {
    throw new Error(`node-gyp binary not found at ${nodeGypPath}. Run bun install first.`);
  }

  if (!electronTarget) {
    throw new Error(`Unable to determine Electron target version from npm env or ${packageJsonPath}.`);
  }

  const result = spawnSync(
    nodeExecutable,
    [
      nodeGypPath,
      'rebuild',
      '--runtime=electron',
      `--target=${electronTarget}`,
      '--dist-url=https://www.electronjs.org/headers',
      '--build-from-source',
      '--verbose'
    ],
    {
      cwd: moduleRoot,
      stdio: 'inherit',
      env: process.env
    }
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
};

main();
