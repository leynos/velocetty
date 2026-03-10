/**
 * @file RPC client for renderer-to-main IPC messaging.
 * Manages event subscription lifecycle and emits typed commands for the
 * renderer process.
 */
import {EventEmitter} from 'node:events';

import type {IpcRendererEvent} from 'electron';

import type {
  FilterNever,
  IpcRendererWithCommands,
  MainEvents,
  RendererEvents,
  TypedEmitter
} from '@shared/types/common';

export type RpcClientIpc = Pick<IpcRendererWithCommands, 'on' | 'removeListener' | 'send'>;

type RpcWindowState = {
  __rpcId?: string;
  require?: (moduleId: string) => unknown;
};

type ClientOptions = {
  deferReadyRegistration?: (callback: () => void) => void;
  ipc?: RpcClientIpc;
  windowHost?: RpcWindowState;
};

const resolveWindowHost = (): RpcWindowState => window as RpcWindowState;
const defaultDeferReadyRegistration = (callback: () => void) => {
  setTimeout(callback, 0);
};
const resolveIpcRenderer = (): RpcClientIpc => {
  if (typeof window.require !== 'function') {
    throw new Error('Electron ipcRenderer is unavailable');
  }

  const electronModule = window.require('electron') as {ipcRenderer: IpcRendererWithCommands};
  return electronModule.ipcRenderer;
};

/** Renderer-side RPC client that forwards typed events over IPC. */
export default class Client {
  emitter: TypedEmitter<RendererEvents>;
  ipc: RpcClientIpc;
  id!: string;
  private readonly deferReadyRegistration: (callback: () => void) => void;
  private readonly windowHost: RpcWindowState;

  constructor(options: ClientOptions = {}) {
    const {
      ipc = resolveIpcRenderer(),
      windowHost = resolveWindowHost(),
      deferReadyRegistration = defaultDeferReadyRegistration
    } = options;
    this.emitter = new EventEmitter();
    this.ipc = ipc;
    this.windowHost = windowHost;
    this.deferReadyRegistration = deferReadyRegistration;
    this.emit = this.emit.bind(this);
    if (this.windowHost.__rpcId) {
      this.deferReadyRegistration(() => {
        const cachedRpcId = this.windowHost.__rpcId;
        if (!cachedRpcId) {
          return;
        }
        this.id = cachedRpcId;
        this.ipc.on(this.id, this.ipcListener);
        this.emitter.emit('ready');
      });
    } else {
      this.ipc.on('init', (_ev: IpcRendererEvent, uid: string, _profileName: string) => {
        // we cache so that if the object
        // gets re-instantiated we don't
        // wait for a `init` event
        this.windowHost.__rpcId = uid;
        // window.profileName = profileName;
        this.id = uid;
        this.ipc.on(uid, this.ipcListener);
        this.emitter.emit('ready');
      });
    }
  }

  private emitRendererEvent<U extends keyof RendererEvents>(ch: U, data: RendererEvents[U] | undefined) {
    if (data === undefined) {
      return this.emitter.emit(ch as Exclude<keyof RendererEvents, FilterNever<RendererEvents>>);
    }

    return this.emitter.emit(ch as FilterNever<RendererEvents>, data as RendererEvents[FilterNever<RendererEvents>]);
  }

  ipcListener = <U extends keyof RendererEvents>(
    _event: IpcRendererEvent,
    {ch, data}: {ch: U; data?: RendererEvents[U]}
  ) => this.emitRendererEvent(ch, data);

  on = <U extends keyof RendererEvents>(ev: U, fn: (arg0: RendererEvents[U]) => void) => {
    this.emitter.on(ev, fn);
    return this;
  };

  off = <U extends keyof RendererEvents>(ev: U, fn: (arg0: RendererEvents[U]) => void) => {
    return this.removeListener(ev, fn);
  };

  once = <U extends keyof RendererEvents>(ev: U, fn: (arg0: RendererEvents[U]) => void) => {
    this.emitter.once(ev, fn);
    return this;
  };

  emit<U extends Exclude<keyof MainEvents, FilterNever<MainEvents>>>(ev: U): boolean;
  emit<U extends FilterNever<MainEvents>>(ev: U, data: MainEvents[U]): boolean;
  emit<U extends keyof MainEvents>(ev: U, data?: MainEvents[U]) {
    if (!this.id) {
      throw new Error('Not ready');
    }
    this.ipc.send(this.id, {ev, data});
    return true;
  }

  removeListener = <U extends keyof RendererEvents>(ev: U, fn: (arg0: RendererEvents[U]) => void) => {
    this.emitter.removeListener(ev, fn);
    return this;
  };

  removeAllListeners = <U extends keyof RendererEvents>(event?: U) => {
    this.emitter.removeAllListeners(event);
    return this;
  };

  destroy = () => {
    this.removeAllListeners();
    if (!this.id) {
      return;
    }

    this.ipc.removeListener(this.id, this.ipcListener);
  };
}
