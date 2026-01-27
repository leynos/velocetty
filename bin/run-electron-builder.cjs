#!/usr/bin/env node

/**
 * Run the local electron-builder CLI with a sanitized environment.
 *
 * Bun sets npm-specific environment variables that cause electron-builder to
 * execute the Bun binary via Node (for example: `node /path/to/bun`), which
 * fails with a syntax error. Clearing these variables keeps the execution
 * path consistent and local to this repository.
 */
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const electronBuilderCli = resolve(
  __dirname,
  "..",
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js",
);

const args = process.argv.slice(2);
const env = { ...process.env };

delete env.npm_execpath;
delete env.npm_node_execpath;

const result = spawnSync(process.execPath, [electronBuilderCli, ...args], {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error("Failed to run electron-builder:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

