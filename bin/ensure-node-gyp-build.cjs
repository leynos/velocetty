const fs = require('node:fs');
const path = require('node:path');

const localBinDir = path.resolve(__dirname, '..', 'node_modules', '.bin');
const globalBinDir = process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, 'bin') : null;

const unixShim = `#!/usr/bin/env node
const path = require('node:path');

const candidates = [process.cwd()];
if (process.env.INIT_CWD) {
  candidates.push(process.env.INIT_CWD);
}

let resolved;
for (const base of candidates) {
  try {
    resolved = require.resolve('node-gyp-build/bin.js', { paths: [base] });
    break;
  } catch {}
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
  'set CANDIDATES=%CD%',
  'if not "%INIT_CWD%"=="" set CANDIDATES=%CANDIDATES%;%INIT_CWD%',
  'for %%G in ("%CANDIDATES:;=" "%") do (',
  '  if exist "%%~G\\\\node_modules\\\\node-gyp-build\\\\bin.js" (',
  '    node "%%~G\\\\node_modules\\\\node-gyp-build\\\\bin.js" %*',
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
writeShim(globalBinDir);
