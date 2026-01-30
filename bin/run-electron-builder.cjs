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
const {existsSync} = require('node:fs');
const {resolve} = require('node:path');

const electronBuilderCli = resolve(__dirname, '..', 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

const args = process.argv.slice(2);
const env = {...process.env};

delete env.npm_execpath;
delete env.npm_node_execpath;

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
