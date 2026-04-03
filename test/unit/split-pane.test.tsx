/**
 * @file Verifies `SplitPane` drag maths stays anchored to the drag-start
 * sizes and preserves the adjacent-pane size baseline during pointer-driven
 * resizing.
 *
 * Invariant:
 * - Drag deltas are calculated from the drag-start snapshot so controlled
 *   resizes do not compound or overshoot the initial pane sizes.
 *
 * Related module:
 * - `lib/components/split-pane.tsx`
 */
import {act} from 'react';
import {expect, test} from 'bun:test';

import {renderControlledSplitPane, runDragTest} from '../testUtils/split-pane';
import {waitFor} from '../testUtils/waitFor';

test('applies drag deltas from the pointer-anchored drag-start snapshot instead of compounding them', async () => {
  await runDragTest({
    direction: 'vertical',
    initialSizes: [0.3, 0.7],
    geometry: {
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 300,
      dividerTop: 0,
      dividerWidth: 4,
      dividerHeight: 400
    },
    mousedownEvent: {clientX: 302, clientY: 0},
    mousemoveBatches: [[{clientX: 352, clientY: 0}], [{clientX: 362, clientY: 0}]],
    assertResizeCalls: (resizeCalls) => {
      expect(resizeCalls).toHaveLength(2);
      expect(resizeCalls[0][0]).toBeCloseTo(0.35, 12);
      expect(resizeCalls[0][1]).toBeCloseTo(0.65, 12);
      expect(resizeCalls[1][0]).toBeCloseTo(0.36, 12);
      expect(resizeCalls[1][1]).toBeCloseTo(0.64, 12);
    },
    afterMouseUp: (divider) => {
      expect(divider.style.left).toBe('');
    }
  });
});

test('applies drag deltas from the pointer-anchored drag-start snapshot for horizontal panes', async () => {
  await runDragTest({
    direction: 'horizontal',
    initialSizes: [0.3, 0.7],
    geometry: {
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 0,
      dividerTop: 120,
      dividerWidth: 1_000,
      dividerHeight: 4
    },
    mousedownEvent: {clientX: 0, clientY: 122},
    mousemoveBatches: [[{clientX: 0, clientY: 172}], [{clientX: 0, clientY: 182}]],
    assertResizeCalls: (resizeCalls) => {
      expect(resizeCalls).toHaveLength(2);
      expect(resizeCalls[0][0]).toBeCloseTo(0.425, 12);
      expect(resizeCalls[0][1]).toBeCloseTo(0.575, 12);
      expect(resizeCalls[1][0]).toBeCloseTo(0.45, 12);
      expect(resizeCalls[1][1]).toBeCloseTo(0.55, 12);
    },
    afterMouseUp: (divider) => {
      expect(divider.style.top).toBe('');
    }
  });
});

test('supports keyboard resizing and separator semantics', async () => {
  const {dispose, resizeCalls, divider} = await renderControlledSplitPane({
    direction: 'vertical',
    initialSizes: [0.3, 0.7]
  });

  try {
    await act(async () => {
      divider.focus();
      divider.dispatchEvent(new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'ArrowRight'}));
      await waitFor(0);
    });

    await act(async () => {
      divider.dispatchEvent(new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'End'}));
      await waitFor(0);
    });

    await act(async () => {
      divider.dispatchEvent(new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'Home'}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(3);
    expect(resizeCalls[0][0]).toBeCloseTo(0.35, 12);
    expect(resizeCalls[0][1]).toBeCloseTo(0.65, 12);
    expect(resizeCalls[1]).toEqual([1, 0]);
    expect(resizeCalls[2]).toEqual([0, 1]);
  } finally {
    await dispose();
  }
});

test.each([
  [
    'vertical',
    {
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 950,
      dividerTop: 0,
      dividerWidth: 4,
      dividerHeight: 400
    },
    {clientX: 952, clientY: 0},
    [{clientX: 1_200, clientY: 0}]
  ],
  [
    'horizontal',
    {
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 0,
      dividerTop: 380,
      dividerWidth: 1_000,
      dividerHeight: 4
    },
    {clientX: 0, clientY: 382},
    [{clientX: 0, clientY: 500}]
  ]
] as const)('clamps drag deltas so %s pane sizes stay within bounds', async (direction, geometry, mousedownEvent, mousemoveCoords) => {
  await runDragTest({
    direction,
    initialSizes: [0.95, 0.05],
    geometry,
    mousedownEvent,
    mousemoveBatches: [mousemoveCoords],
    assertResizeCalls: (calls) => {
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([1, 0]);
    }
  });
});

test.each([
  [
    'vertical',
    {
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 1_000,
      dividerTop: 0,
      dividerWidth: 4,
      dividerHeight: 400
    },
    {clientX: 1_002, clientY: 0},
    [
      {clientX: 1_100, clientY: 0},
      {clientX: 1_120, clientY: 0}
    ]
  ],
  [
    'horizontal',
    {
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 0,
      dividerTop: 400,
      dividerWidth: 1_000,
      dividerHeight: 4
    },
    {clientX: 0, clientY: 402},
    [
      {clientX: 0, clientY: 450},
      {clientX: 0, clientY: 470}
    ]
  ]
] as const)('does not re-emit identical sizes when dragging against a saturated edge (%s)', async (direction, geometry, mousedownEvent, mousemoveCoords) => {
  await runDragTest({
    direction,
    initialSizes: [1, 0],
    geometry,
    mousedownEvent,
    mousemoveBatches: [mousemoveCoords],
    assertResizeCalls: (calls) => {
      expect(calls).toHaveLength(0);
    }
  });
});
