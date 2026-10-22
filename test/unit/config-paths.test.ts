/** @file Guards the asset paths `app/config/paths.ts` resolves against the app root. */
import {beforeAll, expect, test} from 'bun:test';
import {existsSync} from 'node:fs';
import path from 'node:path';

import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';

const repositoryRoot = path.resolve(import.meta.dir, '..', '..');

/**
 * The keymap file the platform resolver falls back to, mirroring the module's
 * own default branch.
 *
 * @returns The keymap directory and file name for this platform.
 */
const expectedKeymap = (): string => {
  const keymapFiles: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'darwin.json',
    win32: 'win32.json',
    linux: 'linux.json'
  };
  return path.join('keymaps', keymapFiles[process.platform] ?? 'darwin.json');
};

let paths: typeof import('../../app/config/paths');
let appRoot: string;

beforeAll(async () => {
  // `app/config/paths.ts` reads `app.getAppPath()` once, at module evaluation,
  // and `electron-is-dev` reads `app.isPackaged` alongside it. Both come from
  // the shared mock, so it must be registered before the import.
  //
  // This suite deliberately uses the mock's own default app root rather than
  // overriding it. The import below awaits, and another test file sharing this
  // Bun process can call `resetElectronMock()` during that await; a reset
  // restores the default, so an override would be silently reverted before the
  // module evaluated and the assertion would compare against the wrong root.
  registerElectronMock();
  resetElectronMock();
  appRoot = getElectronMock().app.getAppPath();

  paths = await import('../../app/config/paths.ts?config_paths_unit');
});

test('anchors every configuration asset below the app root', () => {
  expect(paths.schemaPath).toBe(path.join(appRoot, 'config', 'schema.json'));
  expect(paths.defaultCfg).toBe(path.join(appRoot, 'config', 'config-default.json'));
});

test('anchors the icon and keymaps below the app root', () => {
  expect(paths.icon).toBe(path.join(appRoot, 'static', 'icon96x96.png'));
  expect(paths.defaultPlatformKeyPath()).toBe(path.join(appRoot, expectedKeymap()));
});

test('anchors the bundled CLI beside the app root', () => {
  // `electron-builder.json` copies `./build/${os}/` to `./bin/` next to the
  // packaged app, so the bundled helpers are siblings of the app root rather
  // than descendants of it.
  expect(paths.cliScriptPath).toBe(path.resolve(appRoot, '..', 'bin', 'hyper'));
});

test('matches the source layout the build copies into the app root', () => {
  const appSourceRoot = path.join(repositoryRoot, 'app');
  const copiedAssets = [
    path.join('config', 'schema.json'),
    path.join('config', 'config-default.json'),
    path.join('static', 'icon96x96.png'),
    expectedKeymap()
  ];

  const missingAssets = copiedAssets.filter((asset) => !existsSync(path.join(appSourceRoot, asset)));

  expect(missingAssets).toEqual([]);
});
