/** @file Application command handlers and command dispatch wiring. */
/*
 * The table is built by a factory rather than at module evaluation: every side
 * effect it can perform arrives as a dependency, so a test can build a table
 * over doubles and assert exactly what a command did. The composition root,
 * `app/start.ts`, supplies the real adapters, including the marker sink the
 * entry point chose, so a launch outside the lane reports no command marker and
 * a lane launch reports them to the stream the entry point selected.
 */
import type {BrowserWindow} from 'electron';
import type {CommandId} from '@shared/types/commands';
import {createWindowNewHandler} from './commands/window-new';
import type {E2EMarkerSink} from './config/e2e-marker-sink';
import {GOLDEN_PATH_COMMAND_ID} from './runtime/golden-path-demo';
import {asProfileId} from './utils/shared-ids';

/** One handler: it runs against the window that had focus, when there was one. */
export type CommandHandler = (focusedWindow?: BrowserWindow) => void;

/**
 * The command identifiers the application answers, and the handlers behind them.
 *
 * The identifiers are assembled at runtime from the configured profile names
 * and the numbered tab commands, so no closed union can list them. The lookup
 * yields `undefined` for a command the application does not answer.
 */
export interface CommandTable {
  [command: string]: CommandHandler | undefined;
}

/** Runs one named command against the focused window when there is one. */
export type CommandDispatcher = (command: CommandId, focusedWindow?: BrowserWindow) => void;

/**
 * Everything the command table reaches outside itself.
 *
 * Each field is a single side effect or query the table would otherwise import
 * from Electron, the configuration, or the plugin runtime. Supplying them here
 * keeps the table buildable in a test process with no application around it.
 */
export type CommandDependencies = Readonly<{
  /** Opens a window; a profile name selects the profile it starts with. */
  readonly openWindow: (profileName?: string) => void;
  /** Receives every command-executed marker the table reports. */
  readonly markerSink: E2EMarkerSink;
  /** Opens the user's configuration file for editing. */
  readonly openConfig: () => void;
  /** Re-reads the installed plugin list. */
  readonly updatePlugins: () => void;
  /** Installs the command-line helper. */
  readonly installCLI: () => void;
  /** Adds the system context-menu integration. */
  readonly addSystemContextMenu: () => void;
  /** Removes the system context-menu integration. */
  readonly removeSystemContextMenu: () => void;
  /** Pops the application menu, as the Hamburger control does. */
  readonly popupApplicationMenu: () => void;
  /** The message the golden-path demo command announces. */
  readonly getGoldenPathMessage: () => string;
  /** The profiles a window or tab can be opened for. */
  readonly profileNames: readonly string[];
  /** Whether this platform shows the Hamburger menu, and whether it is enabled. */
  readonly isHamburgerMenuEnabled: () => boolean;
}>;

/**
 * Builds the command table over the dependencies the caller supplies.
 *
 * @param dependencies - The adapters each command calls; nothing is imported.
 * @returns The table, keyed by command identifier.
 *
 * @example
 * ```ts
 * const table = createCommandTable({openWindow, markerSink, ...adapters});
 * table['window:preferences']?.(); // calls `openConfig`
 * ```
 */
export const createCommandTable = (dependencies: CommandDependencies): CommandTable => {
  const {
    addSystemContextMenu,
    getGoldenPathMessage,
    installCLI,
    isHamburgerMenuEnabled,
    markerSink,
    openConfig,
    openWindow,
    popupApplicationMenu,
    profileNames,
    removeSystemContextMenu,
    updatePlugins
  } = dependencies;

  const table: CommandTable = {
    'window:new': createWindowNewHandler(() => openWindow(), markerSink),
    'tab:new': (focusedWindow) => {
      if (focusedWindow) {
        focusedWindow.rpc.emit('termgroup add req', {});
      } else {
        setTimeout(() => openWindow(), 0);
      }
    },
    'pane:splitRight': (focusedWindow) => {
      focusedWindow?.rpc.emit('split request vertical', {});
    },
    'pane:splitDown': (focusedWindow) => {
      focusedWindow?.rpc.emit('split request horizontal', {});
    },
    'pane:close': (focusedWindow) => {
      focusedWindow?.rpc.emit('termgroup close req');
    },
    'window:preferences': () => {
      openConfig();
    },
    'editor:clearBuffer': (focusedWindow) => {
      focusedWindow?.rpc.emit('session clear req');
    },
    'editor:selectAll': (focusedWindow) => {
      focusedWindow?.rpc.emit('term selectAll');
    },
    'plugins:update': () => {
      updatePlugins();
    },
    'window:reload': (focusedWindow) => {
      focusedWindow?.rpc.emit('reload');
    },
    'window:reloadFull': (focusedWindow) => {
      focusedWindow?.reload();
    },
    'window:devtools': (focusedWindow) => {
      if (!focusedWindow) {
        return;
      }
      const webContents = focusedWindow.webContents;
      if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools();
      } else {
        webContents.openDevTools({mode: 'detach'});
      }
    },
    'zoom:reset': (focusedWindow) => {
      focusedWindow?.rpc.emit('reset fontSize req');
    },
    'zoom:in': (focusedWindow) => {
      focusedWindow?.rpc.emit('increase fontSize req');
    },
    'zoom:out': (focusedWindow) => {
      focusedWindow?.rpc.emit('decrease fontSize req');
    },
    'tab:prev': (focusedWindow) => {
      focusedWindow?.rpc.emit('move left req');
    },
    'tab:next': (focusedWindow) => {
      focusedWindow?.rpc.emit('move right req');
    },
    'pane:prev': (focusedWindow) => {
      focusedWindow?.rpc.emit('prev pane req');
    },
    'pane:next': (focusedWindow) => {
      focusedWindow?.rpc.emit('next pane req');
    },
    'editor:movePreviousWord': (focusedWindow) => {
      focusedWindow?.rpc.emit('session move word left req');
    },
    'editor:moveNextWord': (focusedWindow) => {
      focusedWindow?.rpc.emit('session move word right req');
    },
    'editor:moveBeginningLine': (focusedWindow) => {
      focusedWindow?.rpc.emit('session move line beginning req');
    },
    'editor:moveEndLine': (focusedWindow) => {
      focusedWindow?.rpc.emit('session move line end req');
    },
    'editor:deletePreviousWord': (focusedWindow) => {
      focusedWindow?.rpc.emit('session del word left req');
    },
    'editor:deleteNextWord': (focusedWindow) => {
      focusedWindow?.rpc.emit('session del word right req');
    },
    'editor:deleteBeginningLine': (focusedWindow) => {
      focusedWindow?.rpc.emit('session del line beginning req');
    },
    'editor:deleteEndLine': (focusedWindow) => {
      focusedWindow?.rpc.emit('session del line end req');
    },
    'editor:break': (focusedWindow) => {
      focusedWindow?.rpc.emit('session break req');
    },
    'editor:stop': (focusedWindow) => {
      focusedWindow?.rpc.emit('session stop req');
    },
    'editor:quit': (focusedWindow) => {
      focusedWindow?.rpc.emit('session quit req');
    },
    'editor:tmux': (focusedWindow) => {
      focusedWindow?.rpc.emit('session tmux req');
    },
    'editor:search': (focusedWindow) => {
      focusedWindow?.rpc.emit('session search');
    },
    'editor:search-close': (focusedWindow) => {
      focusedWindow?.rpc.emit('session search close');
    },
    'cli:install': () => {
      installCLI();
    },
    'window:hamburgerMenu': () => {
      if (isHamburgerMenuEnabled()) {
        popupApplicationMenu();
      }
    },
    'systemContextMenu:add': () => {
      addSystemContextMenu();
    },
    'systemContextMenu:remove': () => {
      removeSystemContextMenu();
    },
    'window:toggleKeepOnTop': (focusedWindow) => {
      focusedWindow?.setAlwaysOnTop(!focusedWindow.isAlwaysOnTop());
    },
    [GOLDEN_PATH_COMMAND_ID]: (focusedWindow) => {
      if (!focusedWindow) {
        return;
      }

      focusedWindow.rpc.emit('add notification', {
        text: getGoldenPathMessage(),
        url: '',
        dismissable: true
      });
    }
  };

  // Special numeric command
  for (const cmdIndex of [1, 2, 3, 4, 5, 6, 7, 8, 'last'] as const) {
    const index = cmdIndex === 'last' ? cmdIndex : cmdIndex - 1;
    table[`tab:jump:${cmdIndex}`] = (focusedWindow) => {
      focusedWindow?.rpc.emit('move jump req', index);
    };
  }

  // Profile specific commands
  for (const profileName of profileNames) {
    table[`window:new:${profileName}`] = () => {
      setTimeout(() => openWindow(profileName), 0);
    };
    table[`tab:new:${profileName}`] = (focusedWindow) => {
      focusedWindow?.rpc.emit('termgroup add req', {profile: asProfileId(profileName)});
    };
    table[`pane:splitRight:${profileName}`] = (focusedWindow) => {
      focusedWindow?.rpc.emit('split request vertical', {profile: asProfileId(profileName)});
    };
    table[`pane:splitDown:${profileName}`] = (focusedWindow) => {
      focusedWindow?.rpc.emit('split request horizontal', {profile: asProfileId(profileName)});
    };
  }

  return table;
};

/**
 * Builds the dispatcher the menus, the context menu, and the RPC server call.
 *
 * @param table - The command table to dispatch into.
 * @returns A dispatcher that ignores a command the table does not define.
 *
 * @example
 * ```ts
 * const execCommand = createCommandDispatcher(table);
 * execCommand(asCommandId('tab:new'), focusedWindow);
 * ```
 */
export const createCommandDispatcher =
  (table: CommandTable): CommandDispatcher =>
  (command: CommandId, focusedWindow?: BrowserWindow): void => {
    table[command]?.(focusedWindow);
  };
