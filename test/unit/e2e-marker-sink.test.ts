/**
 * @file Proves the end-to-end marker sink stays silent outside the lane.
 *
 * The lane reads the application's standard output, so a marker printed by a
 * normal run would corrupt every assertion it makes. The sink checks the lane
 * flag itself, and the composition root receives it explicitly, so these tests
 * pin both the sink's behaviour and the start-up path that uses it.
 *
 * Cross-links:
 * - Source: `app/config/e2e-marker-sink.ts`
 * - Composition root: `app/config.ts`
 * - Harness: `test/testUtils/config-watch-harness.ts`
 */
import {expect, mock, spyOn, test} from 'bun:test';

import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {emitE2EMarker, silentMarkerSink} from '../../app/config/e2e-marker-sink';
import {createWatchHarness, settle} from '../testUtils/config-watch-harness';

/** Restores one environment variable to the value it had before a test. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Runs `body` against a fresh directory standing in for the Velocetty tree. */
const withConfigDir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocetty-marker-sink-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, {force: true, recursive: true});
  }
};

/** Releases the watcher the way shutdown does. */
const closeWatcher = (harness: Awaited<ReturnType<typeof createWatchHarness>>) => {
  const quitHandler = harness.appOnMock.mock.calls.find(([event]) => event === 'before-quit')?.[1];
  // SAFETY: the composition root registers `before-quit` as a zero-argument
  // callback, and this harness only observes the calls it made.
  const quit = quitHandler as (() => void) | undefined;
  quit?.();
};

test('silentMarkerSink writes nothing to the marker stream', () => {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  try {
    silentMarkerSink('[e2e] renderer-ready');
    silentMarkerSink('[e2e] config-watcher-ready');

    expect(logSpy.mock.calls).toEqual([]);
  } finally {
    logSpy.mockRestore();
  }
});

test.serial('emitE2EMarker stays silent when the lane flag is unset', () => {
  const previousRunE2E = process.env.RUN_E2E;
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  delete process.env.RUN_E2E;
  try {
    emitE2EMarker('[e2e] renderer-ready');

    // A normal run prints no marker, so the lane's stream stays uncontaminated.
    expect(logSpy.mock.calls).toEqual([]);
  } finally {
    restoreEnv('RUN_E2E', previousRunE2E);
    logSpy.mockRestore();
  }
});

test.serial('emitE2EMarker writes the marker line once in the lane', () => {
  const previousRunE2E = process.env.RUN_E2E;
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  process.env.RUN_E2E = '1';
  try {
    emitE2EMarker('[e2e] renderer-ready');

    expect(logSpy.mock.calls).toEqual([['[e2e] renderer-ready']]);
  } finally {
    restoreEnv('RUN_E2E', previousRunE2E);
    logSpy.mockRestore();
  }
});

test.serial('a normal start-up emits no marker line', async () => {
  await withConfigDir(async (dir) => {
    await writeFile(path.join(dir, 'config.json5'), '{"window:new": ["ctrl+n"]}\n');
    const previousRunE2E = process.env.RUN_E2E;
    delete process.env.RUN_E2E;
    const harness = await createWatchHarness({configDir: dir});
    // Installed after the harness, because it restores every mock it inherits,
    // which would otherwise drop the spy before start-up runs.
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      harness.configModule.setup();
      harness.emitReady();
      await settle();

      // Other collaborators legitimately log; only marker lines are forbidden.
      const markerLines = logSpy.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('[e2e]'));
      expect(markerLines).toEqual([]);
    } finally {
      closeWatcher(harness);
      restoreEnv('RUN_E2E', previousRunE2E);
      mock.restore();
    }
  });
});
