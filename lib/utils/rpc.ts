/**
 * @file RPC client for renderer-to-main IPC messaging.
 * Manages event subscription lifecycle and emits typed commands for the
 * renderer process.
 */
import {EventEmitter} from 'node:events';

import type {IpcRendererEvent} from 'electron';
import type {IpcRendererWithCommands, MainEvents, RendererEvents, TypedEmitter} from '@shared/types/common';

export type RpcClientIpc = Pick<IpcRendererWithCommands, 'on' | 'removeListener' | 'send'>;

type RpcWindowState = {
  __rpcId?: string;
};

type RuntimeGlobalScope = Omit<typeof globalThis, 'window'> & {window?: Window};

type ClientOptions = {
  deferReadyRegistration?: (callback: () => void) => void;
  ipc?: RpcClientIpc;
  windowHost?: RpcWindowState;
};

type InitListener = (event: Electron.IpcRendererEvent, uid: string, profileName: string) => void;

// SAFETY: Renderer modules are also imported in Node tests, where `window` is absent.
const runtimeGlobal = globalThis as RuntimeGlobalScope;
const globalRpcWindowState: RpcWindowState = runtimeGlobal.window ?? {};

const defaultDeferReadyRegistration = (callback: () => void) => {
  setTimeout(callback, 0);
};
const isRuntimeRequire = (candidate: unknown): candidate is NodeJS.Require => typeof candidate === 'function';
const resolveIpcRenderer = (): RpcClientIpc => {
  const rendererRequire = runtimeGlobal.window?.require;
  if (!isRuntimeRequire(rendererRequire)) {
    throw new TypeError('Electron ipcRenderer is unavailable');
  }

  return rendererRequire('electron').ipcRenderer;
};

/** Renderer-side RPC client that forwards typed events over IPC. */
export default class Client {
  emitter: TypedEmitter<RendererEvents>;
  private readonly rawEmitter: EventEmitter;
  ipc: RpcClientIpc;
  id!: string;
  private initListener?: InitListener;

  constructor(options: ClientOptions = {}) {
    const {
      ipc = resolveIpcRenderer(),
      windowHost = globalRpcWindowState,
      deferReadyRegistration = defaultDeferReadyRegistration
    } = options;
    // eslint-disable-next-line unicorn/prefer-event-target -- `TypedEmitter` exposes EventEmitter's typed `on`, `once`, and removal contract.
    this.rawEmitter = new EventEmitter();
    this.emitter = this.rawEmitter;
    this.ipc = ipc;
    this.emit = this.emit.bind(this);
    if (windowHost.__rpcId) {
      deferReadyRegistration(() => {
        const cachedRpcId = windowHost.__rpcId;
        if (!cachedRpcId) {
          return;
        }
        this.id = cachedRpcId;
        this.ipc.on(this.id, this.ipcListener);
        this.rawEmitter.emit('ready');
      });
    } else {
      this.initListener = (_ev: IpcRendererEvent, uid: string, _profileName: string) => {
        this.detachInitListener();
        // we cache so that if the object
        // gets re-instantiated we don't
        // wait for a `init` event
        windowHost.__rpcId = uid;
        // window.profileName = profileName;
        this.id = uid;
        this.ipc.on(uid, this.ipcListener);
        this.rawEmitter.emit('ready');
      };
      this.ipc.on('init', this.initListener);
    }
  }

  private detachInitListener() {
    if (!this.initListener) {
      return;
    }

    this.ipc.removeListener('init', this.initListener);
    this.initListener = undefined;
  }

  private emitRendererEvent<U extends keyof RendererEvents>(ch: U, data: RendererEvents[U] | undefined) {
    if (data === undefined) {
      return this.rawEmitter.emit(ch);
    }

    return this.rawEmitter.emit(ch, data);
  }

  ipcListener = <U extends keyof RendererEvents>(
    _event: Electron.IpcRendererEvent,
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

  emit<U extends keyof MainEvents>(
    ev: U,
    ...payload: [MainEvents[U]] extends [never] ? [] : [data: MainEvents[U]]
  ): boolean {
    if (!this.id) {
      throw new Error('Not ready');
    }
    this.ipc.send(this.id, {ev, data: payload[0]});
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
    this.detachInitListener();
    if (!this.id) {
      return;
    }

    this.ipc.removeListener(this.id, this.ipcListener);
  };
}
