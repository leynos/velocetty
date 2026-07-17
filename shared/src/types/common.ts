/** @file Shared process, IPC, and typed event contracts used across packages. */
import type {ExecFileOptions, ExecOptions} from 'node:child_process';

import type {IpcMain, IpcRenderer} from 'electron';

import type parseUrl from 'parse-url';

import type {CommandDefinition, CommandId} from './commands';
import type {configOptions} from './config';

/** Branded identifier for session entities. */
export type SessionId = string & {
  /** Phantom brand distinguishing a session id from a plain string; absent at runtime. */
  readonly brand: 'SessionId';
};
/** Branded identifier for terminal profile names. */
export type ProfileId = string & {
  /** Phantom brand distinguishing a profile id from a plain string; absent at runtime. */
  readonly brand: 'ProfileId';
};
/** Branded identifier for terminal group entities. */
export type TermGroupId = string & {
  /** Phantom brand distinguishing a terminal-group id from a plain string; absent at runtime. */
  readonly brand: 'TermGroupId';
};
/** Branded identifier for renderer telemetry subjects. */
export type RendererUid = string & {
  /** Phantom brand distinguishing a renderer uid from a plain string; absent at runtime. */
  readonly brand: 'RendererUid';
};
/** Renderer backends supported by runtime telemetry reporting. */
export type RendererType = 'WebGL' | 'Canvas' | 'DOM';

/** Casts a raw session identifier into the shared branded type. */
export const asSessionId = (value: string): SessionId => value as SessionId;
/** Casts a raw profile name into the shared branded type. */
export const asProfileId = (value: string): ProfileId => value as ProfileId;
/** Casts a raw terminal-group identifier into the shared branded type. */
export const asTermGroupId = (value: string): TermGroupId => value as TermGroupId;
/** Casts a raw renderer identifier into the shared branded type. */
export const asRendererUid = (uid: string): RendererUid => uid as RendererUid;

/** Session state synchronized between backend and renderer layers. */
export type Session = {
  /** Identifier used to route IPC events and commands to this session. */
  uid: SessionId;
  /** Terminal row count as last reported by the renderer, or unknown. */
  rows?: number | null;
  /** Terminal column count as last reported by the renderer, or unknown. */
  cols?: number | null;
  /** Pane split orientation, if this session was created as a split. */
  splitDirection?: 'HORIZONTAL' | 'VERTICAL';
  /** Resolved shell binary path, or `null` before the process has spawned. */
  shell: string | null;
  /** OS process id of the shell, or `null` before the process has spawned. */
  pid: number | null;
  /** Sibling session that was active when this one was created via split. */
  activeUid?: SessionId;
  /** Terminal profile this session was launched from. */
  profile: ProfileId;
};

/** Optional arguments accepted when creating or splitting sessions. */
export type sessionExtraOptions = {
  /** Working directory to spawn the shell in, overriding the profile default. */
  cwd?: string;
  /** Orientation to split the pane in, when creating a split rather than a fresh tab. */
  splitDirection?: 'HORIZONTAL' | 'VERTICAL';
  /** Session the new one is being split from, used to size and position the pane. */
  activeUid?: SessionId | null;
  /** Whether this session should start a new terminal group (tab) rather than join one. */
  isNewGroup?: boolean;
  /** Initial terminal row count. */
  rows?: number;
  /** Initial terminal column count. */
  cols?: number;
  /** Shell binary to launch, overriding the profile default. */
  shell?: string;
  /** Arguments passed to the shell binary, overriding the profile default. */
  shellArgs?: string[];
  /** Terminal profile to launch the session from. */
  profile?: ProfileId;
};

/** Structured fallback reasons emitted alongside renderer-type transitions. */
export type RendererFallbackReason = 'context-loss' | 'pool-evicted' | 'webgl-init-failed';

/** Rolling latency summary used by runtime diagnostics ingestion. */
export type RuntimeLatencyMetrics = {
  /** Number of latency samples aggregated into this window. */
  sampleCount: number;
  /** Sum of all sampled latencies, used to derive an average. */
  totalMs: number;
  /** Largest latency observed in this window. */
  maxMs: number;
  /** Most recently observed latency. */
  lastMs: number;
};

/** Rolling frame-timing summary used by runtime diagnostics ingestion. */
export type RuntimeFrameTimingMetrics = {
  /** Number of frame samples aggregated into this window. */
  sampleCount: number;
  /** Sum of all sampled frame durations, used to derive an average. */
  totalMs: number;
  /** Longest frame duration observed in this window. */
  maxMs: number;
  /** Most recently observed frame duration. */
  lastMs: number;
  /** Count of frames that exceeded longFrameThresholdMs, indicating jank. */
  longFrameCount: number;
  /** Duration above which a frame is counted as "long" (janky). */
  longFrameThresholdMs: number;
};

/** Runtime metrics emitted from renderer and aggregated in the main process. */
export type RendererRuntimeMetrics = {
  /** Latency from keydown to the data being sent over IPC, used to spot input lag. */
  inputKeydownToSend: RuntimeLatencyMetrics;
  /** Rolling render-loop frame-timing statistics for this renderer. */
  frameTiming: RuntimeFrameTimingMetrics;
  /** How often, in milliseconds, this snapshot is reported to the main process. */
  reportIntervalMs: number;
  /** Timestamp at which this snapshot was last refreshed. */
  updatedAtMs: number;
};

/** Events emitted from the renderer and consumed by the privileged process. */
export type MainEvents = {
  /** Renderer window is being closed. */
  close: never;
  /** A registered frontend command is being invoked in the main process. */
  command: CommandId;
  /** Keystroke or pasted text to forward to the shell process. */
  data: {
    /** Target session, or `null` if no session is focused yet. */
    uid: SessionId | null;
    /** Raw bytes/text to write to the pty. */
    data: string;
    /** Whether `data` has already been shell-escaped by the renderer. */
    escaped?: boolean;
    /** Timestamp the keystroke was captured, used for input-latency metrics. */
    inputSentAtMs?: number;
  };
  /** A session's shell process has terminated. */
  exit: {
    /** Session whose process exited. */
    uid: SessionId;
  };
  /** Renderer reporting its render backend and runtime health for diagnostics. */
  'info renderer': {
    /** Renderer session this report describes. */
    uid: SessionId;
    /** Rendering backend currently in use. */
    type: RendererType;
    /** Reason the renderer fell back to this backend, if it did. */
    reason?: RendererFallbackReason;
    /** Latest runtime performance snapshot from the renderer. */
    runtimeMetrics?: RendererRuntimeMetrics;
  };
  /** Renderer has finished bootstrapping and is ready for session setup. */
  init: null;
  /** Window maximize was requested. */
  maximize: never;
  /** Window minimize was requested. */
  minimize: never;
  /** A new terminal session is being created with the given options. */
  new: sessionExtraOptions;
  /** Context-menu label selected by the user in the renderer. */
  'open context menu': string;
  /** A link should be opened in the user's default browser. */
  'open external': {
    /** URL to open externally. */
    url: string;
  };
  /** Hamburger menu was requested at the given window-relative coordinates. */
  'open hamburger menu': {
    /** Horizontal position, in pixels, to anchor the menu at. */
    x: number;
    /** Vertical position, in pixels, to anchor the menu at. */
    y: number;
  };
  /** User accepted an available update; install and relaunch. */
  'quit and install': never;
  /** Terminal dimensions changed and the pty should be resized to match. */
  resize: {
    /** Session whose pty should be resized. */
    uid: SessionId;
    /** New column count. */
    cols: number;
    /** New row count. */
    rows: number;
  };
  /** Window unmaximize was requested. */
  unmaximize: never;
};

/** Events emitted from the privileged process and consumed by the renderer. */
export type RendererEvents = {
  /** Main process has finished initializing and the renderer may proceed. */
  ready: never;
  /** A toast notification should be shown to the user. */
  'add notification': {
    /** Notification body text. */
    text: string;
    /** Optional link opened when the notification is clicked. */
    url: string | null;
    /** Whether the user can dismiss the notification without acting on it. */
    dismissable: boolean;
  };
  /** An application update has been downloaded and can be installed. */
  'update available': {
    /** Changelog text for the new release. */
    releaseNotes: string;
    /** Human-readable name of the new release. */
    releaseName: string;
    /** Location of the release, shown as a link. */
    releaseUrl: string;
    /** Whether the update can be installed immediately from this state. */
    canInstall: boolean;
  };
  /** An `ssh://` link was opened and should be handled by the SSH launcher. */
  'open ssh': ReturnType<typeof parseUrl>;
  /** A local file should be opened (e.g. dropped onto the window). */
  'open file': {
    /** Filesystem path of the file to open. */
    path: string;
  };
  /** Scroll to a specific line, or `'last'` to jump to the bottom. */
  'move jump req': number | 'last';
  /** Reset terminal font size to its configured default. */
  'reset fontSize req': never;
  /** Move focus to the pane on the left. */
  'move left req': never;
  /** Move focus to the pane on the right. */
  'move right req': never;
  /** Move focus to the previous pane in tab order. */
  'prev pane req': never;
  /** Decrease terminal font size by one step. */
  'decrease fontSize req': never;
  /** Increase terminal font size by one step. */
  'increase fontSize req': never;
  /** Move focus to the next pane in tab order. */
  'next pane req': never;
  /** Send a break signal to the active session's shell. */
  'session break req': never;
  /** Close the active session. */
  'session quit req': never;
  /** Close the in-terminal search bar. */
  'session search close': never;
  /** Open the in-terminal search bar. */
  'session search': never;
  /** Interrupt (Ctrl-C style) the active session. */
  'session stop req': never;
  /** Toggle tmux mode for the active session. */
  'session tmux req': never;
  /** Delete from the cursor to the beginning of the line. */
  'session del line beginning req': never;
  /** Delete from the cursor to the end of the line. */
  'session del line end req': never;
  /** Delete the word to the left of the cursor. */
  'session del word left req': never;
  /** Delete the word to the right of the cursor. */
  'session del word right req': never;
  /** Move the cursor to the beginning of the line. */
  'session move line beginning req': never;
  /** Move the cursor to the end of the line. */
  'session move line end req': never;
  /** Move the cursor one word to the left. */
  'session move word left req': never;
  /** Move the cursor one word to the right. */
  'session move word right req': never;
  /** Select all terminal buffer content. */
  'term selectAll': never;
  /** Reload the renderer window. */
  reload: never;
  /** Clear the active session's scrollback and screen. */
  'session clear req': never;
  /** Split the active pane horizontally, optionally seeding a session/profile. */
  'split request horizontal': {
    /** Session the split is created relative to. */
    activeUid?: SessionId;
    /** Profile to launch the new pane with, overriding the default. */
    profile?: ProfileId;
  };
  /** Split the active pane vertically, optionally seeding a session/profile. */
  'split request vertical': {
    /** Session the split is created relative to. */
    activeUid?: SessionId;
    /** Profile to launch the new pane with, overriding the default. */
    profile?: ProfileId;
  };
  /** Open a new tab (terminal group), optionally seeding a session/profile. */
  'termgroup add req': {
    /** Session the new tab is created relative to. */
    activeUid?: SessionId;
    /** Profile to launch the new tab with, overriding the default. */
    profile?: ProfileId;
  };
  /** Close the active tab (terminal group). */
  'termgroup close req': never;
  /** A new session was created in the main process and should be mirrored in the UI. */
  'session add': Session;
  /** Shell output to render into the terminal buffer. */
  'session data': string;
  /** A session's shell process has terminated. */
  'session exit': {
    /** Session whose process exited. */
    uid: SessionId;
  };
  /** The window's maximized state changed. */
  'windowGeometry change': {
    /** Whether the window is currently maximized. */
    isMaximized: boolean;
  };
  /** The window was moved to a new position. */
  move: {
    /** New window bounds' origin. */
    bounds: {
      /** New horizontal window position, in pixels. */
      x: number;
      /** New vertical window position, in pixels. */
      y: number;
    };
  };
  /** The window entered full-screen mode. */
  'enter full screen': never;
  /** The window left full-screen mode. */
  'leave full screen': never;
  /** Keystroke or pasted text to write into a session, sent from the renderer. */
  'session data send': {
    /** Target session, or `null` if no session is focused yet. */
    uid: SessionId | null;
    /** Raw bytes/text to write to the pty. */
    data: string;
    /** Whether `data` has already been shell-escaped by the renderer. */
    escaped?: boolean;
  };
};

/** Get keys of T where the value is not never. */
export type FilterNever<T> = {[K in keyof T]: T[K] extends never ? never : K}[keyof T];

/** Minimal typed emitter contract shared by frontend and backend event bridges. */
export interface TypedEmitter<Events> {
  /** Registers a listener for an event, invoked on every occurrence. */
  on<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this;
  /** Registers a listener for an event that fires at most once, then auto-removes. */
  once<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this;
  /** Emits a payload-less event. */
  emit<E extends Exclude<keyof Events, FilterNever<Events>>>(event: E): boolean;
  /** Emits an event with its associated payload. */
  emit<E extends FilterNever<Events>>(event: E, data: Events[E]): boolean;
  /** Removes a single previously registered listener for an event. */
  removeListener<E extends keyof Events>(event: E, listener: (args: Events[E]) => void): this;
  /** Removes all listeners for an event, or every listener if no event is given. */
  removeAllListeners<E extends keyof Events>(event?: E): this;
}

type OptionalPromise<T> = T | Promise<T>;

/** IPC command signatures available over Electron invoke handlers. */
export type IpcCommands = {
  /** Runs a shell command via `child_process.exec` from the main process. */
  'child_process.exec': (
    command: string,
    options: ExecOptions
  ) => {
    /** Captured standard output. */
    stdout: string | Buffer;
    /** Captured standard error. */
    stderr: string | Buffer;
  };
  /** Runs a binary via `child_process.execFile` from the main process. */
  'child_process.execFile': (
    file: string,
    args: string[],
    options: ExecFileOptions
  ) => {
    /** Captured standard output. */
    stdout: string | Buffer;
    /** Captured standard error. */
    stderr: string | Buffer;
  };
  /** Lists plugins currently loaded, with their installed versions. */
  getLoadedPluginVersions: () => {
    /** Plugin package name. */
    name: string;
    /** Installed plugin version. */
    version: string;
  }[];
  /** Resolves the plugin and local-plugin directories in use. */
  getPaths: () => {
    /** Installed (npm) plugin directories. */
    plugins: string[];
    /** Local, non-npm plugin directories. */
    localPlugins: string[];
  };
  /** Resolves the base config directory and its local-override counterpart. */
  getBasePaths: () => {
    /** Base configuration directory path. */
    path: string;
    /** Local (override) configuration directory path. */
    localPath: string;
  };
  /** Returns config keys deprecated in favour of CSS, keyed by the deprecated option. */
  getDeprecatedConfig: () => Record<
    string,
    {
      /** CSS replacement rules for the deprecated option. */
      css: string[];
    }
  >;
  /** Resolves the fully merged configuration for a given profile. */
  getDecoratedConfig: (profile: string) => configOptions;
  /** Resolves keymap bindings decorated with their resolved key combinations. */
  getDecoratedKeymaps: () => Record<string, string[]>;
  /** Lists commands contributed by plugins loaded at runtime. */
  getRuntimePluginCommands: () => CommandDefinition[];
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
