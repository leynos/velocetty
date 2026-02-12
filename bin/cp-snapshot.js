const path = require('node:path');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const {Arch} = require('electron-builder');

const SUPPORTED_ARCHITECTURES = ['x64', 'arm64'];
const ARCH_ALIASES = {
  x64: 'x64',
  amd64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64'
};
const UNSUPPORTED_ARCHES = new Set(['arm']);

const ARCH_ENUM_TO_NAME = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
};

function validateArchInput(arch, sourceLabel) {
  if (typeof arch !== 'string' || arch.length === 0) {
    throw new Error(`Expected a string architecture from ${sourceLabel}, received "${String(arch)}".`);
  }
}

function normalizeArch(arch, sourceLabel) {
  validateArchInput(arch, sourceLabel);

  const normalized = ARCH_ALIASES[arch];
  if (normalized) {
    return normalized;
  }

  if (UNSUPPORTED_ARCHES.has(arch)) {
    throw new Error('Unsupported architecture "arm". Snapshot artifacts are available only for x64 and arm64.');
  }

  throw new Error(
    `Unsupported architecture "${arch}" from ${sourceLabel}. Supported values: ${SUPPORTED_ARCHITECTURES.join(', ')}.`
  );
}

const isStringArch = (context) => typeof context.arch === 'string';
const isEnumArch = (context) => typeof context.arch === 'number';
const isUndefinedArch = (context) => context.arch === undefined;

const resolveEnumArch = (contextArch) => {
  const resolvedArch = Arch?.[contextArch] ?? ARCH_ENUM_TO_NAME[contextArch];
  if (typeof resolvedArch === 'string') {
    return normalizeArch(resolvedArch, 'electron-builder Arch enum');
  }

  return normalizeArch(process.arch, 'process.arch fallback for unknown context.arch enum');
};

const isValidArchEnum = (arch) => typeof arch === 'number' && Arch && Arch[arch];

function resolveContextArch(context) {
  if (isStringArch(context)) {
    return normalizeArch(context.arch, 'afterPack context.arch');
  }

  if (isValidArchEnum(context.arch)) {
    return resolveEnumArch(context.arch);
  }

  if (isEnumArch(context)) {
    return normalizeArch(process.arch, 'process.arch fallback for unknown context.arch enum');
  }

  if (isUndefinedArch(context)) {
    return normalizeArch(process.arch, 'process.arch fallback');
  }

  throw new Error(`Unsupported context.arch type "${typeof context.arch}".`);
}

function getSnapshotPaths(archToCopy) {
  const snapshotFileName = 'snapshot_blob.bin';
  const v8ContextFileName = getV8ContextFileName(archToCopy);
  const pathToBlob = path.resolve(__dirname, '..', 'cache', archToCopy, snapshotFileName);
  const pathToBlobV8 = path.resolve(__dirname, '..', 'cache', archToCopy, v8ContextFileName);

  return {
    snapshotFileName,
    v8ContextFileName,
    pathToBlob,
    pathToBlobV8
  };
}

function validateSnapshotFiles(snapshotPaths) {
  const {snapshotFileName, v8ContextFileName, pathToBlob, pathToBlobV8} = snapshotPaths;
  if (!fs.existsSync(pathToBlob) || !fs.existsSync(pathToBlobV8)) {
    throw new Error(
      `Missing snapshot output. Expected ${snapshotFileName} and ${v8ContextFileName} in ${path.dirname(pathToBlob)}`
    );
  }
}

function copySnapshot(pathToElectron, archToCopy) {
  const snapshotPaths = getSnapshotPaths(archToCopy);

  console.log('Copying v8 snapshots from', snapshotPaths.pathToBlob, 'to', pathToElectron);
  validateSnapshotFiles(snapshotPaths);
  fs.copyFileSync(snapshotPaths.pathToBlob, path.join(pathToElectron, snapshotPaths.snapshotFileName));
  fs.copyFileSync(snapshotPaths.pathToBlobV8, path.join(pathToElectron, snapshotPaths.v8ContextFileName));
}

function getDarwinElectronPath() {
  return path.resolve(
    __dirname,
    '..',
    'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
  );
}

function getDefaultElectronPath() {
  return path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist');
}

function getPathToElectron() {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return process.env.ELECTRON_OVERRIDE_DIST_PATH;
  }

  switch (process.platform) {
    case 'darwin':
      return getDarwinElectronPath();
    case 'win32':
    case 'linux':
      return getDefaultElectronPath();
  }
}

function validateOverridePath(pathToElectron) {
  if (!fs.existsSync(pathToElectron)) {
    throw new Error(`ELECTRON_OVERRIDE_DIST_PATH is set to "${pathToElectron}" but the path does not exist.`);
  }
}

function runElectronInstall(installScript) {
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
}

function ensureElectronDist(pathToElectron) {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    validateOverridePath(pathToElectron);
    return;
  }

  if (fs.existsSync(pathToElectron)) {
    return;
  }

  const installScript = path.resolve(__dirname, '..', 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installScript)) {
    throw new Error('Electron install script not found. Run bun install first.');
  }

  runElectronInstall(installScript);

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

function getDarwinAppPath(context) {
  return path.join(
    context.appOutDir,
    resolveMacBundleName(context),
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );
}

exports.default = async (context) => {
  const archToCopy = resolveContextArch(context);
  const pathToElectron = process.platform === 'darwin' ? getDarwinAppPath(context) : context.appOutDir;
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
