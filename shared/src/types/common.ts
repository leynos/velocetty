/** @file Shared process, IPC, and typed event contracts used across packages. */
import type {ExecFileOptions, ExecOptions} from 'node:child_process';

import type {IpcMain, IpcRenderer} from 'electron';

import type parseUrl from 'parse-url';

import type {CommandId} from './commands';
import type {configOptions} from './config';

/** Branded identifier for session entities. */
export type SessionId = string & {readonly brand: 'SessionId'};
/** Branded identifier for terminal profile names. */
export type ProfileId = string & {readonly brand: 'ProfileId'};
/** Branded identifier for terminal group entities. */
export type TermGroupId = string & {readonly brand: 'TermGroupId'};

/** Casts a raw session identifier into the shared branded type. */
export const asSessionId = (value: string): SessionId => value as SessionId;
/** Casts a raw profile name into the shared branded type. */
export const asProfileId = (value: string): ProfileId => value as ProfileId;
/** Casts a raw terminal-group identifier into the shared branded type. */
export const asTermGroupId = (value: string): TermGroupId => value as TermGroupId;

/** Session state synchronized between backend and renderer layers. */
export type Session = {
  uid: SessionId;
  rows?: number | null;
  cols?: number | null;
  splitDirection?: 'HORIZONTAL' | 'VERTICAL';
  shell: string | null;
  pid: number | null;
  activeUid?: SessionId;
  profile: ProfileId;
};

/** Optional arguments accepted when creating or splitting sessions. */
export type sessionExtraOptions = {
  cwd?: string;
  splitDirection?: 'HORIZONTAL' | 'VERTICAL';
  activeUid?: SessionId | null;
  isNewGroup?: boolean;
  rows?: number;
  cols?: number;
  shell?: string;
  shellArgs?: string[];
  profile?: ProfileId;
};

/** Events emitted from the renderer and consumed by the privileged process. */
export type MainEvents = {
  close: never;
  command: CommandId;
  data: {uid: SessionId | null; data: string; escaped?: boolean};
  exit: {uid: SessionId};
  'info renderer': {uid: SessionId; type: string};
  init: null;
  maximize: never;
  minimize: never;
  new: sessionExtraOptions;
  'open context menu': string;
  'open external': {url: string};
  'open hamburger menu': {x: number; y: number};
  'quit and install': never;
  resize: {uid: SessionId; cols: number; rows: number};
  unmaximize: never;
};

/** Events emitted from the privileged process and consumed by the renderer. */
export type RendererEvents = {
  ready: never;
  'add notification': {text: string; url: string; dismissable: boolean};
  'update available': {releaseNotes: string; releaseName: string; releaseUrl: string; canInstall: boolean};
  'open ssh': ReturnType<typeof parseUrl>;
  'open file': {path: string};
  'move jump req': number | 'last';
  'reset fontSize req': never;
  'move left req': never;
  'move right req': never;
  'prev pane req': never;
  'decrease fontSize req': never;
  'increase fontSize req': never;
  'next pane req': never;
  'session break req': never;
  'session quit req': never;
  'session search close': never;
  'session search': never;
  'session stop req': never;
  'session tmux req': never;
  'session del line beginning req': never;
  'session del line end req': never;
  'session del word left req': never;
  'session del word right req': never;
  'session move line beginning req': never;
  'session move line end req': never;
  'session move word left req': never;
  'session move word right req': never;
  'term selectAll': never;
  reload: never;
  'session clear req': never;
  'split request horizontal': {activeUid?: SessionId; profile?: ProfileId};
  'split request vertical': {activeUid?: SessionId; profile?: ProfileId};
  'termgroup add req': {activeUid?: SessionId; profile?: ProfileId};
  'termgroup close req': never;
  'session add': Session;
  'session data': string;
  'session exit': {uid: SessionId};
  'windowGeometry change': {isMaximized: boolean};
  move: {bounds: {x: number; y: number}};
  'enter full screen': never;
  'leave full screen': never;
  'session data send': {uid: SessionId | null; data: string; escaped?: boolean};
};

/** Get keys of T where the value is not never. */
export type FilterNever<T> = {[K in keyof T]: T[K] extends never ? never : K}[keyof T];

/** Minimal typed emitter contract shared by frontend and backend event bridges. */
export interface TypedEmitter<Events> {
  on<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this;
  once<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this;
  emit<E extends Exclude<keyof Events, FilterNever<Events>>>(event: E): boolean;
  emit<E extends FilterNever<Events>>(event: E, data: Events[E]): boolean;
  removeListener<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this;
  removeAllListeners<E extends keyof Events>(event?: E): this;
}

type OptionalPromise<T> = T | Promise<T>;

/** IPC command signatures available over Electron invoke handlers. */
export type IpcCommands = {
  'child_process.exec': (command: string, options: ExecOptions) => {stdout: string | Buffer; stderr: string | Buffer};
  'child_process.execFile': (
    file: string,
    args: string[],
    options: ExecFileOptions
  ) => {
    stdout: string | Buffer;
    stderr: string | Buffer;
  };
  getLoadedPluginVersions: () => {name: string; version: string}[];
  getPaths: () => {plugins: string[]; localPlugins: string[]};
  getBasePaths: () => {path: string; localPath: string};
  getDeprecatedConfig: () => Record<string, {css: string[]}>;
  getDecoratedConfig: (profile: string) => configOptions;
  getDecoratedKeymaps: () => Record<string, string[]>;
};

/** Type-safe wrapper around Electron IpcMain.handle for shared command contracts. */
export interface IpcMainWithCommands extends IpcMain {
  handle<E extends keyof IpcCommands>(
    channel: E,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: Parameters<IpcCommands[E]>
    ) => OptionalPromise<ReturnType<IpcCommands[E]>>
  ): void;
}

/** Type-safe wrapper around Electron IpcRenderer.invoke for shared command contracts. */
export interface IpcRendererWithCommands extends IpcRenderer {
  invoke<E extends keyof IpcCommands>(
    channel: E,
    ...args: Parameters<IpcCommands[E]>
  ): Promise<ReturnType<IpcCommands[E]>>;
}
