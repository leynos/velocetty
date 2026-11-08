/** @file Injects a key chord into the focused window for the end-to-end lane. */
/*
 * The lane proves a shortcut executes its command by pressing it, not by
 * reading the configuration that declares it. This module is the main-process
 * half: the test writes one shortcut per line to standard input, and the probe
 * turns that text into the input events a real keypress would produce.
 *
 * It is dormant outside `RUN_E2E=1`, so a shipped build never reads standard
 * input and never synthesizes input events.
 */
import {BrowserWindow} from 'electron';

import {parseShortcut} from './e2e-shortcut-chord';
import {isE2ERun} from './e2e-keymap-probe';

/** The window a synthesized press should reach: the focused one, else the newest. */
const targetWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1);

/**
 * Sends one chord to the window the user is looking at.
 *
 * @returns `true` when the chord parsed and at least one window accepted it.
 *
 * @example
 * ```ts
 * sendShortcut('ctrl+alt+shift+n'); // presses the chord in the focused window
 * ```
 */
export const sendShortcut = (text: string): boolean => {
  const chord = parseShortcut(text);
  const window = targetWindow();
  if (chord === undefined || window === undefined) {
    return false;
  }

  const {keyCode, modifiers} = chord;
  for (const type of ['keyDown', 'keyUp'] as const) {
    window.webContents.sendInputEvent({keyCode, modifiers: [...modifiers], type});
  }
  return true;
};

/**
 * Starts reading chords from standard input, one per line.
 *
 * The end-to-end harness owns the write side, so this is a command channel
 * rather than a user interface: a line is a request to press that chord.
 */
export const startShortcutProbe = (): void => {
  if (!isE2ERun()) {
    return;
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.trim().length > 0) {
        sendShortcut(line);
      }
    }
  });
};
