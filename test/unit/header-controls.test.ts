/** @file Verifies header control ordering and button double-click handling. */
import {expect, mock, test} from 'bun:test';

import {orderWindowControlButtons, stopDoubleClickPropagation} from '../../lib/components/header-controls';

test('reorders left-aligned window controls to close, minimize, then maximize', () => {
  const orderedButtons = orderWindowControlButtons(['minimize', 'maximize', 'close'], true);

  expect(orderedButtons).toEqual(['close', 'minimize', 'maximize']);
});

test('preserves minimize, maximize, then close order for right-aligned controls', () => {
  const orderedButtons = orderWindowControlButtons(['minimize', 'maximize', 'close'], false);

  expect(orderedButtons).toEqual(['minimize', 'maximize', 'close']);
});

test('stops button double-click propagation before the title bar handler sees it', () => {
  const stopPropagation = mock(() => {});

  stopDoubleClickPropagation({stopPropagation});

  expect(stopPropagation).toHaveBeenCalledTimes(1);
});
