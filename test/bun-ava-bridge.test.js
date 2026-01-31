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

const avaUnitTimeoutMs = 30_000;
const avaE2eTimeoutMs = 120_000;

function resolveAvaCliPath() {
  const avaPackagePath = require.resolve('ava/package.json');
  return path.join(path.dirname(avaPackagePath), 'entrypoints', 'cli.mjs');
}

function runAvaSuite(configFile) {
  const avaCliPath = resolveAvaCliPath();
  const result = spawnSync('node', [avaCliPath, '--config', configFile], {
    env: {...process.env, AVA_FORCE_CLEAN_EXIT: '1'},
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  expect(result.status ?? 1).toBe(0);
}

test(
  'AVA unit suite passes',
  () => {
    runAvaSuite('ava.config.js');
  },
  avaUnitTimeoutMs
);

const e2eTest = process.env.RUN_E2E === '1' ? test : test.skip;

e2eTest(
  'AVA e2e suite passes',
  () => {
    runAvaSuite('ava-e2e.config.js');
  },
  avaE2eTimeoutMs
);
