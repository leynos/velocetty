/** @file Copies generated V8 snapshot artefacts into Electron distributions. */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {z} from 'zod';
import electronBuilder from 'electron-builder';

const {Arch} = electronBuilder;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const SUPPORTED_ARCHITECTURES = ['x64', 'arm64'];
const ARCH_ALIASES = {x64: 'x64', amd64: 'x64', arm64: 'arm64', aarch64: 'arm64'};
const UNSUPPORTED_ARCHES = new Set(['arm']);
const architectureSchema = z.string().min(1);
const enumArchitectureSchema = z.number().int();
const shouldSkipSnapshotCopy = () => process.env.SKIP_V8_SNAPSHOT_COPY === '1';

function normalizeArch(value, sourceLabel) {
  const parsed = architectureSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Expected a string architecture from ${sourceLabel}, received "${String(value)}".`);
  }

  const arch = parsed.data;
  const normalized = ARCH_ALIASES[arch];
  if (normalized) return normalized;

  if (UNSUPPORTED_ARCHES.has(arch)) {
    throw new Error('Unsupported architecture "arm". Snapshot artefacts are available only for x64 and arm64.');
  }

  throw new Error(
    `Unsupported architecture "${arch}" from ${sourceLabel}. Supported values: ${SUPPORTED_ARCHITECTURES.join(', ')}.`
  );
}

function resolveContextArch(context) {
  const stringArch = architectureSchema.safeParse(context.arch);
  if (stringArch.success) {
    return normalizeArch(stringArch.data, 'afterPack context.arch');
  }

  const enumArch = enumArchitectureSchema.safeParse(context.arch);
  if (enumArch.success) {
    const enumValue = architectureSchema.safeParse(Arch[enumArch.data]);
    if (enumValue.success) return normalizeArch(enumValue.data, 'electron-builder Arch enum');
    return normalizeArch(process.arch, 'process.arch fallback for unknown context.arch enum');
  }

  if (context.arch === undefined) return normalizeArch(process.arch, 'process.arch fallback');
  throw new Error(`Unsupported context.arch value "${String(context.arch)}".`);
}

function getSnapshotPaths(archToCopy) {
  const snapshotFileName = 'snapshot_blob.bin';
  const v8ContextFileName = getV8ContextFileName(archToCopy);
  const pathToBlob = path.resolve(scriptDirectory, '..', 'cache', archToCopy, snapshotFileName);
  const pathToBlobV8 = path.resolve(scriptDirectory, '..', 'cache', archToCopy, v8ContextFileName);

  return {snapshotFileName, v8ContextFileName, pathToBlob, pathToBlobV8};
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
    scriptDirectory,
    '..',
    'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
  );
}

function getDefaultElectronPath() {
  return path.resolve(scriptDirectory, '..', 'node_modules', 'electron', 'dist');
}

function getPathToElectron() {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) return process.env.ELECTRON_OVERRIDE_DIST_PATH;

  switch (process.platform) {
    case 'darwin': {
      return getDarwinElectronPath();
    }
    case 'win32':
    case 'linux': {
      return getDefaultElectronPath();
    }
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

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Electron install failed with exit code ${result.status ?? 1}.`);
}

function ensureElectronDist(pathToElectron) {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    validateOverridePath(pathToElectron);
    return;
  }
  if (fs.existsSync(pathToElectron)) return;

  const installScript = path.resolve(scriptDirectory, '..', 'node_modules', 'electron', 'install.js');
  if (!fs.existsSync(installScript)) throw new Error('Electron install script not found. Run bun install first.');
  runElectronInstall(installScript);
  if (!fs.existsSync(pathToElectron)) throw new Error(`Electron dist still missing at ${pathToElectron}.`);
}

function getV8ContextFileName(archToCopy) {
  if (process.platform === 'darwin') {
    return `v8_context_snapshot${archToCopy === 'arm64' ? '.arm64' : '.x86_64'}.bin`;
  }
  return 'v8_context_snapshot.bin';
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

export default async function copySnapshotHook(context) {
  if (shouldSkipSnapshotCopy()) {
    console.log('Skipping V8 snapshot copy because SKIP_V8_SNAPSHOT_COPY=1.');
    return;
  }

  const archToCopy = resolveContextArch(context);
  const pathToElectron = process.platform === 'darwin' ? getDarwinAppPath(context) : context.appOutDir;
  copySnapshot(pathToElectron, archToCopy);
}

const runDirectly = async () => {
  if (shouldSkipSnapshotCopy()) {
    console.log('Skipping V8 snapshot copy because SKIP_V8_SNAPSHOT_COPY=1.');
    return;
  }

  const targetArch = process.env.npm_config_arch;
  if (!targetArch) throw new Error('npm_config_arch must be set when running cp-snapshot.mjs directly.');

  const archToCopy = normalizeArch(targetArch, 'npm_config_arch');
  const currentArch = normalizeArch(process.arch, 'process.arch');
  const pathToElectron = getPathToElectron();
  ensureElectronDist(pathToElectron);
  if (currentArch === archToCopy) {
    copySnapshot(pathToElectron, archToCopy);
  } else {
    console.log(`Skipping snapshot copy: current architecture ${currentArch} does not match requested ${archToCopy}.`);
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  try {
    await runDirectly();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
