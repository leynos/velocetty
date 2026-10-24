/**
 * @file Installs a `node-gyp-build` shim into the repository's `node_modules/.bin`.
 *
 * The package manager links dependencies' bins during install, but the native
 * build steps here run from directories whose `PATH` does not reach that
 * directory, and Windows needs a `.cmd` sibling that the Unix shim alone does
 * not provide. Writing both shims up front makes the build steps independent of
 * the caller's working directory.
 *
 * The shims resolve `node-gyp-build/bin.js` from the working directory first and
 * fall back to the repository root and `INIT_CWD`, because npm and Bun run
 * lifecycle scripts from the package directory rather than from the root. An
 * existing shim is left untouched so a package-manager-managed one is never
 * overwritten.
 */
import fs from 'node:fs';
import path from 'node:path';

import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const localBinDir = path.resolve(scriptDirectory, '..', 'node_modules', '.bin');

const unixShim = `#!/usr/bin/env bun
const path = require('node:path');

const candidates = [process.cwd(), path.resolve(__dirname, '..')];
if (process.env.INIT_CWD) {
  candidates.push(process.env.INIT_CWD);
}

let resolved;
for (const base of candidates) {
  try {
    resolved = require.resolve('node-gyp-build/bin.js', { paths: [base] });
    break;
  } catch {
    // Ignore resolution failures to allow trying the next candidate path.
  }
}

if (!resolved) {
  console.error('node-gyp-build not found in', candidates.join(', '));
  process.exit(1);
}

require(resolved);
`;

const windowsShim = [
  '@ECHO OFF',
  'setlocal',
  'set CANDIDATES=%CD%;%~dp0..',
  'if not "%INIT_CWD%"=="" set CANDIDATES=%CANDIDATES%;%INIT_CWD%',
  'for %%G in ("%CANDIDATES:;=" "%") do (',
  String.raw`  if exist "%%~G\node_modules\node-gyp-build\bin.js" (`,
  String.raw`    bun "%%~G\node_modules\node-gyp-build\bin.js" %*`,
  '    exit /b %errorlevel%',
  '  )',
  ')',
  'echo node-gyp-build not found in %CANDIDATES%',
  'exit /b 1',
  ''
].join('\r\n');

const writeShim = (binDir) => {
  if (!binDir) {
    return;
  }
  const shimPath = path.join(binDir, 'node-gyp-build');
  const shimCmdPath = `${shimPath}.cmd`;

  fs.mkdirSync(binDir, {recursive: true});

  if (!fs.existsSync(shimPath)) {
    fs.writeFileSync(shimPath, unixShim, {mode: 0o755});
  }

  if (process.platform === 'win32' && !fs.existsSync(shimCmdPath)) {
    fs.writeFileSync(shimCmdPath, windowsShim, {mode: 0o755});
  }
};

writeShim(localBinDir);
