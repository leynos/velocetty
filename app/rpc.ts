/** @file Main-process RPC server wiring for renderer IPC. */
import {EventEmitter} from 'node:events';

import {ipcMain} from 'electron';
import type {BrowserWindow, IpcMainEvent} from 'electron';

import {v4 as uuidv4} from 'uuid';

import type {FilterNever, MainEvents, RendererEvents, TypedEmitter} from '@shared/types/common';

/** Main-process RPC server that routes renderer events over IPC. */
export class Server {
  /** Internal event bus used to dispatch events received from the renderer. */
  emitter: TypedEmitter<MainEvents>;
  /** Whether `destroy` has already run and this server should no longer register listeners. */
  destroyed = false;
  /** The window this RPC server is bound to. */
  win: BrowserWindow;
  /** Unique per-window channel id used for IPC message routing. */
  id!: string;

  constructor(win: BrowserWindow) {
    this.emitter = new EventEmitter();
    this.win = win;
    this.emit = this.emit.bind(this);

    if (this.destroyed) {
      return;
    }

    const uid = uuidv4();
    this.id = uid;

    ipcMain.on(uid, this.ipcListener);

    const shouldReportE2E = process.env.RUN_E2E === '1';

    // we intentionally subscribe to `on` instead of `once`
    // to support reloading the window and re-initializing
    // the channel
    this.wc.on('did-finish-load', () => {
      if (shouldReportE2E) {
        console.log('[e2e] renderer-ready');
      }
      this.wc.send('init', uid, win.profileName);
    });

    if (shouldReportE2E) {
      this.wc.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 3) {
          console.error(`[e2e][renderer-error] ${sourceId}:${line} ${message}`);
        }
      });
    }
  }

  /** The bound window's web contents, for sending/observing renderer IPC. */
  get wc() {
    return this.win.webContents;
  }

  private emitMainEvent<U extends keyof MainEvents>(ev: U, data: MainEvents[U] | undefined) {
    if (data === undefined) {
      return this.emitter.emit(ev as Exclude<keyof MainEvents, FilterNever<MainEvents>>);
    }

    return this.emitter.emit(ev as FilterNever<MainEvents>, data as MainEvents[FilterNever<MainEvents>]);
  }

  /** IPC handler registered on `this.id`, forwarding renderer events onto `emitter`. */
  ipcListener = <U extends keyof MainEvents>(_event: IpcMainEvent, {ev, data}: {ev: U; data?: MainEvents[U]}) =>
    this.emitMainEvent(ev, data);

  /** Subscribes to a renderer-originated event. */
  on = <U extends keyof MainEvents>(ev: U, fn: (arg0: MainEvents[U]) => void) => {
    this.emitter.on(ev, fn);
    return this;
  };

  /** Subscribes to a renderer-originated event for a single occurrence. */
  once = <U extends keyof MainEvents>(ev: U, fn: (arg0: MainEvents[U]) => void) => {
    this.emitter.once(ev, fn);
    return this;
  };

  /** Sends an event to the renderer, returning false if the window has been destroyed. */
  emit<U extends Exclude<keyof RendererEvents, FilterNever<RendererEvents>>>(ch: U): boolean;
  emit<U extends FilterNever<RendererEvents>>(ch: U, data: RendererEvents[U]): boolean;
  emit<U extends keyof RendererEvents>(ch: U, data?: RendererEvents[U]) {
    // This check is needed because data-batching can cause extra data to be
    // emitted after the window has already closed
    if (!this.win.isDestroyed()) {
      this.wc.send(this.id, {ch, data});
      return true;
    }
    return false;
  }

  /** Tears down IPC listeners for this server, or marks it destroyed if not yet registered. */
  destroy() {
    this.emitter.removeAllListeners();
    this.wc.removeAllListeners();
    if (this.id) {
      ipcMain.removeListener(this.id, this.ipcListener);
    } else {
      // mark for `genUid` in constructor
      this.destroyed = true;
    }
  }
}

/** Creates an RPC server bound to a browser window's renderer process. */
const createRPC = (win: BrowserWindow) => {
  return new Server(win);
};

export default createRPC;
