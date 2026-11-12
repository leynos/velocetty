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

import {mkdtempSync, rmSync, unwatchFile, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import {isJsonObject, isString} from '../../app/utils/runtime-guards';
import {createPage, type SentMessage} from '../testUtils/e2e-shortcut-probe-page';
import {
  type DebuggerCommandReply,
  getElectronMock,
  registerElectronMock,
  resetElectronMock
} from '../testUtils/electron-path';

// The probe imports Electron at module load, so the mock must be registered
// before the dynamic import below resolves it.
registerElectronMock();

const {E2E_COMPLETION_BARRIER_CHANNEL, sendShortcut, startShortcutProbe} = await import(
  '../../app/config/e2e-shortcut-probe'
);

/** The expression a `Runtime.evaluate` request carries, validated rather than cast. */
const expressionOf = (params: unknown): string => {
  if (!isJsonObject(params) || !isString(params['expression'])) {
    throw new TypeError('The probe did not send a Runtime.evaluate expression.');
  }
  return params['expression'];
};

/** The command id a sent message carries, or `undefined` when it runs none. */
const commandOf = (message: SentMessage): string | undefined => {
  const {payload} = message;
  if (!isJsonObject(payload)) {
    return undefined;
  }
  if (payload['ev'] !== 'command') {
    return undefined;
  }
  const {data} = payload;
  return isString(data) ? data : undefined;
};

/** The press token a sent message carries, so attribution can be asserted. */
const pressTokenOf = (message: SentMessage): string | null => {
  const {payload} = message;
  if (!isJsonObject(payload)) {
    throw new TypeError('The probe sent a message without an object payload.');
  }
  const pressToken = payload['pressToken'];
  if (pressToken === null || isString(pressToken)) {
    return pressToken;
  }
  // A command always carries a token, `null` when its request had none, so a
  // missing or exotic one means the probe stopped tagging what it sends.
  throw new TypeError(`The probe sent a command with no usable press token: ${String(pressToken)}`);
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

/** Restores one environment variable to the value it had before a test. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

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
    expect(page.sent).toEqual([
      {channel: 'window-uid', payload: {data: 'window:new', ev: 'command', pressToken: null}}
    ]);
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

  test('the press waits for the main process before it reports', async () => {
    const page = createPage({
      duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'command'})
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({command: 'window:new', kind: 'pressed'});
    // The page blocks on a synchronous round-trip, so the command's
    // main-process handler has run by the time the probe reports the press.
    expect(page.barrierChannels).toEqual([E2E_COMPLETION_BARRIER_CHANNEL]);
    // The wrapper is restored first, so the round-trip itself is never
    // recorded as a message the press sent.
    expect(page.barrierSawRestoredSend).toEqual([true]);
    expect(page.sent).toHaveLength(1);
  });

  test('main handles the command only after the barrier begins, before the press reports', async () => {
    const handled: Array<{barrierAlreadyBegun: boolean; command: string}> = [];
    const page = createPage({
      duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'command'}),
      onMainHandle: (message, {barrierAlreadyBegun}) => {
        const command = commandOf(message);
        if (command !== undefined) {
          handled.push({barrierAlreadyBegun, command});
        }
      }
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({command: 'window:new', kind: 'pressed'});
    // The double defers handling until the barrier drains its queue, so this
    // states the production ordering: dispatch emits the command, main runs
    // its handler during the synchronous round-trip, and only then does the
    // probe report the press.
    expect(handled).toEqual([{barrierAlreadyBegun: true, command: 'window:new'}]);
    expect(page.barrierChannels).toEqual([E2E_COMPLETION_BARRIER_CHANNEL]);
  });

  test('a command main handles late is not credited to the next press', async () => {
    const handled: string[] = [];
    let dispatches = 0;
    let deferred: string | undefined;
    const page = createPage({
      duringDispatch: (send) => {
        dispatches += 1;
        // Only the first press emits; the second is an unbound press.
        if (dispatches === 1) send('window-uid', {data: 'window:new', ev: 'command'});
      },
      onMainHandle: (message) => {
        // Main has not run this handler yet: it runs at the next barrier.
        deferred = commandOf(message);
      },
      onBarrier: () => {
        if (deferred !== undefined) {
          handled.push(deferred);
          deferred = undefined;
        }
      }
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({command: 'window:new', kind: 'pressed'});
    // The first press's command had not run when that press reported.
    expect(handled).toEqual([]);
    // The late handler runs during the second press's barrier. That press
    // emitted nothing, so it is unbound and the command stays attributed to
    // the press that emitted it.
    expect(await sendShortcut('ctrl+n')).toEqual({kind: 'unbound'});
    expect(handled).toEqual(['window:new']);
  });

  test('a command carries the token of the press that sent it', async () => {
    const page = createPage({
      duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'command'})
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n', '#7')).toEqual({command: 'window:new', kind: 'pressed'});
    // The token rides with the command, so main can attribute the marker the
    // handler prints without holding state of its own across presses.
    expect(page.sent.map((message) => pressTokenOf(message))).toEqual(['#7']);
  });

  test('a press without a token sends an untagged command', async () => {
    const page = createPage({
      duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'command'})
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n')).toEqual({command: 'window:new', kind: 'pressed'});
    // A bare chord, as a handwritten request writes it, produces the marker
    // shape a press outside the lane has always produced.
    expect(page.sent.map((message) => pressTokenOf(message))).toEqual([null]);
  });

  test('an event that is not a command is sent unmodified', async () => {
    const page = createPage({duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'edit'})});
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n', '#7')).toEqual({kind: 'unbound'});
    // Only a command is tagged; other renderer events are none of the probe's
    // business and must reach main exactly as the renderer sent them.
    expect(page.sent).toEqual([{channel: 'window-uid', payload: {data: 'window:new', ev: 'edit'}}]);
  });

  test('a command handled during a later press keeps the earlier press token', async () => {
    const delivered: SentMessage[] = [];
    let presses = 0;
    let deferred: SentMessage | undefined;
    const page = createPage({
      duringDispatch: (send) => {
        presses += 1;
        // Only the first press emits; the second is an unbound press.
        if (presses === 1) send('window-uid', {data: 'window:new', ev: 'command'});
      },
      onMainHandle: (message) => {
        deferred = message;
      },
      onBarrier: () => {
        if (deferred !== undefined) {
          delivered.push(deferred);
          deferred = undefined;
        }
      }
    });
    installWindow(evaluatingSession(page.context));

    expect(await sendShortcut('ctrl+n', '#1')).toEqual({command: 'window:new', kind: 'pressed'});
    expect(await sendShortcut('ctrl+n', '#2')).toEqual({kind: 'unbound'});

    // The first press's command is handled while the second press is running,
    // and it still names the first press. Holding a token for the duration of a
    // press instead would have credited this command to the second press.
    expect(delivered.map((message) => pressTokenOf(message))).toEqual(['#1']);
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
  test('an evaluation exception fails the press with the thrown description', async () => {
    // This is the shape the protocol actually sends: `text` is a generic
    // token, and the message that names the failure is on the exception.
    installWindow(
      replyingSession({
        exceptionDetails: {
          text: 'Uncaught',
          exception: {description: 'Error: ipcRenderer is unavailable in the page'}
        }
      })
    );

    await expect(sendShortcut('ctrl+n')).rejects.toThrow('ipcRenderer is unavailable in the page');
  });

  test('an exception with no description still fails with the generic token', async () => {
    installWindow(replyingSession({exceptionDetails: {text: 'Uncaught'}}));

    await expect(sendShortcut('ctrl+n')).rejects.toThrow('The page could not be instrumented: Uncaught');
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

describe('starting the probe', () => {
  test('start-up arms the completion barrier the page waits on', () => {
    const registeredChannels: string[] = [];
    // The probe holds the module's `ipcMain` object, so the suite replaces the
    // listener slot on it rather than swapping the object.
    getElectronMock().ipcMain.on = (channel) => {
      registeredChannels.push(channel);
    };
    const directory = mkdtempSync(path.join(tmpdir(), 'velocetty-probe-'));
    const requestFile = path.join(directory, 'requests.txt');
    writeFileSync(requestFile, '', 'utf8');
    const previousRunE2E = process.env.RUN_E2E;
    const previousPressFile = process.env.VELOCETTY_E2E_PRESS_FILE;
    process.env.RUN_E2E = '1';
    process.env.VELOCETTY_E2E_PRESS_FILE = requestFile;
    try {
      startShortcutProbe();

      // A press blocks on this channel, and the page has no other way to know
      // the main process handled it, so it must be armed before any request.
      expect(registeredChannels).toContain(E2E_COMPLETION_BARRIER_CHANNEL);
    } finally {
      unwatchFile(requestFile);
      rmSync(directory, {force: true, recursive: true});
      restoreEnv('RUN_E2E', previousRunE2E);
      restoreEnv('VELOCETTY_E2E_PRESS_FILE', previousPressFile);
    }
  });

  test('a run that is not the end-to-end lane arms nothing', () => {
    const registeredChannels: string[] = [];
    getElectronMock().ipcMain.on = (channel) => {
      registeredChannels.push(channel);
    };
    const previousRunE2E = process.env.RUN_E2E;
    delete process.env.RUN_E2E;
    try {
      startShortcutProbe();

      // The probe is dormant in a shipped build: no channel, no watcher.
      expect(registeredChannels).toEqual([]);
    } finally {
      restoreEnv('RUN_E2E', previousRunE2E);
    }
  });
});
