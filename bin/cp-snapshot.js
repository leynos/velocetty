const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const {Arch} = require('electron-builder');

function copySnapshot(pathToElectron, archToCopy) {
  const snapshotFileName = 'snapshot_blob.bin';
  const v8ContextFileName = getV8ContextFileName(archToCopy);
  const pathToBlob = path.resolve(__dirname, '..', 'cache', archToCopy, snapshotFileName);
  const pathToBlobV8 = path.resolve(__dirname, '..', 'cache', archToCopy, v8ContextFileName);

  console.log('Copying v8 snapshots from', pathToBlob, 'to', pathToElectron);
  if (!fs.existsSync(pathToBlob) || !fs.existsSync(pathToBlobV8)) {
    throw new Error(
      `Missing snapshot output. Expected ${snapshotFileName} and ${v8ContextFileName} in ${path.dirname(
        pathToBlob
      )}`
    );
  }
  fs.copyFileSync(pathToBlob, path.join(pathToElectron, snapshotFileName));
  fs.copyFileSync(pathToBlobV8, path.join(pathToElectron, v8ContextFileName));
}

function getPathToElectron() {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return process.env.ELECTRON_OVERRIDE_DIST_PATH;
  }

  switch (process.platform) {
    case 'darwin':
      return path.resolve(
        __dirname,
        '..',
        'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
      );
    case 'win32':
    case 'linux':
      return path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist');
  }
}

function ensureElectronDist(pathToElectron) {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    if (!fs.existsSync(pathToElectron)) {
      throw new Error(
        `ELECTRON_OVERRIDE_DIST_PATH is set to "${pathToElectron}" but the path does not exist.`
      );
    }
    return;
  }

  if (fs.existsSync(pathToElectron)) {
    return;
  }

  const installScript = path.resolve(__dirname, '..', 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installScript)) {
    throw new Error('Electron install script not found. Run bun install first.');
  }

  console.log('Electron dist not found. Running electron install script...');
  const result = childProcess.spawnSync(process.execPath, [installScript], {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Electron install failed with exit code ${result.status ?? 1}.`);
  }

  if (!fs.existsSync(pathToElectron)) {
    throw new Error(`Electron dist still missing at ${pathToElectron}.`);
  }
}

function getV8ContextFileName(archToCopy) {
  if (process.platform === 'darwin') {
    return `v8_context_snapshot${archToCopy === 'arm64' ? '.arm64' : '.x86_64'}.bin`;
  } else {
    return `v8_context_snapshot.bin`;
  }
}

function resolveMacBundleName(context) {
  const appInfo = context?.packager?.appInfo;
  const bundleName = appInfo?.productFilename || appInfo?.productName || 'Hyper';
  return `${bundleName}.app`;
}

exports.default = async (context) => {
  const archToCopy = Arch[context.arch];
  const pathToElectron =
    process.platform === 'darwin'
      ? path.join(
          context.appOutDir,
          resolveMacBundleName(context),
          'Contents',
          'Frameworks',
          'Electron Framework.framework',
          'Versions',
          'A',
          'Resources'
        )
      : context.appOutDir;
  copySnapshot(pathToElectron, archToCopy);
};

if (require.main === module) {
  const archToCopy = process.env.npm_config_arch;
  const pathToElectron = getPathToElectron();
  ensureElectronDist(pathToElectron);
  if ((process.arch.startsWith('arm') ? 'arm64' : 'x64') === archToCopy) {
    copySnapshot(pathToElectron, archToCopy);
  }
}
