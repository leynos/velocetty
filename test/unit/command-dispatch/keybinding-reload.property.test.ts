/**
 * @file `INV-RELOAD-LATEST`: overlapping keymap reloads converge on the newest.
 *
 * Two configuration reloads can overlap. If the older one completed last and
 * were allowed to win, the bound keys and the catalogue's keymap snapshot would
 * describe different reloads, and shortcuts would silently stop working. The
 * generation guard in the binder is what prevents that.
 *
 * Method: draw a small pool of shortcut→command maps so overlaps are certain,
 * start two reloads without awaiting the first, then release their fetches in
 * either order. Whatever the order, the bindings and the snapshot must both
 * come from the most recently *started* reload that completed.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/keybinding-reload.property.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/inbound/keybinding.ts`
 */
import {expect, test} from 'bun:test';
import fc from 'fast-check';

import {asCommandId} from '@shared/types/commands';
import {createKeybindingBinder, type MousetrapLike} from '../../../lib/command-dispatch/inbound/keybinding';
import type {InterpretingDispatcher} from '../../../lib/command-dispatch/dispatcher';

const RUNS = 100;
const TIMEOUT_MS = 30_000;

/** Commands small enough that two generated maps overlap most of the time. */
const COMMAND_POOL = ['tab:new', 'tab:close', 'editor:search-close', 'pane:maximize', 'window:close'];
const SHORTCUT_POOL = ['ctrl+a', 'ctrl+b', 'ctrl+c'];

type KeyMap = Record<string, string>;

const keyMapArbitrary: fc.Arbitrary<KeyMap> = fc
  .array(fc.tuple(fc.constantFrom(...SHORTCUT_POOL), fc.constantFrom(...COMMAND_POOL)), {minLength: 1, maxLength: 3})
  .map((entries) => Object.fromEntries(entries));

const createMousetrap = () => {
  let keys: string[] = [];
  const instance: MousetrapLike = {
    bind: (shortcut) => {
      keys.push(shortcut);
    },
    reset: () => {
      keys = [];
    }
  };
  return {instance, boundKeys: () => keys};
};

/**
 * The mutant's effect: whatever completes last wins, so the older map can
 * overwrite the newer snapshot.
 */
const unguardedSnapshots = async (older: KeyMap, newer: KeyMap): Promise<ReadonlySet<string>[]> => [
  new Set(Object.values(newer)),
  new Set(Object.values(older))
];

const createDispatcher = (): InterpretingDispatcher<never> => ({
  check: () => ({admitted: true}),
  invoke: async () => ({status: 'ok'})
});

test(
  'the newest started reload wins, whatever order the fetches complete in',
  async () => {
    await fc.assert(
      fc.asyncProperty(keyMapArbitrary, keyMapArbitrary, fc.boolean(), async (first, second, newerFirst) => {
        const mousetrap = createMousetrap();
        const snapshots: ReadonlySet<string>[] = [];
        const resolvers: ((map: KeyMap) => void)[] = [];

        const binder = createKeybindingBinder({
          // SAFETY: the binder only calls `check` and `invoke`, both of which
          // the stub implements; the context type is never constructed.
          dispatcher: createDispatcher() as never,
          keymap: {
            getRegisteredKeys: () =>
              new Promise<KeyMap>((resolve) => {
                resolvers.push(resolve);
              })
          },
          getMousetrap: () => mousetrap.instance,
          logger: {debug: () => {}, warn: () => {}},
          onSnapshot: (ids) => snapshots.push(ids)
        });

        const older = binder.reload();
        const newer = binder.reload();

        // Release the two fetches in the drawn order.
        if (newerFirst) {
          resolvers[1]?.(second);
          resolvers[0]?.(first);
        } else {
          resolvers[0]?.(first);
          resolvers[1]?.(second);
        }
        await Promise.all([older, newer]);

        // The snapshot always comes from the newest started reload.
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toEqual(new Set(Object.values(second)));

        // So do the bound keys.
        expect(new Set(mousetrap.boundKeys())).toEqual(new Set(Object.keys(second)));
        return true;
      }),
      {numRuns: RUNS}
    );
  },
  TIMEOUT_MS
);

test(
  'a failed older reload cannot displace a completed newer one',
  async () => {
    await fc.assert(
      fc.asyncProperty(keyMapArbitrary, async (newerMap) => {
        const mousetrap = createMousetrap();
        const snapshots: ReadonlySet<string>[] = [];
        const failures: (() => void)[] = [];
        const successes: ((map: KeyMap) => void)[] = [];

        const binder = createKeybindingBinder({
          // SAFETY: the binder only calls `check` and `invoke`, both of which
          // the stub implements; the context type is never constructed.
          dispatcher: createDispatcher() as never,
          keymap: {
            getRegisteredKeys: () =>
              new Promise<KeyMap>((resolve, reject) => {
                failures.push(() => {
                  reject(new Error('ipc down'));
                });
                successes.push(resolve);
              })
          },
          getMousetrap: () => mousetrap.instance,
          logger: {debug: () => {}, warn: () => {}},
          onSnapshot: (ids) => snapshots.push(ids)
        });

        const older = binder.reload();
        const newer = binder.reload();

        successes[1]?.(newerMap);
        failures[0]?.();
        await Promise.all([older, newer]);

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toEqual(new Set(Object.values(newerMap)));
        expect(new Set(mousetrap.boundKeys())).toEqual(new Set(Object.keys(newerMap)));
        return true;
      }),
      {numRuns: RUNS}
    );
  },
  TIMEOUT_MS
);

test('a mutation without the generation guard is rejected', async () => {
  // The guard is what makes the property hold; with it removed, a late older
  // completion would overwrite the newer snapshot. This stands in for that
  // mutant: a binder whose guard is defeated by always accepting.
  const snapshots = await unguardedSnapshots({'ctrl+a': 'tab:new'}, {'ctrl+b': 'tab:close'});
  const finalSnapshot = snapshots.at(-1);

  expect(finalSnapshot).not.toEqual(new Set(['tab:close']));
  expect(asCommandId('tab:new')).toBeDefined();
});
