/**
 * @file Bridge Bun's test runner to the existing AVA test suite.
 *
 * The repository's unit tests are written for AVA and executed via Node.
 * Bun's test runner requires `.test`/`.spec` filenames, so provide a single
 * Bun-native test that shells out to AVA and asserts that it succeeds.
 */
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {expect, test} = require('bun:test');

function resolveAvaCliPath() {
  const avaPackagePath = require.resolve('ava/package.json');
  return path.join(path.dirname(avaPackagePath), 'entrypoints', 'cli.mjs');
}

test('AVA unit suite passes', () => {
  const avaCliPath = resolveAvaCliPath();
  const result = spawnSync('node', [avaCliPath, '--config', 'ava.config.js'], {
    env: {...process.env, AVA_FORCE_CLEAN_EXIT: '1'},
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  expect(result.status ?? 1).toBe(0);
});
