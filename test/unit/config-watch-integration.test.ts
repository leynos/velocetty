/**
 * @file Integration test for the config watcher and the real file system.
 *
 * This exercises AXIOM-WATCH: chokidar reports an atomic rename replacement as
 * a change or an add, and the trailing debounce collapses a save's event storm
 * into one reload. The adapter under test is the production one, so the test
 * proves the wiring the application ships rather than its own copy of it. The
 * settings-specific part — a self-written file reloads without announcing
 * itself — is decided by `shouldNotifyReload`, tested here as a table.
 */
import {describe, expect, test} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {createChokidarHandle} from '../../app/config/chokidar-handle';
import {errorCode} from '../../app/utils/error-code';
import {shouldNotifyReload} from '../../app/config/import-report';
import {createConfigWatcher} from '../../app/config/watcher';

const waitFor = async (predicate: () => boolean, timeoutMilliseconds = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met before the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const withTemporaryDirectory = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'velocetty-config-watch-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
};

type Probe = {reloads: number; isReady: boolean};

const startWatch = async (filePath: string): Promise<{probe: Probe; close: () => Promise<void>}> => {
  const probe: Probe = {reloads: 0, isReady: false};
  const debounced = createConfigWatcher<ReturnType<typeof setTimeout>>({
    cancel: (timer) => clearTimeout(timer),
    debounceMs: 100,
    fileNames: [filePath],
    handle: createChokidarHandle([path.dirname(filePath)]),
    onReady: () => {
      probe.isReady = true;
    },
    onReload: () => {
      probe.reloads += 1;
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs)
  });
  await waitFor(() => probe.isReady);
  return {probe, close: () => debounced.close()};
};

const RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RENAME_ATTEMPTS = 20;
const RENAME_RETRY_MS = 50;

type WatchLocation = {readonly directory: string; readonly filePath: string};

type RenameRequest = {readonly from: string; readonly to: string};

const renameWithRetry = async ({from, to}: RenameRequest): Promise<void> => {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      // Windows hands a transient EPERM to a rename over a file another
      // process has open. The production writer retries the same codes.
      const isRetryable = RETRYABLE_RENAME_CODES.has(errorCode(error) ?? '');
      if (!isRetryable || attempt === RENAME_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS));
    }
  }
};

type AtomicReplacement = WatchLocation & {readonly text: string};

const atomicReplace = async ({directory, filePath, text}: AtomicReplacement): Promise<void> => {
  const temporaryPath = path.join(directory, '.tmp-replacement');
  await fs.writeFile(temporaryPath, text);
  await renameWithRetry({from: temporaryPath, to: filePath});
};

const burstOfAtomicReplaces = async ({directory, filePath}: WatchLocation): Promise<void> => {
  // Write every temporary sibling first, then rename them together: awaiting
  // each replacement in turn let a loaded CI runner spread the events past the
  // debounce and legitimately produce two reloads.
  const replacements = [0, 1, 2, 3].map((index) => ({
    from: path.join(directory, `.tmp-burst-${index}`),
    text: `{config: {fontSize: ${16 + index}}}`,
    to: filePath
  }));
  await Promise.all(replacements.map(({from, text}) => fs.writeFile(from, text)));
  await Promise.all(replacements.map(({from, to}) => renameWithRetry({from, to})));
};

type WatchScenario = {
  readonly name: string;
  readonly change: (location: WatchLocation) => Promise<void>;
  readonly isFirstReload: (probe: Probe) => boolean;
  readonly settleMilliseconds: number;
};

const WATCH_SCENARIOS: readonly WatchScenario[] = [
  {
    name: 'an atomic replacement reloads exactly once',
    change: ({directory, filePath}) => atomicReplace({directory, filePath, text: '{config: {fontSize: 16}}'}),
    isFirstReload: (probe) => probe.reloads === 1,
    settleMilliseconds: 300
  },
  {
    name: 'a burst of writes collapses into one reload',
    change: burstOfAtomicReplaces,
    isFirstReload: (probe) => probe.reloads >= 1,
    settleMilliseconds: 400
  }
];

const runWatchScenario = async (scenario: WatchScenario): Promise<void> => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'config.json5');
    await fs.writeFile(filePath, '{config: {fontSize: 14}}');
    const {probe, close} = await startWatch(filePath);

    await scenario.change({directory, filePath});
    await waitFor(() => scenario.isFirstReload(probe));
    await new Promise((resolve) => setTimeout(resolve, scenario.settleMilliseconds));

    expect(probe.reloads).toBe(1);
    await close();
  });
};

describe('config watcher integration', () => {
  for (const scenario of WATCH_SCENARIOS) {
    test(scenario.name, () => runWatchScenario(scenario));
  }
});

describe('shouldNotifyReload', () => {
  test('an applied external change is announced', () => {
    expect(shouldNotifyReload({config: 'applied', keybindings: 'applied'}, false)).toBe(true);
  });

  test('a self-written change reloads without an announcement', () => {
    expect(shouldNotifyReload({config: 'applied', keybindings: 'applied'}, true)).toBe(false);
  });

  test('a fallback is never announced, whoever wrote it', () => {
    expect(shouldNotifyReload({config: 'fallback', keybindings: 'applied'}, false)).toBe(false);
  });
});
