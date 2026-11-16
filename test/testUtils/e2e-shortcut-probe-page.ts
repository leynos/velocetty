/** @file The sandboxed page the end-to-end shortcut probe is evaluated in. */
/*
 * The probe imports Electron and reads the focused window's debugger, so its
 * press logic is only observable through the expression it sends. This helper
 * builds a `node:vm` page whose `window.require('electron')` returns an IPC
 * double, letting a test drive what the renderer sends while the key event is
 * dispatched and decide when the main-process double handles it.
 *
 * Cross-links:
 * - Source: `app/config/e2e-shortcut-probe.ts`
 * - Tests: `test/unit/e2e-shortcut-probe.test.ts`
 */
import vm from 'node:vm';

/** One message the page's RPC client sent. */
export type SentMessage = Readonly<{channel: string; payload: unknown}>;

/** The page's IPC double and the key events the probe dispatched into it. */
export type Page = Readonly<{
  barrierChannels: string[];
  /** Whether the probe's `send` wrapper was already restored at each barrier. */
  barrierSawRestoredSend: boolean[];
  context: vm.Context;
  eventInits: unknown[];
  ipc: {send: (channel: string, payload: unknown) => void; sendSync: (channel: string) => boolean};
  originalSend: (channel: string, payload: unknown) => void;
  sent: SentMessage[];
}>;

/** What the test's main-process double knows when it handles one message. */
export type MainHandleContext = Readonly<{
  /** Whether the barrier had already begun when main handled this message. */
  readonly barrierAlreadyBegun: boolean;
}>;

/** The hooks a test uses to place its own work inside the press. */
export type PageHooks = Readonly<{
  /** Runs inside `dispatchEvent`, so whatever it sends goes through the wrapper. */
  duringDispatch?: (send: (channel: string, payload: unknown) => void) => void;
  /** Handles one queued message when the barrier drains it. */
  onMainHandle?: (message: SentMessage, context: MainHandleContext) => void;
  /** Runs as the barrier begins, before queued messages are handled. */
  onBarrier?: () => void;
}>;

/**
 * A page whose `window.require('electron')` returns the test's IPC double.
 *
 * `duringDispatch` runs inside `dispatchEvent`, so whatever it sends goes
 * through the wrapper the probe installed for the press. Sent messages queue
 * for the main-process double, which handles them only when the synchronous
 * barrier is answered: that models a main process that has not yet run the
 * command while the key event is still being dispatched. `onBarrier` runs as
 * the barrier begins, before queued messages are handled, so a test can model
 * work main deferred from an earlier press.
 *
 * @param hooks - The callbacks that place test work inside the press.
 * @returns The page double and the records a test asserts on.
 *
 * @example
 * ```ts
 * const page = createPage({duringDispatch: (send) => send('window-uid', {data: 'window:new', ev: 'command'})});
 * page.sent; // [{channel: 'window-uid', payload: {data: 'window:new', ev: 'command'}}]
 * ```
 */
export const createPage = ({
  duringDispatch = () => {},
  onMainHandle = () => {},
  onBarrier = () => {}
}: PageHooks = {}): Page => {
  const sent: SentMessage[] = [];
  const pendingMessages: SentMessage[] = [];
  const barrierChannels: string[] = [];
  const barrierSawRestoredSend: boolean[] = [];
  const originalSend = (channel: string, payload: unknown) => {
    const message = {channel, payload};
    sent.push(message);
    pendingMessages.push(message);
  };
  const ipc = {
    send: originalSend,
    // The probe waits for main on this channel after every dispatch. Main
    // handles every message this renderer sent before it answers, which is
    // what the synchronous round-trip guarantees in production.
    sendSync: (channel: string) => {
      barrierChannels.push(channel);
      barrierSawRestoredSend.push(ipc.send === originalSend);
      onBarrier();
      for (const message of pendingMessages.splice(0)) {
        onMainHandle(message, {barrierAlreadyBegun: barrierChannels.length > 0});
      }
      return true;
    }
  };
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
  return {barrierChannels, barrierSawRestoredSend, context, eventInits, ipc, originalSend, sent};
};
