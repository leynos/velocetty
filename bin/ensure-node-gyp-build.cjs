const fs = require('node:fs');
const path = require('node:path');

const binDir = path.resolve(__dirname, '..', 'node_modules', '.bin');
const shimPath = path.join(binDir, 'node-gyp-build');
const shimCmdPath = `${shimPath}.cmd`;

const unixShim = `#!/usr/bin/env node
const path = require('node:path');

require(path.resolve(__dirname, '../node-gyp-build/bin.js'));
`;

const windowsShim = ['@ECHO OFF', 'node "%~dp0\\..\\node-gyp-build\\bin.js" %*', ''].join('\r\n');

fs.mkdirSync(binDir, {recursive: true});

if (!fs.existsSync(shimPath)) {
  fs.writeFileSync(shimPath, unixShim, {mode: 0o755});
}

if (process.platform === 'win32' && !fs.existsSync(shimCmdPath)) {
  fs.writeFileSync(shimCmdPath, windowsShim, {mode: 0o755});
}
