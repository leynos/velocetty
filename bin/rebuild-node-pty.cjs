const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const moduleRoot = path.join(repoRoot, 'target', 'node_modules', 'node-pty');
const nodeGypPath = path.join(repoRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');

if (!fs.existsSync(moduleRoot)) {
  console.error(`node-pty module not found at ${moduleRoot}. Run bun install first.`);
  process.exit(1);
}

if (!fs.existsSync(nodeGypPath)) {
  console.error(`node-gyp binary not found at ${nodeGypPath}. Run bun install first.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    nodeGypPath,
    'rebuild',
    '--runtime=electron',
    `--target=${process.env.npm_package_devDependencies_electron || '40.2.1'}`,
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
