/**
 * @file Exposes configuration paths and runtime metadata for the app.
 *
 * Centralizes filesystem paths used across config, plugins, and CLI helpers,
 * including the resolved Bun binary used for plugin installs.
 */
import {execSync} from 'node:child_process';
import {lstatSync, realpathSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

import {app} from 'electron';

import isDev from 'electron-is-dev';

import {resolveConfigLocations} from './config-tree';

const cfgFile = 'config.json5';
const keybindingsFile = 'keybindings.json5';
const legacyCfgFile = 'hyper.json';
const defaultCfgFile = 'config-default.json';
const schemaFile = 'schema.json';
const homeDirectory = homedir();
// `app.getAppPath()` resolves to the app root: `dist/app` during development
// and in the unpacked build, and the packaged archive once shipped. Compiled
// assets sit below that root rather than beside this module, so every asset
// path is anchored to it instead of to the emitted file's directory.
const appDirectory = app.getAppPath();
const devDir = path.resolve(appDirectory, '..');
const schemaPath = path.join(appDirectory, 'config', schemaFile);
const defaultCfg = path.join(appDirectory, 'config', defaultCfgFile);

/**
 * Distinguishes a broken symlink from an absent file.
 *
 * A dotfiles-managed configuration that is temporarily dangling must not be
 * treated as absent, or a new Velocetty file would silently shadow it for good.
 */
const probe = (candidate: string): 'present' | 'broken-link' | 'absent' => {
  try {
    statSync(candidate);
    return 'present';
  } catch {
    try {
      lstatSync(candidate);
      return 'broken-link';
    } catch {
      return 'absent';
    }
  }
};

/** Compares real paths so a symlinked Velocetty tree is not reported as shadowing. */
const sameFile = (left: string, right: string): boolean => {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
};

const locations = resolveConfigLocations({
  platform: process.platform,
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
  homeDirectory,
  appDataDirectory: app.getPath('appData'),
  hyperUserDataDirectory: app.getPath('userData'),
  development: {enabled: isDev, directory: devDir},
  probe,
  sameFile
});

const cfgPath = locations.config.path;
/** Directory of the active `config.json5`; plugins and the schema copy live beside it. */
const cfgDir = path.dirname(cfgPath);
const keybindingsPath = locations.keybindingsPath;
/** The Velocetty tree, where new configuration files are created. */
const velocettyDir = locations.velocettyDirectory;
/** Which tree supplied the active configuration file. */
const configTree = locations.config.tree;
/** Lower-priority `config.json5` files the active one hides. */
const shadowedConfigPaths = locations.shadowed;

if (configTree === 'development') {
  if (path.basename(cfgPath) === legacyCfgFile) {
    console.warn(
      `using legacy config file: ${cfgPath}. Rename to "${cfgFile}" to align with JSON5 config conventions.`
    );
  } else {
    console.log('using config file:', cfgPath);
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
  configTree,
  keybindingsFile,
  keybindingsPath,
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
  schemaPath,
  shadowedConfigPaths,
  velocettyDir
};
