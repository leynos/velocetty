/**
 * @file Load ordering for the settings snapshot hook.
 *
 * A load is judged against the counters as they stand when it settles, so the
 * tests choose the settlement order by hand. The rules under test: a late older
 * revision must not replace a newer one, an older failure must not replace a
 * newer success, the newest failure owns the banner, and only a success at
 * least as new as that failure may clear it.
 */
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

import {afterEach, beforeEach, describe, expect, test} from 'bun:test';

import {useSettingsSnapshot, type SettingsSnapshotState} from '../../lib/settings/hooks/use-settings-snapshot';
import type {SettingsGateway} from '../../lib/settings/ports';
import {createRecordingGateway, snapshotOf} from '../testUtils/settings-snapshot-fixtures';
import {setupHappyDom} from '../testUtils/happy-dom';

let cleanup: (() => void) | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  cleanup = await setupHappyDom();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  cleanup?.();
  root = null;
  container = null;
  cleanup = null;
});

/** Reads the newest hook state the probe observed. */
type ProbeReader = () => SettingsSnapshotState | null;

/** Mounts a probe for the snapshot hook and returns its latest state. */
const mountSnapshotProbe = async (gateway: SettingsGateway): Promise<ProbeReader> => {
  let latest: SettingsSnapshotState | null = null;
  const Probe = () => {
    latest = useSettingsSnapshot(gateway);
    return null;
  };
  await act(async () => {
    root?.render(<Probe />);
  });
  return () => latest;
};

/** Runs one state change inside React's act boundary. */
const settle = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
  });
};

describe('useSettingsSnapshot', () => {
  test('a late older revision does not replace a newer snapshot', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);
    expect(recording.loads).toHaveLength(1);

    await settle(() => recording.notifyChange());
    expect(recording.loads).toHaveLength(2);

    // The newer load settles first; the older one must not win afterwards.
    await settle(() => recording.loads[1]?.resolve(snapshotOf(2, {fontSize: 16})));
    expect(current()?.snapshot?.revision).toBe(2);

    await settle(() => recording.loads[0]?.resolve(snapshotOf(1, {fontSize: 12})));
    expect(current()?.snapshot?.revision).toBe(2);
    expect(current()?.snapshot?.userValues).toEqual({fontSize: 16});
  });

  test('an older failing load does not replace a newer success with an error', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);
    expect(recording.loads).toHaveLength(1);

    await settle(() => recording.notifyChange());
    expect(recording.loads).toHaveLength(2);

    // The newer load succeeds and is shown; the older one fails afterwards.
    await settle(() => recording.loads[1]?.resolve(snapshotOf(2, {fontSize: 16})));
    expect(current()?.snapshot?.revision).toBe(2);
    expect(current()?.loadError).toBeNull();

    await settle(() => recording.loads[0]?.reject(new Error('stale failure')));

    expect(current()?.snapshot?.revision).toBe(2);
    expect(current()?.loadError).toBeNull();
  });

  test('a failing load with no newer accepted load still reports the error', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);

    await settle(() => recording.loads[0]?.reject(new Error('cannot read')));

    expect(current()?.loadError).toBe('cannot read');
    expect(current()?.isLoading).toBe(false);
  });

  test('an older success does not clear a newer failure', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);
    expect(recording.loads).toHaveLength(1);

    await settle(() => recording.notifyChange());
    expect(recording.loads).toHaveLength(2);

    // The newer load fails first; the older load succeeds afterwards.
    await settle(() => recording.loads[1]?.reject(new Error('reload failed')));
    expect(current()?.loadError).toBe('reload failed');

    await settle(() => recording.loads[0]?.resolve(snapshotOf(1, {fontSize: 12})));

    // The banner stays: its failure is newer than the success that settled.
    expect(current()?.loadError).toBe('reload failed');
  });

  test('an older failure does not take the banner from a newer one', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);

    await settle(() => recording.notifyChange());
    await settle(() => recording.notifyChange());
    expect(recording.loads).toHaveLength(3);

    // The newest load fails first, then the oldest fails too.
    await settle(() => recording.loads[2]?.reject(new Error('newest failure')));
    await settle(() => recording.loads[0]?.reject(new Error('oldest failure')));
    expect(current()?.loadError).toBe('newest failure');

    // A success from the middle load must not clear the newest failure, even
    // though it started after the oldest one.
    await settle(() => recording.loads[1]?.resolve(snapshotOf(1, {fontSize: 12})));

    expect(current()?.loadError).toBe('newest failure');
  });

  test('a newer failing load reports even when an older load succeeded', async () => {
    const recording = createRecordingGateway();
    const current = await mountSnapshotProbe(recording.gateway);
    await settle(() => recording.loads[0]?.resolve(snapshotOf(1)));

    await settle(() => recording.notifyChange());
    await settle(() => recording.loads[1]?.reject(new Error('newer failure')));

    expect(current()?.snapshot?.revision).toBe(1);
    expect(current()?.loadError).toBe('newer failure');
  });
});
