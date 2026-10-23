/** @file Starts the Electron main process after command-line diagnostics. */
import {createRequire} from 'node:module';
import path from 'node:path';

import {initialize as remoteInitialize} from '@electron/remote/main';
import {app, BrowserWindow, Menu, screen, session} from 'electron';
import isDev from 'electron-is-dev';
import {gitDescribe} from 'git-describe';
import parseUrl from 'parse-url';
import {isString} from './utils/runtime-guards';
import type {VelocettyRuntimeGlobals} from '../typings/runtime-globals';

import * as config from './config';
import * as AppMenu from './menus/menu';
import * as plugins from './plugins';
import {newWindow} from './ui/window';
import {installCLI} from './utils/cli-install';
import {configureGpuMode} from './utils/configure-gpu';
import * as windowUtils from './utils/window-utils';

remoteInitialize();

// Configuration is already initialized by the entry point, `index.mts`, which
// runs `config.setup()` before importing this module. It cannot be done here:
// the import above of `./plugins` evaluates that module's body, and its body
// reads the plugin lists from the configuration. `remoteInitialize()` stays
// ahead of it because it registers the remote module before any window loads.

import {registerClipboardIpcHandlers} from './clipboard';

const windowSet = new Set<BrowserWindow>();
type VelocettyRuntimeGlobal = typeof globalThis & VelocettyRuntimeGlobals;

// Expose app root so renderer remote module lookups can resolve app-side
// modules without depending on renderer bundle location.
// SAFETY: This global is extended by `VelocettyRuntimeGlobals` for the Electron main process.
(globalThis as VelocettyRuntimeGlobal).__velocettyAppRoot = app.getAppPath();

// Register before any window loads so renderers can paste from first paint.
registerClipboardIpcHandlers();

// expose to plugins
app.config = config;
app.plugins = plugins;
app.getWindows = () => new Set(windowSet); // return a clone

// function to retrieve the last focused window in windowSet;
// added to app object in order to expose it to plugins.
app.getLastFocusedWindow = () => {
  if (windowSet.size === 0) {
    return null;
  }
  const firstWindow = windowSet.values().next().value;
  if (!firstWindow) {
    return null;
  }
  let lastWindow = firstWindow;
  for (const win of windowSet) {
    if (win.focusTime > lastWindow.focusTime) {
      lastWindow = win;
    }
  }
  return lastWindow;
};

configureGpuMode(app);

if (isDev) {
  console.log('running in dev mode');

  // Override default appVersion which is set from package.json
  gitDescribe({customArguments: ['--tags']}, (error: any, gitInfo: {raw: string}) => {
    if (!error) {
      app.setVersion(gitInfo.raw);
    }
  });
} else {
  console.log('running in prod mode');
}

const url = `file://${path.resolve(app.getAppPath(), 'index.html')}`;
console.log('electron will open', url);

async function installDevExtensions(isDev_: boolean) {
  if (!isDev_) {
    return [];
  }
  const {REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS} = await import('electron-devtools-installer');
  // electron-devtools-installer 3.x does not re-export this helper from its
  // public API, so it is reached through the package's `dist` subpath. That
  // package is CommonJS and its `.d.ts` describes the shape `require()` returns,
  // but `module: NodeNext` preserves a real dynamic `import()` in the emitted
  // CommonJS, which Node routes through the ESM loader and so nests the callable
  // one level deeper under `default.default`. Loading it with `createRequire`,
  // as this app does for its other CommonJS-only dependencies, keeps the
  // declared and actual shapes in agreement.
  const downloadChromeExtension: typeof import('electron-devtools-installer/dist/downloadChromeExtension.js')['default'] =
    createRequire(path.resolve(app.getAppPath(), 'start.js'))(
      'electron-devtools-installer/dist/downloadChromeExtension.js'
    ).default;

  const extensions = [REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS];
  const forceDownload = Boolean(process.env.UPGRADE_EXTENSIONS);

  const results = await Promise.allSettled(
    extensions.map(async (extensionReference) => {
      const extensionId = isString(extensionReference) ? extensionReference : extensionReference.id;
      const extensionFolder = await downloadChromeExtension(extensionId, forceDownload);
      const installedExtension = session.defaultSession.extensions.getExtension(extensionId);
      if (installedExtension) {
        session.defaultSession.extensions.removeExtension(extensionId);
      }
      const loadedExtension = await session.defaultSession.extensions.loadExtension(extensionFolder, {
        allowFileAccess: true
      });
      return loadedExtension.name;
    })
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      // DevTools installs can fail on Linux arm64; don't block the app from opening.
      console.warn('DevTools extension install failed:', result.reason);
    }
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.on('ready', () =>
  installDevExtensions(isDev)
    .then(() => {
      function createWindow(
        fn?: (win: BrowserWindow) => void,
        options: {size?: [number, number]; position?: [number, number]} = {},
        profileName: string = config.getDefaultProfile()
      ) {
        const cfg = plugins.getDecoratedConfig(profileName);

        const winSet = config.getWin();
        let [startX, startY] = winSet.position;

        const [width, height] = options.size ?? cfg.windowSize ?? winSet.size;

        const winPos = options.position;

        // Open the new window roughly the height of the header away from the
        // previous window. This also ensures in multi monitor setups that the
        // new terminal is on the correct screen.
        const focusedWindow = BrowserWindow.getFocusedWindow() || app.getLastFocusedWindow();
        // In case of options defaults position and size, we should ignore the focusedWindow.
        if (winPos !== undefined) {
          [startX, startY] = winPos;
        } else if (focusedWindow) {
          const points = focusedWindow.getPosition();
          const currentScreen = screen.getDisplayNearestPoint({
            x: points[0],
            y: points[1]
          });

          const biggestX = points[0] + 100 + width - currentScreen.bounds.x;
          const biggestY = points[1] + 100 + height - currentScreen.bounds.y;

          startX = biggestX > currentScreen.size.width ? 50 : points[0] + 34;
          startY = biggestY > currentScreen.size.height ? 50 : points[1] + 34;
        }

        if (!windowUtils.positionIsValid([startX, startY])) {
          [startX, startY] = config.windowDefaults.windowPosition;
        }

        const hwin = newWindow({width, height, x: startX, y: startY}, cfg, fn, profileName);
        windowSet.add(hwin);
        void hwin.loadURL(url);

        // the window can be closed by the browser process itself
        hwin.on('close', () => {
          hwin.clean();
          windowSet.delete(hwin);
        });

        return hwin;
      }

      // when opening create a new window
      createWindow();

      // expose to plugins
      app.createWindow = createWindow;

      // mac only. when the dock icon is clicked
      // and we don't have any active windows open,
      // we open one
      app.on('activate', () => {
        if (windowSet.size === 0) {
          createWindow();
        }
      });

      app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
          app.quit();
        }
      });

      const makeMenu = () => {
        const menu = plugins.decorateMenu(AppMenu.createMenu(plugins.getLoadedPluginVersions));

        // If we're on Mac make a Dock Menu
        if (process.platform === 'darwin' && app.dock) {
          const dockMenu = Menu.buildFromTemplate([
            {
              label: 'New Window',
              click() {
                createWindow();
              }
            }
          ]);
          app.dock.setMenu(dockMenu);
        }

        Menu.setApplicationMenu(AppMenu.buildMenu(menu));
      };

      plugins.onApp(app);
      makeMenu();
      plugins.subscribe(plugins.onApp.bind(undefined, app));
      config.subscribe(makeMenu);
      if (!isDev) {
        // check if should be set/removed as default ssh protocol client
        if (config.getConfig().defaultSSHApp && !app.isDefaultProtocolClient('ssh')) {
          console.log('Setting Hyper as default client for ssh:// protocol');
          app.setAsDefaultProtocolClient('ssh');
        } else if (!config.getConfig().defaultSSHApp && app.isDefaultProtocolClient('ssh')) {
          console.log('Removing Hyper from default client for ssh:// protocol');
          app.removeAsDefaultProtocolClient('ssh');
        }
        void installCLI(false);
      }
    })
    .catch((error) => {
      console.error('Error while loading devtools extensions', error);
    })
);

/**
 * Get last focused BrowserWindow or create new if none and callback
 * @param callback Function to call with the BrowserWindow
 */
function GetWindow(callback: (win: BrowserWindow) => void) {
  const lastWindow = app.getLastFocusedWindow();
  if (lastWindow) {
    callback(lastWindow);
  } else if (Object.hasOwn(app, 'createWindow')) {
    app.createWindow(callback);
  } else {
    // If createWindow doesn't exist yet ('ready' event was not fired),
    // sets his callback to an app.windowCallback property.
    app.windowCallback = callback;
  }
}

app.on('open-file', (_event, path) => {
  GetWindow((win: BrowserWindow) => {
    win.rpc.emit('open file', {path});
  });
});

app.on('open-url', (_event, sshUrl) => {
  GetWindow((win: BrowserWindow) => {
    win.rpc.emit('open ssh', parseUrl(sshUrl));
  });
});
