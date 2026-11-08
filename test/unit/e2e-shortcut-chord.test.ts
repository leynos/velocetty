/** @file Verifies the shortcut spelling the end-to-end probe accepts. */
import {describe, expect, test} from 'bun:test';

import {parseShortcut} from '../../app/config/e2e-shortcut-chord';

describe('parseShortcut', () => {
  test('maps every supported modifier onto its Electron name', () => {
    expect(parseShortcut('ctrl+alt+shift+n')).toEqual({
      keyCode: 'n',
      modifiers: ['control', 'alt', 'shift']
    });
    expect(parseShortcut('command+super+meta+cmd+k')).toEqual({
      keyCode: 'k',
      modifiers: ['meta', 'meta', 'meta', 'meta']
    });
  });

  test('normalizes case and surrounding whitespace', () => {
    expect(parseShortcut('  CTRL + SHIFT + M  ')).toEqual({
      keyCode: 'm',
      modifiers: ['control', 'shift']
    });
  });

  test('rejects text that is not a usable chord', () => {
    // A bare key would press something, but it is not the chord the test
    // asked for, so the probe must not guess at it.
    expect(parseShortcut('n')).toBeUndefined();
    expect(parseShortcut('ctrl+')).toBeUndefined();
    expect(parseShortcut('')).toBeUndefined();
    expect(parseShortcut('hyper+n')).toBeUndefined();
  });
});
