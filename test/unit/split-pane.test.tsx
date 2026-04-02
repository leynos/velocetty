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
import React, {act, useState} from 'react';
import {createRoot} from 'react-dom/client';

import Immutable from 'seamless-immutable';
import {expect, test} from 'bun:test';

import SplitPane from '../../lib/components/split-pane';
import {setupHappyDom} from '../testUtils/happy-dom';
import {waitFor} from '../testUtils/waitFor';

const buildRect = ({left, top, width, height}: {left: number; top: number; width: number; height: number}): DOMRect =>
  ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  }) as DOMRect;

test('applies drag deltas from the pointer-anchored drag-start snapshot instead of compounding them', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const resizeCalls: number[][] = [];

  const ControlledSplitPane = () => {
    const [sizes, setSizes] = useState([0.3, 0.7]);

    return React.createElement(
      SplitPane,
      {
        direction: 'vertical',
        sizes: Immutable(sizes),
        onResize: (nextSizes: number[]) => {
          resizeCalls.push(nextSizes);
          setSizes(nextSizes);
        },
        borderColor: '#333'
      },
      [React.createElement('div', {key: 'left'}, 'Left'), React.createElement('div', {key: 'right'}, 'Right')]
    );
  };

  try {
    await act(async () => {
      root.render(React.createElement(ControlledSplitPane));
      await waitFor(0);
    });

    const panes = container.firstElementChild as HTMLDivElement | null;
    const divider = panes?.children[1] as HTMLDivElement | undefined;

    expect(panes).toBeTruthy();
    expect(divider).toBeTruthy();
    if (!panes || !divider) {
      throw new Error('Expected split pane root and divider to be rendered.');
    }

    Object.defineProperty(panes, 'getBoundingClientRect', {
      configurable: true,
      value: () => buildRect({left: 0, top: 0, width: 1_000, height: 400})
    });
    Object.defineProperty(divider, 'getBoundingClientRect', {
      configurable: true,
      value: () => buildRect({left: 300, top: 0, width: 4, height: 400})
    });

    await act(async () => {
      divider?.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, clientX: 302, clientY: 0}));
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
    expect(resizeCalls[0]).toEqual([0.35, 0.6499999999999999]);
    expect(resizeCalls[1]).toEqual([0.36, 0.6399999999999999]);
  } finally {
    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  }
});

test('clamps drag deltas so pane sizes stay within bounds', async () => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const resizeCalls: number[][] = [];

  const ControlledSplitPane = () => {
    const [sizes, setSizes] = useState([0.95, 0.05]);

    return React.createElement(
      SplitPane,
      {
        direction: 'vertical',
        sizes: Immutable(sizes),
        onResize: (nextSizes: number[]) => {
          resizeCalls.push(nextSizes);
          setSizes(nextSizes);
        },
        borderColor: '#333'
      },
      [React.createElement('div', {key: 'left'}, 'Left'), React.createElement('div', {key: 'right'}, 'Right')]
    );
  };

  try {
    await act(async () => {
      root.render(React.createElement(ControlledSplitPane));
      await waitFor(0);
    });

    const panes = container.firstElementChild as HTMLDivElement | null;
    const divider = panes?.children[1] as HTMLDivElement | undefined;

    expect(panes).toBeTruthy();
    expect(divider).toBeTruthy();
    if (!panes || !divider) {
      throw new Error('Expected split pane root and divider to be rendered.');
    }

    Object.defineProperty(panes, 'getBoundingClientRect', {
      configurable: true,
      value: () => buildRect({left: 0, top: 0, width: 1_000, height: 400})
    });
    Object.defineProperty(divider, 'getBoundingClientRect', {
      configurable: true,
      value: () => buildRect({left: 950, top: 0, width: 4, height: 400})
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
