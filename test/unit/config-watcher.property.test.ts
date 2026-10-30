/** @file KB-WATCH-1: a burst of configuration events yields exactly one reload. */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {createConfigWatcher, type WatcherEvent, type WatcherHandle} from '../../app/config/watcher';

const DEBOUNCE_MS = 100;
const PROPERTY_SEED = 20_261_031;
const PROPERTY_RUNS = 200;
const NO_EVENTS = 0;

const CONFIG_PATH = '/cfg/config.json5';
const KEYBINDINGS_PATH = '/cfg/keybindings.json5';
const WATCHED_PATHS = [CONFIG_PATH, KEYBINDINGS_PATH] as const;

type ScheduledTimer = {readonly callback: () => void; readonly due: number; readonly id: number};

/**
 * A fake clock with the ordering KB-WATCH-1 specifies.
 *
 * Due timers fire before an event delivered at the same instant, so a gap of
 * exactly `debounceMs` closes one burst and opens the next.
 */
const createFakeClock = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();

  const schedule = (callback: () => void, delayMs: number) => {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError(`Delay must be finite and non-negative, received ${delayMs}`);
    }
    const id = nextId;
    nextId += 1;
    timers.set(id, {callback, due: now + delayMs, id});
    return id;
  };

  const cancel = (id: number) => {
    timers.delete(id);
  };

  const earliestDueTimer = (limit: number): ScheduledTimer | undefined => {
    let earliest: ScheduledTimer | undefined;
    for (const timer of timers.values()) {
      if (timer.due > limit) {
        continue;
      }
      if (
        earliest === undefined ||
        timer.due < earliest.due ||
        (timer.due === earliest.due && timer.id < earliest.id)
      ) {
        earliest = timer;
      }
    }
    return earliest;
  };

  /** Runs every timer due at or before `limit`, in due order. */
  const advanceTo = (limit: number) => {
    for (;;) {
      const timer = earliestDueTimer(limit);
      if (timer === undefined) {
        break;
      }
      timers.delete(timer.id);
      now = timer.due;
      timer.callback();
    }
    now = Math.max(now, limit);
  };

  return {advanceTo, cancel, now: () => now, pendingCount: () => timers.size, schedule};
};

type FakeHandle = {
  readonly handle: WatcherHandle;
  readonly emit: (event: WatcherEvent, eventPath: string) => void;
  readonly isClosed: () => boolean;
  readonly signalError: (error: unknown) => void;
  readonly signalReady: () => void;
};

/** A `WatcherHandle` whose events and readiness the test drives directly. */
const createFakeHandle = (): FakeHandle => {
  const listeners: Record<WatcherEvent, ((eventPath: string) => void)[]> = {add: [], change: [], unlink: []};
  let readyListener: (() => void) | undefined;
  let errorListener: ((error: unknown) => void) | undefined;
  let isClosed = false;

  return {
    emit: (event, eventPath) => {
      for (const listener of listeners[event]) {
        listener(eventPath);
      }
    },
    handle: {
      close: async () => {
        isClosed = true;
      },
      on: (event, listener) => {
        listeners[event].push(listener);
      },
      onError: (listener) => {
        errorListener = listener;
      },
      onReady: (listener) => {
        readyListener = listener;
      }
    },
    isClosed: () => isClosed,
    signalError: (error) => errorListener?.(error),
    signalReady: () => readyListener?.()
  };
};

type LoggedError = {readonly error: unknown; readonly message: string};

type WatcherHarness = {
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly fake: FakeHandle;
  readonly reloadTimes: number[];
  readonly warnings: LoggedError[];
  readonly close: () => Promise<void>;
};

type HarnessOptions = {
  readonly onReload?: () => void;
};

/** Builds a watcher over the fake clock, recording reload times. */
const createHarness = (options: HarnessOptions = {}): WatcherHarness => {
  const clock = createFakeClock();
  const fake = createFakeHandle();
  const reloadTimes: number[] = [];
  const warnings: LoggedError[] = [];

  const watcher = createConfigWatcher<number>({
    cancel: clock.cancel,
    debounceMs: DEBOUNCE_MS,
    fileNames: WATCHED_PATHS,
    handle: fake.handle,
    onReload: () => {
      reloadTimes.push(clock.now());
      options.onReload?.();
    },
    schedule: clock.schedule,
    warn: (message, error) => {
      warnings.push({error, message});
    }
  });

  return {clock, close: watcher.close, fake, reloadTimes, warnings};
};

type TimedEvent = {readonly at: number; readonly kind: WatcherEvent; readonly eventPath: string};

const eventKindArb = fc.constantFrom<WatcherEvent>('add', 'change', 'unlink');
const gapArb = fc.oneof(
  fc.constantFrom(0, DEBOUNCE_MS - 1, DEBOUNCE_MS, DEBOUNCE_MS + 1),
  fc.integer({min: 0, max: 3 * DEBOUNCE_MS})
);

const timedEventsArb: fc.Arbitrary<readonly TimedEvent[]> = fc
  .array(fc.tuple(gapArb, eventKindArb, fc.constantFrom(...WATCHED_PATHS)), {maxLength: 12})
  .map((rows) => {
    let at = 0;
    return rows.map(([gap, kind, eventPath]) => {
      at += gap;
      return {at, eventPath, kind};
    });
  });

/** The burst model: each maximal run of gaps below `debounceMs` reloads once. */
const expectedReloadTimes = (events: readonly TimedEvent[]): number[] => {
  const times: number[] = [];
  let lastOfBurst: TimedEvent | undefined;
  for (const event of events) {
    if (lastOfBurst !== undefined && event.at - lastOfBurst.at >= DEBOUNCE_MS) {
      times.push(lastOfBurst.at + DEBOUNCE_MS);
    }
    lastOfBurst = event;
  }
  if (lastOfBurst !== undefined) {
    times.push(lastOfBurst.at + DEBOUNCE_MS);
  }
  return times;
};

/** Replays one generated schedule against the real watcher. */
const replay = async (events: readonly TimedEvent[]) => {
  const harness = createHarness();
  try {
    for (const event of events) {
      harness.clock.advanceTo(event.at);
      harness.fake.emit(event.kind, event.eventPath);
    }
    const lastEvent = events.at(-1);
    harness.clock.advanceTo((lastEvent?.at ?? 0) + DEBOUNCE_MS);
    return harness.reloadTimes;
  } finally {
    await harness.close();
  }
};

/** A watcher that reproduces the old per-event timer behaviour. */
const createLegacyHarness = (onReload: () => void) => {
  const clock = createFakeClock();
  const fake = createFakeHandle();
  const reloadTimes: number[] = [];

  for (const event of ['add', 'change', 'unlink'] as const) {
    fake.handle.on(event, () => {
      clock.schedule(() => {
        reloadTimes.push(clock.now());
        onReload();
      }, DEBOUNCE_MS);
    });
  }

  return {clock, close: async () => {}, fake, reloadTimes};
};

const propertyOptions = {numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED} as const;

test('KB-WATCH-1 calls onReload exactly once per burst, at the burst end plus the debounce', async () => {
  await fc.assert(
    fc.asyncProperty(timedEventsArb, async (events) => {
      const reloadTimes = await replay(events);
      expect(reloadTimes).toEqual(expectedReloadTimes(events));
    }),
    propertyOptions
  );
});

test('the per-event timer stub fails the same property, so the law is not vacuous', () => {
  expect(() => {
    fc.assert(
      fc.property(timedEventsArb, (events) => {
        const harness = createLegacyHarness(() => {});
        for (const event of events) {
          harness.clock.advanceTo(event.at);
          harness.fake.emit(event.kind, event.eventPath);
        }
        const lastEvent = events.at(-1);
        harness.clock.advanceTo((lastEvent?.at ?? 0) + DEBOUNCE_MS);
        expect(harness.reloadTimes).toEqual(expectedReloadTimes(events));
      }),
      propertyOptions
    );
  }).toThrow();
});

test('no reload happens before the first event', async () => {
  const harness = createHarness();
  harness.clock.advanceTo(10 * DEBOUNCE_MS);
  expect(harness.reloadTimes).toEqual([]);
  await harness.close();
});

test('close cancels a pending reload', async () => {
  const harness = createHarness();
  harness.fake.emit('change', CONFIG_PATH);
  expect(harness.clock.pendingCount()).toBe(1);

  await harness.close();
  harness.clock.advanceTo(DEBOUNCE_MS);

  expect(harness.reloadTimes).toEqual([]);
  expect(harness.fake.isClosed()).toBe(true);
});

test('events raised during onReload start a new burst', async () => {
  let hasRaisedEvent = false;
  const harness = createHarness({
    onReload: () => {
      if (hasRaisedEvent) {
        return;
      }
      hasRaisedEvent = true;
      harness.fake.emit('change', KEYBINDINGS_PATH);
    }
  });

  harness.fake.emit('change', CONFIG_PATH);
  harness.clock.advanceTo(DEBOUNCE_MS);
  harness.clock.advanceTo(2 * DEBOUNCE_MS);

  expect(harness.reloadTimes).toEqual([DEBOUNCE_MS, 2 * DEBOUNCE_MS]);
  await harness.close();
});

test('a throwing onReload is logged and does not disable the watcher', async () => {
  let shouldThrow = true;
  const harness = createHarness({
    onReload: () => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error('reload blew up');
      }
    }
  });

  harness.fake.emit('change', CONFIG_PATH);
  harness.clock.advanceTo(DEBOUNCE_MS);
  harness.fake.emit('change', CONFIG_PATH);
  harness.clock.advanceTo(2 * DEBOUNCE_MS);

  expect(harness.warnings).toHaveLength(1);
  expect(harness.warnings[0]?.error).toBeInstanceOf(Error);
  expect(harness.reloadTimes).toEqual([DEBOUNCE_MS, 2 * DEBOUNCE_MS]);
  await harness.close();
});

test('events for files outside the watch list are ignored', async () => {
  const harness = createHarness();
  harness.fake.emit('change', '/cfg/other.json5');
  harness.clock.advanceTo(DEBOUNCE_MS);
  expect(harness.reloadTimes).toEqual([]);
  await harness.close();
});

test('a watcher error is logged without stopping later reloads', async () => {
  const harness = createHarness();
  try {
    harness.fake.signalError(new Error('watch failed'));
    harness.fake.emit('change', CONFIG_PATH);
    harness.clock.advanceTo(DEBOUNCE_MS);

    expect(harness.warnings).toHaveLength(1);
    expect(harness.reloadTimes).toEqual([DEBOUNCE_MS]);
  } finally {
    await harness.close();
  }
});

test('the ready callback is forwarded once', () => {
  let readyCalls = 0;
  const clock = createFakeClock();
  const fake = createFakeHandle();
  createConfigWatcher<number>({
    cancel: clock.cancel,
    debounceMs: DEBOUNCE_MS,
    fileNames: WATCHED_PATHS,
    handle: fake.handle,
    onReady: () => {
      readyCalls += 1;
    },
    onReload: () => {},
    schedule: clock.schedule
  });

  fake.signalReady();

  expect(readyCalls).toBe(1);
});

describe('KB-WATCH-1 event schedule coverage', () => {
  const SAMPLE_COUNT = 2000;
  const REQUIRED_SHARE = 0.05;
  const samples = fc.sample(timedEventsArb, {numRuns: SAMPLE_COUNT, seed: PROPERTY_SEED});

  const shareOf = (predicate: (events: readonly TimedEvent[]) => boolean): number =>
    samples.filter((events) => predicate(events)).length / samples.length;

  const hasExactGap = (events: readonly TimedEvent[]): boolean => {
    let previousAt: number | undefined;
    for (const event of events) {
      if (previousAt !== undefined && event.at - previousAt === DEBOUNCE_MS) {
        return true;
      }
      previousAt = event.at;
    }
    return false;
  };

  test('single events, long bursts, and exact-debounce gaps are all well represented', () => {
    const shares = {
      'bursts of five or more': shareOf((events) => expectedReloadTimes(events).length < events.length - 4),
      'exact-debounce gaps': shareOf(hasExactGap),
      'single events': shareOf((events) => events.length === 1)
    };

    for (const [label, share] of Object.entries(shares)) {
      expect(`${label}: ${share > REQUIRED_SHARE ? 'covered' : 'sparse'}`).toBe(`${label}: covered`);
    }
  });

  test('the generator also produces schedules with no events', () => {
    expect(samples.filter((events) => events.length === NO_EVENTS).length).toBeGreaterThan(0);
  });
});
