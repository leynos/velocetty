/** @file Presses key chords for the end-to-end lane. */
/*
 * The lane proves a shortcut executes its command by pressing it, not by
 * reading the configuration that declares it. This module is the main-process
 * half: the test appends one shortcut per line to a request file, and the
 * probe presses that chord in the newest window's page. The press reports the
 * command it emitted, captured while the key event was dispatched, so the
 * harness never has to infer attribution from a marker count.
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

import {BrowserWindow, ipcMain, type WebContents} from 'electron';

import {isString} from '../utils/runtime-guards';
import {emitE2EMarker, isE2ERun} from './e2e-keymap-probe';
import {parseShortcut, toKeyPress, type KeyPress} from './e2e-shortcut-chord';

/**
 * The channel a press uses to wait until the main process has handled it.
 *
 * The renderer turns a press into commands and sends each one to the main
 * process over IPC, so the command itself runs after the key event returns. A
 * synchronous round-trip on this channel is answered only after main has
 * handled the messages this renderer sent before it, which makes it a
 * completion barrier rather than a delay: once the page's `sendSync` returns,
 * the command's main-process handler has run.
 *
 * The probe owns both ends, and the channel carries no data, so it is inert
 * unless the end-to-end lane started the probe.
 */
export const E2E_COMPLETION_BARRIER_CHANNEL = 'velocetty-e2e-press-complete';

/**
 * The shape of the reply the page returns for a pressed chord.
 *
 * `text` is a fixed token such as `Uncaught` when the expression throws; the
 * thrown value's own description, which is what names the failure, is carried
 * on `exception.description`.
 */
type EvaluateReply = Readonly<{
  result?: Readonly<{value?: unknown}>;
  exceptionDetails?: Readonly<{
    text?: string;
    exception?: Readonly<{description?: string}>;
  }>;
}>;

/** How often the request file is checked for new lines. */
const pollIntervalMs = 50;

/** What one press established about the chord it dispatched. */
export type ShortcutOutcome =
  | Readonly<{kind: 'pressed'; command: string}>
  | Readonly<{kind: 'unbound'}>
  | Readonly<{kind: 'rejected'}>;

/** The window a press should reach: the focused window, else the newest one. */
const targetWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1);

/**
 * The page expression that presses one chord and reports what it emitted.
 *
 * `KeyboardEvent` carries the same fields a real press does, so the page's
 * keyboard library matches the chord exactly as it would for a user. The body
 * is the element that library listens on, and pressing there keeps the press
 * away from the terminal, which would otherwise receive it as typed input.
 *
 * The expression also attributes the press. Mousetrap handles the event and
 * the redux effects middleware runs the command effect synchronously inside
 * `dispatchEvent`, so a command recorded while the event is dispatched was
 * emitted by this press. A command from an earlier press whose IPC message
 * arrives late is not recorded here, and so cannot be counted for this one.
 *
 * After the dispatch the expression blocks on a synchronous round-trip to the
 * main process. Every press therefore observes the same ordering: by the time
 * the page returns, the main process has handled the command message this
 * press sent and run its handler. A marker that handler prints is in the
 * output before the probe reports the press, so a scenario counting markers
 * around a press cannot be satisfied by a command that has not run yet.
 *
 * The command message also carries the caller's token. Attribution cannot rest
 * on the probe's own state: a command whose handler lands while a later press
 * is being sent would otherwise print the later press's token, so the token
 * travels with the command it belongs to and main binds it only while running
 * that command's handler.
 *
 * @param press - The chord fields to dispatch.
 * @param pressToken - The caller's request token, or `undefined` for none.
 * @returns The expression, which evaluates to `null` when the page has no body
 * to press on yet, or to the command identifiers this press emitted.
 */
const pressExpression = (press: KeyPress, pressToken: string | undefined): string => {
  const eventInit = JSON.stringify({...press, bubbles: true, cancelable: true});
  // The token is data, not code, so it is embedded as a JSON literal.
  const tokenLiteral = JSON.stringify(pressToken ?? null);
  return `(() => {
  const body = document.body;
  if (body === null) return null;
  const requireModule = window.require;
  if (typeof requireModule !== 'function') {
    throw new Error('ipcRenderer is unavailable in the page');
  }
  const ipc = requireModule('electron').ipcRenderer;
  const send = ipc.send;
  const commands = [];
  // The renderer's RPC client sends every event on the window's own channel
  // and names the event in the payload, so the command is payload.data rather
  // than the channel name.
  ipc.send = function (channel, ...args) {
    const payload = args[0];
    if (payload !== null && typeof payload === 'object' && payload.ev === 'command' && typeof payload.data === 'string') {
      commands.push(payload.data);
      // The token rides with the command, so main attributes this command's
      // marker to the press that sent it rather than to a later press.
      args[0] = {...payload, pressToken: ${tokenLiteral}};
    }
    return send.call(this, channel, ...args);
  };
  try {
    body.dispatchEvent(new KeyboardEvent('keydown', ${eventInit}));
  } finally {
    ipc.send = send;
  }
  // Restored first, so the barrier round-trip is never mistaken for a press
  // message. The handler it waits for is registered by the probe in main.
  ipc.sendSync(${JSON.stringify(E2E_COMPLETION_BARRIER_CHANNEL)});
  return commands;
})()`;
};

/**
 * Reads the page's press result.
 *
 * @param value - The value the page returned.
 * @returns The emitted commands, or `undefined` when there was no body.
 */
const classifyCommands = (value: unknown): readonly string[] | undefined => {
  if (value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError('The page returned an unexpected press result.');
  }
  const commands: string[] = [];
  for (const item of value) {
    if (!isString(item)) {
      throw new TypeError('The page returned a non-string command.');
    }
    commands.push(item);
  }
  return commands;
};

/**
 * Dispatches one press in the page through the window's DevTools session.
 *
 * @returns The commands the press emitted, or `undefined` when the page had no
 * body to press on.
 */
const pressInPage = async (
  contents: WebContents,
  press: KeyPress,
  pressToken: string | undefined
): Promise<readonly string[] | undefined> => {
  // A second `attach` throws, so an already-attached session is reused.
  if (!contents.debugger.isAttached()) {
    contents.debugger.attach('1.3');
  }
  const reply: EvaluateReply = await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: pressExpression(press, pressToken),
    returnByValue: true
  });
  if (reply.exceptionDetails !== undefined) {
    const {exception, text} = reply.exceptionDetails;
    // The protocol puts the thrown message on the exception and leaves `text`
    // as a generic token, so the description is the only field that says what
    // actually went wrong.
    throw new Error(`The page could not be instrumented: ${exception?.description ?? text ?? 'unknown error'}`);
  }
  return classifyCommands(reply.result?.value);
};

/**
 * Presses one chord and reports the command it emitted, if any.
 *
 * The command is attributable because it is captured while the key event is
 * dispatched, and its completion is attributable because the page returns only
 * after main has handled it. `unbound` means the page accepted the press and
 * emitted no command, which is how a scenario proves a binding is gone; the
 * harness separately counts the marker the main process prints when it
 * executes the reported command.
 */
const pressAndObserve = async (
  window: BrowserWindow,
  press: KeyPress,
  pressToken: string | undefined
): Promise<ShortcutOutcome> => {
  const commands = await pressInPage(window.webContents, press, pressToken);
  if (commands === undefined) {
    return {kind: 'rejected'};
  }
  // `at` reports absence explicitly; indexing would be typed as a plain
  // `string` because the typecheck configuration disables
  // `noUncheckedIndexedAccess`.
  const command = commands.at(0);
  return command === undefined ? {kind: 'unbound'} : {kind: 'pressed', command};
};

/**
 * Presses one chord in the window the user is looking at.
 *
 * @param text - The chord to press.
 * @param pressToken - The caller's request token, which travels with any
 * command the press emits so the marker it prints names this press.
 * @returns `pressed` with the command the chord emitted, `unbound` when the
 * page accepted it but emitted no command, and `rejected` when there was no
 * page to press on or the chord was not understood.
 *
 * @example
 * ```ts
 * await sendShortcut('ctrl+alt+shift+n'); // {kind: 'pressed', command: 'window:new'}
 * await sendShortcut('ctrl+alt+shift+n', '#7'); // its marker names request #7
 * ```
 */
export const sendShortcut = async (text: string, pressToken?: string): Promise<ShortcutOutcome> => {
  const chord = parseShortcut(text);
  const window = targetWindow();
  const press = chord === undefined ? undefined : toKeyPress(chord);
  if (press === undefined || window === undefined) {
    return {kind: 'rejected'};
  }
  return pressAndObserve(window, press, pressToken);
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
  const token = replyPrefix.trim();
  try {
    // The token travels with the command the press emits, so it is not held
    // here: a command from an earlier press that lands during this one keeps
    // its own token rather than borrowing this press's.
    const outcome = await sendShortcut(shortcut, token === '' ? undefined : token);
    // The command travels in the reply so a scenario can require the press to
    // have run the command it expected, not merely some command.
    const detail = outcome.kind === 'pressed' ? ` command=${outcome.command}` : '';
    emitE2EMarker(`[e2e] shortcut-probe ${outcome.kind} ${replyPrefix}${shortcut}${detail}`);
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

  // The page answers the barrier only after main has handled the messages the
  // press sent, so this handler is what gives a press its completion ordering.
  ipcMain.on(E2E_COMPLETION_BARRIER_CHANNEL, (event) => {
    event.returnValue = true;
  });

  let offset = 0;
  let pending: Promise<void> = Promise.resolve();
  fs.watchFile(file, {interval: pollIntervalMs}, () => {
    pending = pending.then(async () => {
      offset = await pressAppendedLines(file, offset);
    });
  });
};
