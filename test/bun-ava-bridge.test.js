/**
 * @file Bridge Bun's test runner to the existing AVA test suite.
 *
 * The repository's unit tests are written for AVA and executed via Node.
 * Bun's test runner requires `.test`/`.spec` filenames, so provide a single
 * Bun-native test that shells out to AVA and asserts that it succeeds.
 */
const {spawnSync} = require('node:child_process');
const {expect, test} = require('bun:test');

function resolveAvaCliPath() {
  return require.resolve('ava/cli');
}

test('AVA unit suite passes', () => {
  const avaCliPath = resolveAvaCliPath();
  const result = spawnSync('node', [avaCliPath, '--config', 'ava.config.js'], {
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  expect(result.status ?? 1).toBe(0);
});
