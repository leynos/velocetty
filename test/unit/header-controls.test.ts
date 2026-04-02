/** @file Verifies header control ordering and button double-click handling. */
import {expect, mock, test} from 'bun:test';

import {orderWindowControlButtons, stopDoubleClickPropagation} from '../../lib/components/header-controls';

test('reorders left-aligned window controls to close, minimise, then maximise', () => {
  const orderedButtons = orderWindowControlButtons(['minimise', 'maximise', 'close'], true);

  expect(orderedButtons).toEqual(['close', 'minimise', 'maximise']);
});

test('preserves minimise, maximise, then close order for right-aligned controls', () => {
  const orderedButtons = orderWindowControlButtons(['minimise', 'maximise', 'close'], false);

  expect(orderedButtons).toEqual(['minimise', 'maximise', 'close']);
});

test('stops button double-click propagation before the title bar handler sees it', () => {
  const stopPropagation = mock(() => {});

  stopDoubleClickPropagation({stopPropagation});

  expect(stopPropagation).toHaveBeenCalledTimes(1);
});
