/**
 * @file Exposes configuration paths and runtime metadata for the app.
 *
 * Centralizes filesystem paths used across config, plugins, and CLI helpers,
 * including the resolved Bun binary used for plugin installs.
 */
import {execSync} from 'node:child_process';
import {statSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

import {app} from 'electron';

import isDev from 'electron-is-dev';

const cfgFile = 'config.json5';
const legacyCfgFile = 'hyper.json';
const defaultCfgFile = 'config-default.json';
const schemaFile = 'schema.json';
const homeDirectory = homedir();
// `app.getAppPath()` resolves to the app root: `dist/app` during development
// and in the unpacked build, and the packaged archive once shipped. Compiled
// assets sit below that root rather than beside this module, so every asset
// path is anchored to it instead of to the emitted file's directory.
const appDirectory = app.getAppPath();

// If the user defines XDG_CONFIG_HOME they definitely want their config there,
// otherwise use the home directory in linux/mac and userdata in windows
let cfgDir: string;
if (process.env.XDG_CONFIG_HOME) {
  cfgDir = path.join(process.env.XDG_CONFIG_HOME, 'Hyper');
} else if (process.platform === 'win32') {
  cfgDir = app.getPath('userData');
} else {
  cfgDir = path.join(homeDirectory, '.config', 'Hyper');
}

let cfgPath = path.join(cfgDir, cfgFile);
const legacyCfgPath = path.join(cfgDir, legacyCfgFile);
const schemaPath = path.join(appDirectory, 'config', schemaFile);

const devDir = path.resolve(appDirectory, '..');
const devCfg = path.join(devDir, cfgFile);
const devLegacyCfg = path.join(devDir, legacyCfgFile);
const defaultCfg = path.join(appDirectory, 'config', defaultCfgFile);

const fileExists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

if (!fileExists(cfgPath) && fileExists(legacyCfgPath)) {
  cfgPath = legacyCfgPath;
}

if (isDev) {
  // if a local config file exists, use it
  if (fileExists(devCfg)) {
    cfgPath = devCfg;
    cfgDir = devDir;
    console.log('using config file:', cfgPath);
  } else if (fileExists(devLegacyCfg)) {
    cfgPath = devLegacyCfg;
    cfgDir = devDir;
    console.warn(
      `using legacy config file: ${cfgPath}. Rename to "${cfgFile}" to align with JSON5 config conventions.`
    );
  }
}

const plugins = path.resolve(cfgDir, 'plugins');
const plugs = {
  base: plugins,
  local: path.resolve(plugins, 'local'),
  cache: path.resolve(plugins, 'cache')
};
/** The Bun executable name for the current platform. */
const bunExecutable = process.platform === 'win32' ? 'bun.exe' : 'bun';
/** The Bun binary bundled alongside packaged app assets. */
const bundledBun = path.resolve(appDirectory, '../bin', bunExecutable);
/** Resolved Bun binary used for plugin installs. */
const bun = (() => {
  const bunCandidate = process.env.BUN_PATH ?? bundledBun;

  try {
    statSync(bunCandidate);
    return bunCandidate;
  } catch {
    // Ignore missing bundled binary; fall back to PATH probe.
  }

  try {
    execSync(`${bunExecutable} --version`, {stdio: 'ignore'});
    return bunExecutable;
  } catch {
    console.warn('Bun binary not found. Set BUN_PATH or ensure Bun is on PATH to enable plugin installs.');
    return bunExecutable;
  }
})();
const cliScriptPath = path.resolve(appDirectory, '../bin/hyper');
const cliLinkPath = '/usr/local/bin/hyper';

const icon = path.join(appDirectory, 'static/icon96x96.png');

const keymapPath = path.join(appDirectory, 'keymaps');
const darwinKeys = path.join(keymapPath, 'darwin.json');
const win32Keys = path.join(keymapPath, 'win32.json');
const linuxKeys = path.join(keymapPath, 'linux.json');

const defaultPlatformKeyPath = () => {
  switch (process.platform) {
    case 'darwin': {
      return darwinKeys;
    }
    case 'win32': {
      return win32Keys;
    }
    case 'linux': {
      return linuxKeys;
    }
    default: {
      return darwinKeys;
    }
  }
};

export {
  cfgDir,
  cfgPath,
  cfgFile,
  defaultCfg,
  icon,
  defaultPlatformKeyPath,
  plugs,
  bun,
  cliScriptPath,
  cliLinkPath,
  homeDirectory,
  schemaFile,
  schemaPath
};
