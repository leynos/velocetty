/**
 * @file Exposes configuration paths and runtime metadata for the app.
 *
 * Centralizes filesystem paths used across config, plugins, and CLI helpers,
 * including the resolved Bun binary used for plugin installs.
 */
import {execSync} from 'node:child_process';
import {statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve, join} from 'node:path';

import {app} from 'electron';

import isDev from 'electron-is-dev';

/** Filename of the current-format config file, relative to `cfgDir`. */
const cfgFile = 'config.json5';
const legacyCfgFile = 'hyper.json';
const defaultCfgFile = 'config-default.json';
/** Filename of the bundled JSON schema, relative to `cfgDir`. */
const schemaFile = 'schema.json';
/** The current user's home directory. */
const homeDirectory = homedir();

/**
 * Directory holding the user's configuration; may be reassigned below for legacy or
 * dev overrides. If the user defines XDG_CONFIG_HOME they definitely want their
 * config there, otherwise use the home directory on Linux/macOS and userdata on Windows.
 */
let cfgDir = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'Hyper')
  : process.platform === 'win32'
    ? app.getPath('userData')
    : join(homeDirectory, '.config', 'Hyper');

/** Path to the user's config file; may be reassigned below for legacy or dev overrides. */
let cfgPath = join(cfgDir, cfgFile);
const legacyCfgPath = join(cfgDir, legacyCfgFile);
/** Path to the bundled JSON schema source file. */
const schemaPath = resolve(__dirname, schemaFile);

const devDir = resolve(__dirname, '../..');
const devCfg = join(devDir, cfgFile);
const devLegacyCfg = join(devDir, legacyCfgFile);
/** Path to the bundled default configuration template. */
const defaultCfg = resolve(__dirname, defaultCfgFile);

const fileExists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch (_err) {
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

const plugins = resolve(cfgDir, 'plugins');
/** Plugin storage locations, relative to the config directory. */
const plugs = {
  /** Directory for npm-installed plugins. */
  base: plugins,
  /** Directory for locally developed plugins. */
  local: resolve(plugins, 'local'),
  /** Directory for cached plugin installs. */
  cache: resolve(plugins, 'cache')
};
/** The Bun executable name for the current platform. */
const bunExecutable = process.platform === 'win32' ? 'bun.exe' : 'bun';
/** The Bun binary bundled alongside packaged app assets. */
const bundledBun = resolve(__dirname, '../../bin', bunExecutable);
/** Resolved Bun binary used for plugin installs. */
const bun = (() => {
  const bunCandidate = process.env.BUN_PATH ?? bundledBun;

  try {
    statSync(bunCandidate);
    return bunCandidate;
  } catch (_err) {
    // Ignore missing bundled binary; fall back to PATH probe.
  }

  try {
    execSync(`${bunExecutable} --version`, {stdio: 'ignore'});
    return bunExecutable;
  } catch (_err) {
    console.warn('Bun binary not found. Set BUN_PATH or ensure Bun is on PATH to enable plugin installs.');
    return bunExecutable;
  }
})();
/** Path to the bundled `hyper` CLI launcher script. */
const cliScriptPath = resolve(__dirname, '../../bin/hyper');
/** Path where the `hyper` CLI symlink is installed on Linux/macOS. */
const cliLinkPath = '/usr/local/bin/hyper';

/** Path to the application icon used outside of packaged builds. */
const icon = resolve(__dirname, '../static/icon96x96.png');

const keymapPath = resolve(__dirname, '../keymaps');
const darwinKeys = join(keymapPath, 'darwin.json');
const win32Keys = join(keymapPath, 'win32.json');
const linuxKeys = join(keymapPath, 'linux.json');

/** Resolves the bundled default keymap file for the current platform. */
const defaultPlatformKeyPath = () => {
  switch (process.platform) {
    case 'darwin':
      return darwinKeys;
    case 'win32':
      return win32Keys;
    case 'linux':
      return linuxKeys;
    default:
      return darwinKeys;
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
