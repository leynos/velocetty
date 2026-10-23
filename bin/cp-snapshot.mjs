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

/**
 * Reads the architecture being packed out of an `afterPack` context.
 *
 * Returns `undefined` when the context does not say which architecture is
 * being packed. The host architecture is deliberately not used as a
 * substitute: a runner that packs more than one architecture carries artefacts
 * for its own, so guessing the host would copy a snapshot built for different
 * hardware into the bundle. The caller treats an unknown architecture the same
 * way it treats absent artefacts, which is a supported outcome.
 *
 * @param context - The `afterPack` context supplied by electron-builder.
 * @returns The normalized target architecture, or `undefined` if undetermined.
 * @throws If the context gives an architecture that is present but unusable.
 */
export function resolveContextArch(context) {
  const stringArch = architectureSchema.safeParse(context.arch);
  if (stringArch.success) {
    return normalizeArch(stringArch.data, 'afterPack context.arch');
  }

  const enumArch = enumArchitectureSchema.safeParse(context.arch);
  if (enumArch.success) {
    const enumValue = architectureSchema.safeParse(Arch[enumArch.data]);
    if (enumValue.success) return normalizeArch(enumValue.data, 'electron-builder Arch enum');
    return;
  }

  if (context.arch === undefined || context.arch === null) return;
  throw new Error(`Unsupported context.arch value "${String(context.arch)}".`);
}

const defaultCacheRoot = () => path.resolve(scriptDirectory, '..', 'cache');

export function getSnapshotPaths(archToCopy, cacheRoot = defaultCacheRoot()) {
  const snapshotFileName = 'snapshot_blob.bin';
  const v8ContextFileName = getV8ContextFileName(archToCopy);
  const pathToBlob = path.resolve(cacheRoot, archToCopy, snapshotFileName);
  const pathToBlobV8 = path.resolve(cacheRoot, archToCopy, v8ContextFileName);

  return {snapshotFileName, v8ContextFileName, pathToBlob, pathToBlobV8};
}

/**
 * Reports which of an architecture's snapshot artefacts are present.
 *
 * The whole cache directory is absent for an architecture this host cannot
 * snapshot, whereas a half-written directory means generation itself failed
 * partway. The two cases need different answers, so they are distinguished
 * rather than collapsed into one existence check.
 *
 * @param snapshotPaths - Paths returned by `getSnapshotPaths`.
 * @returns Whether each expected artefact exists.
 */
const inspectSnapshotFiles = (snapshotPaths) => ({
  hasBlob: fs.existsSync(snapshotPaths.pathToBlob),
  hasV8Context: fs.existsSync(snapshotPaths.pathToBlobV8)
});

export function copySnapshot(pathToElectron, archToCopy, cacheRoot = defaultCacheRoot()) {
  const snapshotPaths = getSnapshotPaths(archToCopy, cacheRoot);
  const {hasBlob, hasV8Context} = inspectSnapshotFiles(snapshotPaths);

  if (!hasBlob && !hasV8Context) {
    // Absent is the expected state for an architecture the host cannot
    // snapshot: `run-v8-snapshot.js` generates only arm64 on an arm64 macOS
    // runner, while the macOS targets still pack x64. Electron ships its own
    // default snapshot, which is the supported fallback, as it is for the
    // Linux aarch64 lane. Copying another architecture's artefacts instead
    // would embed a snapshot built for different hardware, which Electron
    // cannot load.
    console.log(
      `No V8 snapshot artefacts for ${archToCopy} in ${path.dirname(snapshotPaths.pathToBlob)}, ` +
        "keeping Electron's bundled default snapshot."
    );
    return;
  }

  if (!hasBlob || !hasV8Context) {
    const missingFile = hasBlob ? snapshotPaths.v8ContextFileName : snapshotPaths.snapshotFileName;
    throw new Error(
      `Incomplete snapshot output: ${missingFile} is missing from ${path.dirname(snapshotPaths.pathToBlob)}.`
    );
  }

  console.log('Copying v8 snapshots from', snapshotPaths.pathToBlob, 'to', pathToElectron);
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
  if (archToCopy === undefined) {
    // Electron's bundled default snapshot is a working fallback, and a wrong
    // architecture's snapshot is not, so an undetermined target keeps the
    // default rather than guessing.
    console.log('Could not determine the architecture being packed, keeping the bundled default V8 snapshot.');
    return;
  }

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
