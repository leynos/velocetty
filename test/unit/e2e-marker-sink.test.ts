/**
 * @file Proves the end-to-end marker sink stays silent outside the lane.
 *
 * The lane reads the application's standard output, so a marker printed by a
 * normal run would corrupt every assertion it makes. The composition root
 * decides whether the lane is running and hands the sink that decision, so
 * these tests pin the sink's behaviour and the start-up path that uses it.
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

import {createMarkerSink, silentMarkerSink} from '../../app/config/e2e-marker-sink';
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

test('a marker sink stays silent while the lane flag is false', () => {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const marker = createMarkerSink(
      () => false,
      (line) => console.log(line)
    );
    marker('[e2e] renderer-ready');

    // A normal run prints no marker, so the lane's stream stays uncontaminated.
    expect(logSpy.mock.calls).toEqual([]);
  } finally {
    logSpy.mockRestore();
  }
});

test('a marker sink writes the marker line once while the lane runs', () => {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const marker = createMarkerSink(
      () => true,
      (line) => console.log(line)
    );
    marker('[e2e] renderer-ready');

    expect(logSpy.mock.calls).toEqual([['[e2e] renderer-ready']]);
  } finally {
    logSpy.mockRestore();
  }
});

test('a marker sink reads the lane flag per line, not once at construction', () => {
  const lines: string[] = [];
  let isLaneRunning = false;
  const marker = createMarkerSink(
    () => isLaneRunning,
    (line) => lines.push(line)
  );

  marker('[e2e] before');
  isLaneRunning = true;
  marker('[e2e] after');

  // A test that starts the lane after loading the composition root still has to
  // observe the markers it prints.
  expect(lines).toEqual(['[e2e] after']);
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
