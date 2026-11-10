/**
 * @file Pins the end-to-end shortcut probe's press outcomes and its capture.
 *
 * The probe decides what a press established from the value its page
 * expression returns. These tests evaluate the expression the probe really
 * sends, inside a sandboxed page whose `ipcRenderer.send` the test controls,
 * so the capture rule is exercised rather than asserted as expression text:
 * a command is recorded only when the renderer sends it while the key event is
 * dispatched, and a command sent after the press returns is never recorded for
 * it.
 *
 * Cross-links:
 * - Source: `app/config/e2e-shortcut-probe.ts`
 * - Harness: `test/testUtils/electron-path.ts`
 */
import {afterEach, describe, expect, test} from 'bun:test';

import vm from 'node:vm';

import {isJsonObject, isString} from '../../app/utils/runtime-guards';
import {
  type DebuggerCommandReply,
  getElectronMock,
  registerElectronMock,
  resetElectronMock
} from '../testUtils/electron-path';

// The probe imports Electron at module load, so the mock must be registered
// before the dynamic import below resolves it.
registerElectronMock();

const {sendShortcut} = await import('../../app/config/e2e-shortcut-probe');

/** One message the page's RPC client sent. */
type SentMessage = Readonly<{channel: string; payload: unknown}>;

/** The page's IPC double and the key events the probe dispatched into it. */
type Page = Readonly<{
  context: vm.Context;
  eventInits: unknown[];
  ipc: {send: (channel: string, payload: unknown) => void};
  originalSend: (channel: string, payload: unknown) => void;
  sent: SentMessage[];
}>;

/** The expression a `Runtime.evaluate` request carries, validated rather than cast. */
const expressionOf = (params: unknown): string => {
  if (!isJsonObject(params) || !isString(params['expression'])) {
    throw new TypeError('The probe did not send a Runtime.evaluate expression.');
  }
  return params['expression'];
};

/**
 * A page whose `window.require('electron')` returns the test's IPC double.
 *
 * `duringDispatch` runs inside `dispatchEvent`, so whatever it sends goes
 * through the wrapper the probe installed for the press.
 */
const createPage = ({
  duringDispatch = () => {}
}: Readonly<{duringDispatch?: (send: (channel: string, payload: unknown) => void) => void}> = {}): Page => {
  const sent: SentMessage[] = [];
  const ipc = {
    send: (channel: string, payload: unknown) => {
      sent.push({channel, payload});
    }
  };
  const originalSend = ipc.send;
  const eventInits: unknown[] = [];
  // A body element is the element the renderer's keyboard library listens on;
  // a page without one cannot be pressed, which `document.body === null` maps.
  const body = {
    dispatchEvent: (event: unknown) => {
      duringDispatch(ipc.send);
      return event !== undefined;
    }
  };
  /** Records the fields the probe builds so the key press itself is visible. */
  class FakeKeyboardEvent {
    readonly type: string;

    constructor(type: string, init: unknown) {
      this.type = type;
      eventInits.push({init, type});
    }
  }
  const context = vm.createContext({
    document: {body},
    KeyboardEvent: FakeKeyboardEvent,
    window: {require: () => ({ipcRenderer: ipc})}
  });
  return {context, eventInits, ipc, originalSend, sent};
};

/** A page with no body to press on yet, which is what a loading window has. */
const pageWithoutBody = (): vm.Context =>
  vm.createContext({
    document: {body: null},
    KeyboardEvent: class {},
    window: {require: () => ({ipcRenderer: {send: () => {}}})}
  });

/** A debugger session that evaluates the probe's expression in `context`. */
const evaluatingSession = (context: vm.Context) => ({
  attach: () => {},
  isAttached: () => false,
  sendCommand: async (_method: string, params: unknown) => ({
    result: {value: vm.runInContext(expressionOf(params), context)}
  })
});

/** A debugger session that answers with a fixed protocol reply. */
const replyingSession = (reply: DebuggerCommandReply) => ({
  attach: () => {},
  isAttached: () => false,
  sendCommand: async () => reply
});

/** Installs one fake window as the focused window for the next press. */
const installWindow = (session: ReturnType<typeof evaluatingSession> | ReturnType<typeof replyingSession>) => {
  getElectronMock().BrowserWindow.getFocusedWindow = () => ({
    webContents: {debugger: session, sendInputEvent: () => {}}
  });
};

afterEach(() => {
  resetElectronMock();
});

describe('what a press established', () => {
  test('a command sent during the dispatch is reported as the pressed command', async () => {
    const page = createPage({
      duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'command'})
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({command: 'window:new', kind: 'pressed'});
    // The press really reached the window's RPC channel; the probe only
    // observed the message, so the command still ran in the main process.
    expect(page.sent).toEqual([{channel: 'window-uid', payload: {data: 'window:new', ev: 'command'}}]);
    // The key event carries the chord, so the press is the one the lane asked
    // for rather than an unmodified keydown.
    expect(page.eventInits).toEqual([
      {
        init: {
          altKey: false,
          bubbles: true,
          cancelable: true,
          code: 'KeyN',
          ctrlKey: true,
          key: 'n',
          keyCode: 78,
          metaKey: false,
          shiftKey: false
        },
        type: 'keydown'
      }
    ]);
  });

  test('a press that sends only another event reports no command', async () => {
    const page = createPage({duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'edit'})});
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'unbound'});
    expect(page.sent).toHaveLength(1);
  });

  test('a command event whose data is not a command id reports no command', async () => {
    const page = createPage({duringDispatch: (send) => send('window-uid', {data: 42, ev: 'command'})});
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'unbound'});
  });

  test('a command sent after the press returns is not attributed to it', async () => {
    const page = createPage();
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'unbound'});
    // The wrapper is gone once the press returns, so a late message from an
    // earlier press is never credited to this one.
    expect(page.ipc.send).toBe(page.originalSend);
    page.ipc.send('window-uid', {data: 'window:new', ev: 'command'});
    expect(page.sent).toHaveLength(1);
  });

  test('a page with no body cannot be pressed', async () => {
    installWindow(evaluatingSession(pageWithoutBody()));

    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'rejected'});
  });

  test('a press with no window at all is rejected', async () => {
    // The shared mock starts with an empty registry.
    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'rejected'});
  });

  test('an unusable chord is rejected without pressing anything', async () => {
    const page = createPage();
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('n')).toEqual({kind: 'rejected'});
    expect(page.eventInits).toEqual([]);
  });
});

describe('a page that cannot be instrumented', () => {
  test('an evaluation exception fails the press', async () => {
    installWindow(replyingSession({exceptionDetails: {text: 'ipcRenderer is unavailable in the page'}}));

    await expect(sendShortcut('ctrl+n')).rejects.toThrow('ipcRenderer is unavailable in the page');
  });

  test('a result that is not an array fails rather than reporting no command', async () => {
    installWindow(replyingSession({result: {value: 'not-an-array'}}));

    await expect(sendShortcut('ctrl+n')).rejects.toThrow('The page returned an unexpected press result.');
  });

  test('a command that is not a string fails rather than being reported', async () => {
    installWindow(replyingSession({result: {value: ['window:new', 42]}}));

    await expect(sendShortcut('ctrl+n')).rejects.toThrow('The page returned a non-string command.');
  });

  test('an already attached session is reused instead of attached twice', async () => {
    let attaches = 0;
    const session = {
      attach: () => {
        attaches += 1;
      },
      isAttached: () => true,
      sendCommand: async () => ({result: {value: []}})
    };
    installWindow(session);

    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'unbound'});
    // Chromium throws when a second `attach` runs on the same session.
    expect(attaches).toBe(0);
  });
});
