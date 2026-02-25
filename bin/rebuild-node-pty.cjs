const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const moduleRoot = path.join(repoRoot, 'target', 'node_modules', 'node-pty');
const nodeGypPath = path.join(repoRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const packageJsonPath = path.join(repoRoot, 'package.json');
const nodeExecutable = process.env.NODE || 'node';

const normalizeVersion = (value) => {
  if (typeof value !== 'string') {
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

if (process.env.SKIP_NODE_PTY_REBUILD === '1') {
  console.log('Skipping node-pty rebuild because SKIP_NODE_PTY_REBUILD=1.');
  process.exit(0);
}

if (!fs.existsSync(moduleRoot)) {
  console.error(`node-pty module not found at ${moduleRoot}. Run bun install first.`);
  process.exit(1);
}

if (!fs.existsSync(nodeGypPath)) {
  console.error(`node-gyp binary not found at ${nodeGypPath}. Run bun install first.`);
  process.exit(1);
}

if (!electronTarget) {
  console.error(`Unable to determine Electron target version from npm env or ${packageJsonPath}.`);
  process.exit(1);
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

process.exit(result.status ?? 1);
