/**
 * @file Pins the readiness reconciliation the composition root performs at start-up.
 *
 * Chokidar scans a directory before it watches it, so an event for a file that
 * changed during the scan can be lost. These tests drive the real composition
 * root over real files, because reconciliation compares real file identities:
 * the baseline it uses must be taken before the start-up import reads the
 * files, or a save landing after that read would describe the file's new
 * identity while the application still holds the old content.
 */
import {writeFileSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {expect, mock, test} from 'bun:test';

import {createWatchHarness, makeParsedConfig, settle} from '../testUtils/config-watch-harness';

/** The bindings the user had when start-up read the file. */
const BEFORE = '{"window:new": ["ctrl+n"]}\n';

/** What a save leaves behind; a different length gives the file a new identity. */
const AFTER = '{"window:new": ["ctrl+shift+n"]}\n';

/**
 * Runs `body` against a fresh directory standing in for the Velocetty tree.
 *
 * The composition root stamps files with `statSync`, so readiness can only be
 * exercised honestly against real files.
 */
const withConfigDir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocetty-config-watch-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, {force: true, recursive: true});
  }
};

/** The phases the stub importer was asked to run, in order. */
const phases = (harness: Awaited<ReturnType<typeof createWatchHarness>>) =>
  harness.importMock.mock.calls.map(([phase]) => phase);

/**
 * Releases the watcher the way shutdown does.
 *
 * Closing cancels any queued debounce, so a failed assertion in one test cannot
 * leave a timer that reloads during the next one.
 */
const closeWatcher = (harness: Awaited<ReturnType<typeof createWatchHarness>>) => {
  const quitHandler = harness.appOnMock.mock.calls.find(([event]) => event === 'before-quit')?.[1];
  // SAFETY: the composition root registers `before-quit` as a zero-argument
  // callback, and this harness only observes the calls it made.
  const quit = quitHandler as (() => void) | undefined;
  quit?.();
};

test.serial('a save landing after the import read is reconciled at readiness', async () => {
  await withConfigDir(async (dir) => {
    const cfgPath = path.join(dir, 'config.json5');
    await writeFile(cfgPath, BEFORE);
    const harness = await createWatchHarness({
      configDir: dir,
      // The import has read BEFORE by now; the save replaces the file before
      // the composition root can capture a baseline of its own.
      onImport: (phase) => {
        if (phase === 'startup') {
          writeFileSync(cfgPath, AFTER);
        }
      }
    });
    try {
      harness.configModule.setup();
      harness.configModule.subscribe(harness.subscriberMock);
      // What the reload will apply once readiness notices the save.
      harness.setConfig(makeParsedConfig({'window:new': ['ctrl+shift+n']}));

      harness.emitReady();
      await settle();

      expect(phases(harness)).toEqual(['startup', 'reload']);
      expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
      expect(harness.notifyMock).toHaveBeenCalledWith('Configuration updated', 'Configuration reloaded!');
      // The point of the reload: the application now holds the saved bindings.
      expect(harness.configModule.getKeymaps()).toEqual(makeParsedConfig({'window:new': ['ctrl+shift+n']}).keymaps);
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});

test.serial('a burst queued before ready reloads once and drops its stale timer', async () => {
  await withConfigDir(async (dir) => {
    const cfgPath = path.join(dir, 'config.json5');
    await writeFile(cfgPath, BEFORE);
    const harness = await createWatchHarness({configDir: dir});
    try {
      harness.configModule.setup();
      harness.configModule.subscribe(harness.subscriberMock);

      writeFileSync(cfgPath, AFTER);
      harness.emit({event: 'change', eventPath: harness.cfgPath});
      // Readiness arrives before the debounce: the scan swallowed the event, so
      // reconciliation must reload now rather than waiting for the timer.
      harness.emitReady();

      expect(phases(harness)).toEqual(['startup', 'reload']);
      await settle();
      // Reconciliation cancelled that stale timer, so the burst reloads once.
      expect(phases(harness)).toEqual(['startup', 'reload']);
      expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});

test.serial('an untouched start-up reconciles nothing', async () => {
  await withConfigDir(async (dir) => {
    await writeFile(path.join(dir, 'config.json5'), BEFORE);
    const harness = await createWatchHarness({configDir: dir});
    try {
      harness.configModule.setup();
      harness.configModule.subscribe(harness.subscriberMock);

      harness.emitReady();
      await settle();

      expect(phases(harness)).toEqual(['startup']);
      expect(harness.subscriberMock).not.toHaveBeenCalled();
      expect(harness.notifyMock).not.toHaveBeenCalled();
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});

test.serial('a config file start-up bootstrapped is not reconciled', async () => {
  await withConfigDir(async (dir) => {
    const cfgPath = path.join(dir, 'config.json5');
    const harness = await createWatchHarness({
      configDir: dir,
      // Start-up writes the file it just decided to create.
      onImport: (phase) => {
        if (phase === 'startup') {
          writeFileSync(cfgPath, BEFORE);
        }
      }
    });
    try {
      // The import created the file with BEFORE and applied that same text.
      harness.setBootstrapped(true, BEFORE);

      harness.configModule.setup();
      harness.emitReady();
      await settle();

      // The application holds exactly what it wrote, so first run stays quiet.
      expect(phases(harness)).toEqual(['startup']);
      expect(harness.notifyMock).not.toHaveBeenCalled();
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});

test.serial('a keybindings file start-up seeded is not reconciled', async () => {
  await withConfigDir(async (dir) => {
    const keybindingsPath = path.join(dir, 'keybindings.json5');
    await writeFile(path.join(dir, 'config.json5'), BEFORE);
    const harness = await createWatchHarness({
      configDir: dir,
      // The service seeds the file from the legacy keymaps during start-up.
      onImport: (phase) => {
        if (phase === 'startup') {
          writeFileSync(keybindingsPath, '{}\n');
        }
      }
    });
    try {
      harness.setOutcome({keymaps: {}, kind: 'applied', origin: 'seeded', writtenText: '{}\n'});

      harness.configModule.setup();
      harness.configModule.subscribe(harness.subscriberMock);
      harness.emitReady();
      await settle();

      expect(phases(harness)).toEqual(['startup']);
      expect(harness.subscriberMock).not.toHaveBeenCalled();
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});

test.serial('an external edit to the bootstrapped config is reconciled', async () => {
  await withConfigDir(async (dir) => {
    const cfgPath = path.join(dir, 'config.json5');
    const harness = await createWatchHarness({
      configDir: dir,
      // Start-up writes BEFORE and applies it; another process replaces the
      // file before the composition root settles the baseline.
      onImport: (phase) => {
        if (phase === 'startup') {
          writeFileSync(cfgPath, BEFORE);
          writeFileSync(cfgPath, AFTER);
        }
      }
    });
    try {
      harness.setBootstrapped(true, BEFORE);

      harness.configModule.setup();
      harness.configModule.subscribe(harness.subscriberMock);
      // What the reload will apply once readiness notices the replacement.
      harness.setConfig(makeParsedConfig({'window:new': ['ctrl+shift+n']}));

      harness.emitReady();
      await settle();

      // Settling on the replacement's identity would compare the file against
      // itself, leaving the application on BEFORE until the next save.
      expect(phases(harness)).toEqual(['startup', 'reload']);
      expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
      expect(harness.notifyMock).toHaveBeenCalledWith('Configuration updated', 'Configuration reloaded!');
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});

test.serial('an external edit to the seeded keybindings is reconciled', async () => {
  await withConfigDir(async (dir) => {
    const keybindingsPath = path.join(dir, 'keybindings.json5');
    await writeFile(path.join(dir, 'config.json5'), BEFORE);
    const harness = await createWatchHarness({
      configDir: dir,
      // The service seeds the file, then a dotfile deploy replaces it before
      // the composition root settles the baseline.
      onImport: (phase) => {
        if (phase === 'startup') {
          writeFileSync(keybindingsPath, '{}\n');
          writeFileSync(keybindingsPath, AFTER);
        }
      }
    });
    try {
      harness.setOutcome({keymaps: {}, kind: 'applied', origin: 'seeded', writtenText: '{}\n'});

      harness.configModule.setup();
      harness.configModule.subscribe(harness.subscriberMock);
      harness.emitReady();
      await settle();

      expect(phases(harness)).toEqual(['startup', 'reload']);
      expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    } finally {
      closeWatcher(harness);
      mock.restore();
    }
  });
});
