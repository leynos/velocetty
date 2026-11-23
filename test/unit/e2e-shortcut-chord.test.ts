/** @file Verifies the shortcut spelling the end-to-end probe accepts. */
import {describe, expect, test} from 'bun:test';

import {parseShortcut, toKeyPress} from '../../app/config/e2e-shortcut-chord';

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

describe('toKeyPress', () => {
  test('carries the key fields and the held modifiers', () => {
    expect(toKeyPress({keyCode: 'm', modifiers: ['control', 'alt', 'shift']})).toEqual({
      altKey: true,
      code: 'KeyM',
      ctrlKey: true,
      key: 'm',
      keyCode: 77,
      metaKey: false,
      shiftKey: true
    });
  });

  test('maps digits onto their physical keys', () => {
    expect(toKeyPress({keyCode: '4', modifiers: ['meta']})).toEqual({
      altKey: false,
      code: 'Digit4',
      ctrlKey: false,
      key: '4',
      keyCode: 52,
      metaKey: true,
      shiftKey: false
    });
  });

  test('rejects keys it cannot name', () => {
    // The probe presses letters and digits only; anything else would need a
    // key-code table this lane does not have.
    expect(toKeyPress({keyCode: 'f5', modifiers: ['control']})).toBeUndefined();
    expect(toKeyPress({keyCode: 'enter', modifiers: ['control']})).toBeUndefined();
  });
});
