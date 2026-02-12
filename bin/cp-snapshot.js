const path = require('node:path');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const {Arch} = require('electron-builder');

const {normaliseSnapshotArch} = require('./shared/arch.cjs');

const ARCH_ENUM_TO_NAME = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
};

function resolveContextArch(context) {
  if (typeof context.arch === 'string') {
    return normaliseSnapshotArch(context.arch, 'afterPack context.arch');
  }

  if (typeof context.arch === 'number') {
    const resolvedArch = Arch?.[context.arch] ?? ARCH_ENUM_TO_NAME[context.arch];
    if (typeof resolvedArch === 'string') {
      return normaliseSnapshotArch(resolvedArch, 'electron-builder Arch enum');
    }

    return normaliseSnapshotArch(process.arch, 'process.arch fallback for unknown context.arch enum');
  }

  if (context.arch === undefined) {
    return normaliseSnapshotArch(process.arch, 'process.arch fallback');
  }

  throw new Error(`Unsupported context.arch type "${typeof context.arch}".`);
}

function copySnapshot(pathToElectron, archToCopy) {
  const snapshotFileName = 'snapshot_blob.bin';
  const v8ContextFileName = getV8ContextFileName(archToCopy);
  const pathToBlob = path.resolve(__dirname, '..', 'cache', archToCopy, snapshotFileName);
  const pathToBlobV8 = path.resolve(__dirname, '..', 'cache', archToCopy, v8ContextFileName);

  console.log('Copying v8 snapshots from', pathToBlob, 'to', pathToElectron);
  if (!fs.existsSync(pathToBlob) || !fs.existsSync(pathToBlobV8)) {
    throw new Error(
      `Missing snapshot output. Expected ${snapshotFileName} and ${v8ContextFileName} in ${path.dirname(pathToBlob)}`
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
      throw new Error(`ELECTRON_OVERRIDE_DIST_PATH is set to "${pathToElectron}" but the path does not exist.`);
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
  const archToCopy = resolveContextArch(context);
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
  const targetArch = process.env.npm_config_arch;
  if (!targetArch) {
    throw new Error('npm_config_arch must be set when running cp-snapshot.js directly.');
  }

  const archToCopy = normaliseSnapshotArch(targetArch, 'npm_config_arch');
  const currentArch = normaliseSnapshotArch(process.arch, 'process.arch');
  const pathToElectron = getPathToElectron();
  ensureElectronDist(pathToElectron);
  if (currentArch === archToCopy) {
    copySnapshot(pathToElectron, archToCopy);
  }
}
