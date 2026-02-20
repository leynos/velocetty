/**
 * @file Exposes configuration paths and runtime metadata for the app.
 *
 * Centralises filesystem paths used across config, plugins, and CLI helpers,
 * including the resolved Bun binary used for plugin installs.
 */
import {execSync} from 'node:child_process';
import {statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve, join} from 'node:path';

import {app} from 'electron';

import isDev from 'electron-is-dev';

const cfgFile = 'hyper.json';
const defaultCfgFile = 'config-default.json';
const schemaFile = 'schema.json';
const homeDirectory = homedir();

// If the user defines XDG_CONFIG_HOME they definitely want their config there,
// otherwise use the home directory in linux/mac and userdata in windows
let cfgDir = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'Hyper')
  : process.platform === 'win32'
    ? app.getPath('userData')
    : join(homeDirectory, '.config', 'Hyper');

let cfgPath = join(cfgDir, cfgFile);
const schemaPath = resolve(__dirname, schemaFile);

const devDir = resolve(__dirname, '../..');
const devCfg = join(devDir, cfgFile);
const defaultCfg = resolve(__dirname, defaultCfgFile);

if (isDev) {
  // if a local config file exists, use it
  try {
    statSync(devCfg);
    cfgPath = devCfg;
    cfgDir = devDir;
    console.log('using config file:', cfgPath);
  } catch (_err) {
    // ignore
  }
}

const plugins = resolve(cfgDir, 'plugins');
const plugs = {
  base: plugins,
  local: resolve(plugins, 'local'),
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
const cliScriptPath = resolve(__dirname, '../../bin/hyper');
const cliLinkPath = '/usr/local/bin/hyper';

const icon = resolve(__dirname, '../static/icon96x96.png');

const keymapPath = resolve(__dirname, '../keymaps');
const darwinKeys = join(keymapPath, 'darwin.json');
const win32Keys = join(keymapPath, 'win32.json');
const linuxKeys = join(keymapPath, 'linux.json');

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
