/** @file Presses key chords for the end-to-end lane. */
/*
 * The lane proves a shortcut executes its command by pressing it, not by
 * reading the configuration that declares it. This module is the main-process
 * half: the test appends one shortcut per line to a request file, and the
 * probe presses that chord in the newest window's page. Because the probe also
 * watches the window's command channel, its reply says whether that press ran
 * a command, so the harness never has to infer that from a marker count.
 *
 * A press is a `KeyboardEvent` dispatched into the page rather than a key
 * event synthesized by the operating system. The scenario under test is the
 * renderer's keymap binding, which is what turns a press into a command, so a
 * page-level press exercises exactly that boundary. It also keeps the lane
 * deterministic: Electron only delivers an operating-system key event while
 * the window holds operating-system focus, which a headless Linux runner and a
 * Windows runner without a foreground window never give it.
 *
 * The request file stands in for standard input because Electron on Windows
 * has no console and never delivers piped standard input to the main process,
 * so a stdin channel there would silently press nothing.
 *
 * It is dormant outside `RUN_E2E=1`, so a shipped build never reads a request
 * file and never synthesizes key events.
 */
import * as fs from 'node:fs';

import type {CommandId} from '@shared/types/commands';
import {BrowserWindow, type WebContents} from 'electron';

import {emitE2EMarker, isE2ERun} from './e2e-keymap-probe';
import {parseShortcut, toKeyPress, type KeyPress} from './e2e-shortcut-chord';

/** The shape of the reply the page returns for a pressed chord. */
type EvaluateReply = Readonly<{result?: Readonly<{value?: unknown}>}>;

/** How often the request file is checked for new lines. */
const pollIntervalMs = 50;

/**
 * How long a press may take to reach the main process's command handler.
 *
 * The page sends the command during the dispatch, so this only covers the IPC
 * hop back into the main process. The wait is also what tells a chord that is
 * bound to no command apart from one that is.
 */
const commandTimeoutMs = 2000;

/** What one press established about the chord it dispatched. */
export type ShortcutOutcome = 'pressed' | 'unbound' | 'rejected';

/** The window a press should reach: the focused window, else the newest one. */
const targetWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1);

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
 * Presses one chord and reports whether the main process handled a command.
 *
 * The reply is a completion boundary: when it says `pressed`, the command has
 * already reached the main process, so the harness knows this press ran it
 * rather than guessing from a marker count that a late marker from an earlier
 * press could satisfy. `unbound` means the page accepted the press and no
 * command followed, which is how a scenario proves a binding is gone.
 */
const pressAndObserve = async (window: BrowserWindow, press: KeyPress): Promise<ShortcutOutcome> => {
  let settle: ((command: CommandId | undefined) => void) | undefined;
  const observed = new Promise<CommandId | undefined>((resolve) => {
    settle = resolve;
  });
  /** Resolves this press's observation with the command it ran, if any. */
  const listener = (command: CommandId) => settle?.(command);
  window.rpc.on('command', listener);
  try {
    if (!(await pressInPage(window.webContents, press))) {
      return 'rejected';
    }
    const timeout = setTimeout(() => settle?.(undefined), commandTimeoutMs);
    const command = await observed;
    clearTimeout(timeout);
    return command === undefined ? 'unbound' : 'pressed';
  } finally {
    window.rpc.emitter.removeListener('command', listener);
  }
};

/**
 * Presses one chord in the window the user is looking at.
 *
 * @returns `pressed` when the chord ran a command, `unbound` when the page
 * accepted it but no command followed, and `rejected` when there was no page
 * to press on or the chord was not understood.
 *
 * @example
 * ```ts
 * await sendShortcut('ctrl+alt+shift+n'); // 'pressed' once the window handles window:new
 * ```
 */
export const sendShortcut = async (text: string): Promise<ShortcutOutcome> => {
  const chord = parseShortcut(text);
  const window = targetWindow();
  const press = chord === undefined ? undefined : toKeyPress(chord);
  if (press === undefined || window === undefined) {
    return 'rejected';
  }
  return pressAndObserve(window, press);
};

/**
 * One request line, split into the caller's token and the chord.
 *
 * The harness writes `<token>` and a tab before the chord. The token travels
 * back in the reply so the caller can tell its reply from an earlier press of
 * the same chord; a line without a tab still presses its chord, which keeps a
 * handwritten request working.
 */
type ProbeRequest = Readonly<{
  /** The caller's token and a trailing space, or nothing for a bare chord. */
  readonly replyPrefix: string;
  readonly shortcut: string;
}>;

/**
 * Splits one request line into the caller's token and the chord.
 *
 * @param line - A request as the harness wrote it.
 * @returns The reply prefix, empty for a bare chord, and the chord to press.
 *
 * @example
 * ```ts
 * parseRequest('#7\tctrl+alt+shift+n'); // {replyPrefix: '#7 ', shortcut: 'ctrl+alt+shift+n'}
 * ```
 */
const parseRequest = (line: string): ProbeRequest => {
  const tab = line.indexOf('\t');
  return tab === -1
    ? {replyPrefix: '', shortcut: line}
    : {replyPrefix: `${line.slice(0, tab)} `, shortcut: line.slice(tab + 1)};
};

/** Presses one request and reports its outcome under the request's token. */
const pressLine = async (line: string): Promise<void> => {
  const {replyPrefix, shortcut} = parseRequest(line);
  try {
    const outcome = await sendShortcut(shortcut);
    emitE2EMarker(`[e2e] shortcut-probe ${outcome} ${replyPrefix}${shortcut}`);
  } catch (error) {
    emitE2EMarker(`[e2e] shortcut-probe failed ${replyPrefix}${shortcut}: ${String(error)}`);
  }
};

/** The request file the harness named, if it named one. */
const requestFile = (): string | undefined => {
  const file = process.env.VELOCETTY_E2E_PRESS_FILE;
  return file === undefined || file.length === 0 ? undefined : file;
};

/**
 * Presses every complete request line appended since the last read.
 *
 * A trailing partial line is left for the next read, so a write that lands
 * mid-line cannot press a truncated chord.
 *
 * @returns The offset the next read should start from.
 */
const pressAppendedLines = async (file: string, offset: number): Promise<number> => {
  const contents = await fs.promises.readFile(file, 'utf8').catch(() => '');
  const fresh = contents.slice(offset);
  const lastBreak = fresh.lastIndexOf('\n');
  if (lastBreak === -1) {
    return offset;
  }
  for (const line of fresh.slice(0, lastBreak).split('\n')) {
    if (line.trim().length > 0) {
      await pressLine(line);
    }
  }
  return offset + lastBreak + 1;
};

/**
 * Starts pressing the chords the end-to-end harness appends to its file.
 *
 * The harness owns the write side, so this is a command channel rather than a
 * user interface: a line is a request to press that chord. Lines are pressed
 * in order, so a burst of writes cannot interleave two presses.
 */
export const startShortcutProbe = (): void => {
  if (!isE2ERun()) {
    return;
  }
  const file = requestFile();
  if (file === undefined) {
    return;
  }

  let offset = 0;
  let pending: Promise<void> = Promise.resolve();
  fs.watchFile(file, {interval: pollIntervalMs}, () => {
    pending = pending.then(async () => {
      offset = await pressAppendedLines(file, offset);
    });
  });
};
