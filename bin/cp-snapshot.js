const path = require('node:path');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const {Arch} = require('electron-builder');

const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64']);

function normalizeArch(arch, sourceLabel) {
  if (typeof arch !== 'string' || arch.length === 0) {
    throw new Error(`Expected a string architecture from ${sourceLabel}, received "${String(arch)}".`);
  }

  if (arch === 'x64' || arch === 'amd64') {
    return 'x64';
  }

  if (arch === 'arm64' || arch === 'aarch64') {
    return 'arm64';
  }

  if (arch === 'arm') {
    throw new Error('Unsupported architecture "arm". Snapshot artifacts are available only for x64 and arm64.');
  }

  throw new Error(
    `Unsupported architecture "${arch}" from ${sourceLabel}. Supported values: ${Array.from(SUPPORTED_ARCHITECTURES).join(', ')}.`
  );
}

function resolveContextArch(context) {
  if (typeof context.arch === 'string') {
    return normalizeArch(context.arch, 'afterPack context.arch');
  }

  if (typeof context.arch === 'number' && Arch && Arch[context.arch]) {
    return normalizeArch(Arch[context.arch], 'electron-builder Arch enum');
  }

  if (context.arch === undefined) {
    return normalizeArch(process.arch, 'process.arch fallback');
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

  const archToCopy = normalizeArch(targetArch, 'npm_config_arch');
  const currentArch = normalizeArch(process.arch, 'process.arch');
  const pathToElectron = getPathToElectron();
  ensureElectronDist(pathToElectron);
  if (currentArch === archToCopy) {
    copySnapshot(pathToElectron, archToCopy);
  }
}
