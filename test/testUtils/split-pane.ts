/**
 * @file split-pane.ts provides `SplitPane` test harness utilities for
 * `lib/components/split-pane.tsx`.
 *
 * Purpose:
 * - Mount a controlled `SplitPane` harness for renderer unit tests.
 * - Stub pane and divider geometry so resize calculations use deterministic
 *   DOM measurements.
 *
 * Invariants:
 * - Mount `SplitPane` through `renderControlledSplitPane` so the harness
 *   commits before tests inspect pane and divider nodes.
 * - Stub pane-container and divider geometry consistently before dispatching
 *   pointer events so drag scenarios observe stable measurements.
 *
 * Cross-links:
 * - Implementation: `lib/components/split-pane.tsx`
 * - Tests: `test/unit/split-pane.test.tsx`
 */
import React, {act, useState} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';

import Immutable from 'seamless-immutable';

import SplitPane from '../../lib/components/split-pane';
import {setupHappyDom} from './happy-dom';
import {waitFor} from './waitFor';

export type SplitPaneDirection = 'horizontal' | 'vertical';

/** Options for a pointer-driven drag scenario in `SplitPane` unit tests. */
export interface DragTestOptions {
  direction: SplitPaneDirection;
  initialSizes: number[];
  /**
   * Geometry to stub on the pane container and divider.
   * Omit only for tests that never dispatch mouse events.
   */
  geometry?: {
    paneLeft: number;
    paneTop: number;
    paneWidth: number;
    paneHeight: number;
    dividerLeft: number;
    dividerTop: number;
    dividerWidth: number;
    dividerHeight: number;
  };
  /** Coordinates for the initial `mousedown` event on the divider. */
  mousedownEvent: {clientX: number; clientY: number};
  /**
   * Ordered list of `mousemove` batches. Each entry is wrapped in its own
   * `act` call; within a batch every event is dispatched before `waitFor`.
   */
  mousemoveBatches: Array<Array<{clientX: number; clientY: number}>>;
  /** Called after all `mousemove` acts and before `mouseup`. */
  assertResizeCalls: (resizeCalls: number[][]) => void;
  /** Optional assertions to run immediately after the `mouseup` act. */
  afterMouseUp?: (divider: HTMLElement) => void;
}

/**
 * Runs a complete drag scenario: sets geometry, dispatches pointer events,
 * asserts resize emissions, dispatches `mouseup`, then unmounts.
 */
export async function runDragTest({
  direction,
  initialSizes,
  geometry,
  mousedownEvent,
  mousemoveBatches,
  assertResizeCalls,
  afterMouseUp
}: DragTestOptions): Promise<void> {
  const {dispose, resizeCalls, panes, divider} = await renderControlledSplitPane({
    direction,
    initialSizes
  });

  try {
    if (geometry) {
      setSplitPaneGeometry({panes, divider, ...geometry});
    }

    await act(async () => {
      divider.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, ...mousedownEvent}));
      await waitFor(0);
    });

    for (const batch of mousemoveBatches) {
      await act(async () => {
        for (const coords of batch) {
          window.dispatchEvent(new window.MouseEvent('mousemove', {bubbles: true, ...coords}));
        }
        await waitFor(0);
      });
    }

    assertResizeCalls(resizeCalls);

    await act(async () => {
      window.dispatchEvent(new window.MouseEvent('mouseup', {bubbles: true}));
      await waitFor(0);
    });

    afterMouseUp?.(divider);
  } finally {
    await dispose();
  }
}

export const buildRect = ({
  left,
  top,
  width,
  height
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect =>
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

export const waitForRenderedPanes = async (container: HTMLDivElement) =>
  await new Promise<HTMLDivElement>((resolve) => {
    let settled = false;
    const PaneMutationObserver = window.MutationObserver;

    const observer = new PaneMutationObserver(() => {
      const element = container.firstElementChild as Element | undefined;
      if (settled || !isHtmlElementWithTag(element, 'DIV')) {
        return;
      }

      settled = true;
      observer.disconnect();
      resolve(element as HTMLDivElement);
    });

    const element = container.firstElementChild as Element | undefined;
    if (isHtmlElementWithTag(element, 'DIV')) {
      settled = true;
      resolve(element as HTMLDivElement);
      return;
    }

    observer.observe(container, {childList: true});
  });

/**
 * Returns `true` when `element` is a rendered HTML element whose tag name
 * matches `tagName` exactly.
 */
function isHtmlElementWithTag(element: Element | undefined, tagName: string): boolean {
  return element != null && 'tagName' in element && element.tagName === tagName;
}

export const renderControlledSplitPane = async ({
  direction,
  initialSizes
}: {
  direction: SplitPaneDirection;
  initialSizes: number[];
}) => {
  const cleanup = await setupHappyDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const resizeCalls: number[][] = [];
  const dispose = async () => {
    await act(async () => {
      root.unmount();
      await waitFor(0);
    });
    cleanup();
  };

  const ControlledSplitPane = () => {
    const [sizes, setSizes] = useState(initialSizes);

    return React.createElement(
      SplitPane,
      {
        direction,
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
      flushSync(() => {
        root.render(React.createElement(ControlledSplitPane));
      });
      await waitFor(0);
    });

    const panes = await waitForRenderedPanes(container);
    const divider = panes.children[1] as Element | undefined;
    if (!isHtmlElementWithTag(divider, 'HR')) {
      throw new Error('Expected split pane divider to be rendered.');
    }

    return {dispose, resizeCalls, panes, divider: divider as HTMLElement};
  } catch (error) {
    try {
      await dispose();
    } catch {
      // Best-effort cleanup only. Re-throw the original setup failure below.
    }
    throw error;
  }
};

export const setSplitPaneGeometry = ({
  panes,
  divider,
  paneLeft,
  paneTop,
  paneWidth,
  paneHeight,
  dividerLeft,
  dividerTop,
  dividerWidth,
  dividerHeight
}: {
  panes: HTMLDivElement;
  divider: HTMLElement;
  paneLeft: number;
  paneTop: number;
  paneWidth: number;
  paneHeight: number;
  dividerLeft: number;
  dividerTop: number;
  dividerWidth: number;
  dividerHeight: number;
}) => {
  Object.defineProperty(panes, 'getBoundingClientRect', {
    configurable: true,
    value: () => buildRect({left: paneLeft, top: paneTop, width: paneWidth, height: paneHeight})
  });
  Object.defineProperty(divider, 'getBoundingClientRect', {
    configurable: true,
    value: () => buildRect({left: dividerLeft, top: dividerTop, width: dividerWidth, height: dividerHeight})
  });
};
