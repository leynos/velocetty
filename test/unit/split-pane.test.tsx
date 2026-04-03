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

import {renderControlledSplitPane, setSplitPaneGeometry} from '../testUtils/split-pane';
import {waitFor} from '../testUtils/waitFor';

test('applies drag deltas from the pointer-anchored drag-start snapshot instead of compounding them', async () => {
  const {cleanup, root, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction: 'vertical',
    initialSizes: [0.3, 0.7]
  });

  try {
    expect(divider.tagName).toBe('HR');
    expect(divider.tabIndex).toBe(0);
    expect(divider.getAttribute('aria-orientation')).toBe('vertical');
    expect(divider.getAttribute('aria-valuenow')).toBe('30');

    setSplitPaneGeometry({
      panes,
      divider,
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 300,
      dividerTop: 0,
      dividerWidth: 4,
      dividerHeight: 400
    });

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 302, clientY: 0}));
      await waitFor(0);
    });

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 352, clientY: 0}));
      await waitFor(0);
    });
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 362, clientY: 0}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(2);
    expect(resizeCalls[0][0]).toBeCloseTo(0.35, 12);
    expect(resizeCalls[0][1]).toBeCloseTo(0.65, 12);
    expect(resizeCalls[1][0]).toBeCloseTo(0.36, 12);
    expect(resizeCalls[1][1]).toBeCloseTo(0.64, 12);

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      await waitFor(0);
    });

    expect(divider.style.left).toBe('');
  } finally {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('applies drag deltas from the pointer-anchored drag-start snapshot for horizontal panes', async () => {
  const {cleanup, root, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction: 'horizontal',
    initialSizes: [0.3, 0.7]
  });

  try {
    expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
    expect(divider.getAttribute('aria-valuenow')).toBe('30');

    setSplitPaneGeometry({
      panes,
      divider,
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 0,
      dividerTop: 120,
      dividerWidth: 1_000,
      dividerHeight: 4
    });

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 0, clientY: 122}));
      await waitFor(0);
    });

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 0, clientY: 172}));
      await waitFor(0);
    });
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 0, clientY: 182}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(2);
    expect(resizeCalls[0][0]).toBeCloseTo(0.425, 12);
    expect(resizeCalls[0][1]).toBeCloseTo(0.575, 12);
    expect(resizeCalls[1][0]).toBeCloseTo(0.45, 12);
    expect(resizeCalls[1][1]).toBeCloseTo(0.55, 12);

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      await waitFor(0);
    });

    expect(divider.style.top).toBe('');
  } finally {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('supports keyboard resizing and separator semantics', async () => {
  const {cleanup, root, resizeCalls, divider} = await renderControlledSplitPane({
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
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('clamps drag deltas so pane sizes stay within bounds', async () => {
  const {cleanup, root, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction: 'vertical',
    initialSizes: [0.95, 0.05]
  });

  try {
    setSplitPaneGeometry({
      panes,
      divider,
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 950,
      dividerTop: 0,
      dividerWidth: 4,
      dividerHeight: 400
    });

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 952, clientY: 0}));
      await waitFor(0);
    });

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 1_200, clientY: 0}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(1);
    expect(resizeCalls[0]).toEqual([1, 0]);
  } finally {
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('clamps drag deltas so horizontal pane sizes stay within bounds', async () => {
  const {cleanup, root, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction: 'horizontal',
    initialSizes: [0.95, 0.05]
  });

  try {
    setSplitPaneGeometry({
      panes,
      divider,
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 0,
      dividerTop: 380,
      dividerWidth: 1_000,
      dividerHeight: 4
    });

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 0, clientY: 382}));
      await waitFor(0);
    });

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 0, clientY: 500}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(1);
    expect(resizeCalls[0]).toEqual([1, 0]);
  } finally {
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('does not re-emit identical sizes when dragging against a saturated edge', async () => {
  const {cleanup, root, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction: 'vertical',
    initialSizes: [1, 0]
  });

  try {
    setSplitPaneGeometry({
      panes,
      divider,
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 1_000,
      dividerTop: 0,
      dividerWidth: 4,
      dividerHeight: 400
    });

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 1_002, clientY: 0}));
      await waitFor(0);
    });

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 1_100, clientY: 0}));
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 1_120, clientY: 0}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(0);
  } finally {
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('does not re-emit identical sizes for saturated horizontal panes', async () => {
  const {cleanup, root, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction: 'horizontal',
    initialSizes: [1, 0]
  });

  try {
    setSplitPaneGeometry({
      panes,
      divider,
      paneLeft: 0,
      paneTop: 0,
      paneWidth: 1_000,
      paneHeight: 400,
      dividerLeft: 0,
      dividerTop: 400,
      dividerWidth: 1_000,
      dividerHeight: 4
    });

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 0, clientY: 402}));
      await waitFor(0);
    });

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 0, clientY: 450}));
      window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, clientX: 0, clientY: 470}));
      await waitFor(0);
    });

    expect(resizeCalls).toHaveLength(0);
  } finally {
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});
