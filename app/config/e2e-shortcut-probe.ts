/** @file Presses key chords for the end-to-end lane. */
/*
 * The lane proves a shortcut executes its command by pressing it, not by
 * reading the configuration that declares it. This module is the main-process
 * half: the test writes one shortcut per line to standard input, and the probe
 * presses that chord in the newest window's page.
 *
 * A press is a `KeyboardEvent` dispatched into the page rather than a key
 * event synthesized by the operating system. The scenario under test is the
 * renderer's keymap binding, which is what turns a press into a command, so a
 * page-level press exercises exactly that boundary. It also keeps the lane
 * deterministic: Electron only delivers an operating-system key event while
 * the window holds operating-system focus, which a headless Linux runner and a
 * Windows runner without a foreground window never give it.
 *
 * It is dormant outside `RUN_E2E=1`, so a shipped build never reads standard
 * input and never synthesizes key events.
 */
import {BrowserWindow, type WebContents} from 'electron';

import {emitE2EMarker, isE2ERun} from './e2e-keymap-probe';
import {parseShortcut, toKeyPress, type KeyPress} from './e2e-shortcut-chord';

/** The shape of the reply the page returns for a pressed chord. */
type EvaluateReply = Readonly<{result?: Readonly<{value?: unknown}>}>;

/** The page a press should reach: the focused window, else the newest one. */
const targetContents = (): WebContents | undefined => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1);
  return window?.webContents;
};

/**
 * The page expression that presses one chord.
 *
 * `KeyboardEvent` carries the same fields a real press does, so the page's
 * keyboard library matches the chord exactly as it would for a user. The body
 * is the element that library listens on, and pressing there keeps the press
 * away from the terminal, which would otherwise receive it as typed input.
 *
 * @returns The expression, which evaluates to `true` once the press is
 * dispatched and `false` while the page has no body to press on yet.
 */
const pressExpression = (press: KeyPress): string => {
  const eventInit = JSON.stringify({...press, bubbles: true, cancelable: true});
  return `(() => {
  const body = document.body;
  if (body === null) return false;
  body.dispatchEvent(new KeyboardEvent('keydown', ${eventInit}));
  return true;
})()`;
};

/** Dispatches one press in the page through the window's DevTools session. */
const pressInPage = async (contents: WebContents, press: KeyPress): Promise<boolean> => {
  // A second `attach` throws, so an already-attached session is reused.
  if (!contents.debugger.isAttached()) {
    contents.debugger.attach('1.3');
  }
  const reply: EvaluateReply = await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: pressExpression(press),
    returnByValue: true
  });
  return reply.result?.value === true;
};

/**
 * Presses one chord in the window the user is looking at.
 *
 * @returns `true` when the chord was understood and the page accepted it.
 *
 * @example
 * ```ts
 * await sendShortcut('ctrl+alt+shift+n'); // presses the chord in the focused window
 * ```
 */
export const sendShortcut = async (text: string): Promise<boolean> => {
  const chord = parseShortcut(text);
  const contents = targetContents();
  const press = chord === undefined ? undefined : toKeyPress(chord);
  if (press === undefined || contents === undefined) {
    return false;
  }
  return pressInPage(contents, press);
};

/** Presses one line and reports a rejected or failed request as a marker. */
const pressLine = async (line: string): Promise<void> => {
  try {
    if (await sendShortcut(line)) {
      emitE2EMarker(`[e2e] shortcut-probe pressed ${line}`);
    } else {
      emitE2EMarker(`[e2e] shortcut-probe rejected ${line}`);
    }
  } catch (error) {
    emitE2EMarker(`[e2e] shortcut-probe failed ${line}: ${String(error)}`);
  }
};

/**
 * Starts reading chords from standard input, one per line.
 *
 * The end-to-end harness owns the write side, so this is a command channel
 * rather than a user interface: a line is a request to press that chord. Lines
 * are pressed in order, so a burst of writes cannot interleave two presses.
 */
export const startShortcutProbe = (): void => {
  if (!isE2ERun()) {
    return;
  }

  let pending: Promise<void> = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.trim().length > 0) {
        pending = pending.then(() => pressLine(line));
      }
    }
  });
};
