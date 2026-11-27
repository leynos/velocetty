/**
 * @file Load ordering for the settings snapshot hook.
 *
 * A load is judged against the counters as they stand when it settles, so the
 * tests choose the settlement order by hand. The scenarios below are one
 * table: each names how many loads to start, the order their promises settle
 * in, and the banner and revision that must result. A late older revision must
 * not replace a newer one, an older failure must not replace a newer success,
 * the newest failure owns the banner, and only a success at least as new as
 * that failure may clear it.
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

/** Mounts a probe for the snapshot hook and returns a reader of its state. */
const mountSnapshotProbe = async (gateway: SettingsGateway): Promise<() => SettingsSnapshotState | null> => {
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

/** One load's answer, in the order the scenario settles them. */
type SettleAction = {
  readonly load: number;
  /** A failure message, or absent for a success. */
  readonly fail?: string;
  /** The revision a success carries. */
  readonly revision?: number;
  /** The value a success carries. */
  readonly fontSize?: number;
};

type Scenario = {
  readonly name: string;
  readonly loads: number;
  readonly actions: readonly SettleAction[];
  readonly error: string | null;
  readonly revision: number | null;
};

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a late older revision does not replace a newer snapshot',
    loads: 2,
    // The newer load settles first; the older one must not win afterwards.
    actions: [
      {load: 1, revision: 2, fontSize: 16},
      {load: 0, revision: 1, fontSize: 12}
    ],
    error: null,
    revision: 2
  },
  {
    name: 'an older failing load does not replace a newer success with an error',
    loads: 2,
    actions: [
      {load: 1, revision: 2, fontSize: 16},
      {load: 0, fail: 'stale failure'}
    ],
    error: null,
    revision: 2
  },
  {
    name: 'a failing load with no newer accepted load still reports the error',
    loads: 1,
    actions: [{load: 0, fail: 'cannot read'}],
    error: 'cannot read',
    revision: null
  },
  {
    name: 'an older success does not clear a newer failure',
    loads: 2,
    actions: [
      {load: 1, fail: 'reload failed'},
      {load: 0, revision: 1}
    ],
    error: 'reload failed',
    revision: 1
  },
  {
    name: 'an older failure does not take the banner from a newer one',
    loads: 3,
    // The newest fails, then the oldest; the middle load then succeeds, which
    // must not clear a failure that is newer than it.
    actions: [
      {load: 2, fail: 'newest failure'},
      {load: 0, fail: 'oldest failure'},
      {load: 1, revision: 1}
    ],
    error: 'newest failure',
    revision: 1
  },
  {
    name: 'a newer failing load reports even when an older load succeeded',
    loads: 2,
    actions: [
      {load: 0, revision: 1},
      {load: 1, fail: 'newer failure'}
    ],
    error: 'newer failure',
    revision: 1
  }
];

/** Starts `loads` loads and settles each action in order. */
const runScenario = async (scenario: Scenario): Promise<() => SettingsSnapshotState | null> => {
  const recording = createRecordingGateway();
  const current = await mountSnapshotProbe(recording.gateway);
  for (let started = 1; started < scenario.loads; started += 1) {
    await settle(() => recording.notifyChange());
  }
  expect(recording.loads).toHaveLength(scenario.loads);
  for (const action of scenario.actions) {
    await settle(() => {
      const pending = recording.loads[action.load];
      if (action.fail === undefined) {
        pending.resolve(snapshotOf(action.revision ?? 1, {fontSize: action.fontSize ?? 12}));
      } else {
        pending.reject(new Error(action.fail));
      }
    });
  }
  return current;
};

describe('useSettingsSnapshot', () => {
  for (const scenario of SCENARIOS) {
    test(scenario.name, async () => {
      const current = await runScenario(scenario);

      expect(current()?.loadError ?? null).toBe(scenario.error);
      expect(current()?.snapshot?.revision ?? null).toBe(scenario.revision);
    });
  }
});
