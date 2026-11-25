/** @file Verifies the bounded span text, its closed vocabulary, and its rounding. */
import {describe, expect, test} from 'bun:test';

import {createConfigSpanRecorder} from '../../app/config/config-spans';

/** A recorder over a fixed clock, so elapsed time is exact rather than measured. */
const createHarness = (times: readonly number[]) => {
  const lines: string[] = [];
  let clockIndex = 0;
  const recorder = createConfigSpanRecorder({
    /** Reads the next scripted time, then holds the last value once the list runs out. */
    now: () => {
      // `at` rather than indexing: it keeps the out-of-range case explicitly
      // `undefined` for the type checker and for the lint rule alike.
      const time = times.at(clockIndex) ?? times.at(-1) ?? 0;
      clockIndex += 1;
      return time;
    },
    sink: {
      info: (line) => lines.push(line),
      // A span is informational; a warning would be a second, unplanned record.
      warn: (line) => lines.push(`unexpected warn: ${line}`)
    }
  });
  return {lines, recorder};
};

describe('a configuration span', () => {
  test('reports the operation, the outcome, and the rounded elapsed time', () => {
    const {lines, recorder} = createHarness([10, 25.4]);

    recorder.begin('reload')('applied');

    expect(lines).toEqual(['[config] span operation=reload outcome=applied ms=15']);
  });

  test('rounds half up and never reports a fractional millisecond', () => {
    for (const [start, end, expected] of [
      [0, 1.4, 1],
      [0, 1.5, 2],
      [0, 0.4, 0]
    ] as const) {
      const {lines, recorder} = createHarness([start, end]);

      recorder.begin('watcher-dispatch')('applied');

      expect(lines).toEqual([`[config] span operation=watcher-dispatch outcome=applied ms=${expected}`]);
    }
  });

  test('clamps a clock that moves backwards to zero', () => {
    const {lines, recorder} = createHarness([50, 20]);

    recorder.begin('reload')('thrown');

    expect(lines).toEqual(['[config] span operation=reload outcome=thrown ms=0']);
  });

  test('captures the clock when the span begins, not when it ends', () => {
    const {lines, recorder} = createHarness([100, 200, 300, 320]);

    const finishFirst = recorder.begin('keybindings-read');
    // A second span starting later must not move the first span's start time.
    const finishSecond = recorder.begin('keybindings-write');
    finishFirst('present');
    finishSecond('written');

    expect(lines).toEqual([
      '[config] span operation=keybindings-read outcome=present ms=200',
      '[config] span operation=keybindings-write outcome=written ms=120'
    ]);
  });

  test('uses only the closed operation and outcome vocabulary', () => {
    const {lines, recorder} = createHarness([0, 1, 2, 3, 4, 5, 6, 7]);

    recorder.begin('keybindings-read')('missing');
    recorder.begin('keybindings-read')('unreadable');
    recorder.begin('keybindings-write')('failed');
    recorder.begin('reload')('fallback');

    expect(lines).toEqual([
      '[config] span operation=keybindings-read outcome=missing ms=1',
      '[config] span operation=keybindings-read outcome=unreadable ms=1',
      '[config] span operation=keybindings-write outcome=failed ms=1',
      '[config] span operation=reload outcome=fallback ms=1'
    ]);
    // No line can carry a path, a command identifier, or keybinding content.
    expect(lines.every((line) => line.startsWith('[config] span operation='))).toBe(true);
  });
});
