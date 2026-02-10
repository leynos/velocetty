/** @file Copies non-module assets required for app and renderer bundles. */
import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import path from 'node:path';

/** Paths used by copy operations, rooted at the repository directory by default. */
type CopyOptions = {
  rootDir?: string;
  targetDir?: string;
};

/** Options for copy flow that mirrors the legacy hyper-app webpack output. */
type HyperAppCopyOptions = CopyOptions & {
  allowMissingPatches?: boolean;
};

/** Options for renderer asset copy flow. */
type RendererCopyOptions = CopyOptions & {
  allowMissingAssets?: boolean;
};

/** Returns true when a filesystem error indicates a missing file or directory. */
const isNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
};

/** Lists files with the requested extension in deterministic lexical order. */
const sortedFileNames = async (directoryPath: string, extension: string) => {
  const entries = await readdir(directoryPath, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
};

/** Copies a single file and optionally tolerates missing source paths. */
const copySingleFile = async (sourcePath: string, targetPath: string, allowMissing = false) => {
  try {
    await cp(sourcePath, targetPath, {force: true});
  } catch (error) {
    if (allowMissing && isNotFoundError(error)) {
      return;
    }
    throw error;
  }
};

/** Copies all files with a matching extension from source to target. */
const copyFilesByExtension = async (
  sourceDirectory: string,
  targetDirectory: string,
  extension: string,
  allowMissing = false
) => {
  try {
    await mkdir(targetDirectory, {recursive: true});
    const fileNames = await sortedFileNames(sourceDirectory, extension);
    await Promise.all(
      fileNames.map((fileName) =>
        copySingleFile(path.join(sourceDirectory, fileName), path.join(targetDirectory, fileName), allowMissing)
      )
    );
  } catch (error) {
    if (allowMissing && isNotFoundError(error)) {
      return;
    }
    throw error;
  }
};

/** Copies files matching any provided extension from source to target. */
const copyFilesByExtensions = async (
  sourceDirectory: string,
  targetDirectory: string,
  extensions: readonly string[],
  allowMissing = false
) => {
  await Promise.all(
    extensions.map((extension) => copyFilesByExtension(sourceDirectory, targetDirectory, extension, allowMissing))
  );
};

/** Copies an entire directory tree and optionally tolerates missing sources. */
const copyDirectory = async (sourceDirectory: string, targetDirectory: string, allowMissing = false) => {
  try {
    await mkdir(path.dirname(targetDirectory), {recursive: true});
    await cp(sourceDirectory, targetDirectory, {
      recursive: true,
      force: true
    });
  } catch (error) {
    if (allowMissing && isNotFoundError(error)) {
      return;
    }
    throw error;
  }
};

/** Copies the former `hyper-app` webpack artefacts into `target/`. */
export const copyHyperAppArtifacts = async (options: HyperAppCopyOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const targetDir = options.targetDir ?? path.join(rootDir, 'target');
  const appDirectory = path.join(rootDir, 'app');
  const allowMissingPatches = options.allowMissingPatches ?? true;

  await rm(path.join(targetDir, 'patches'), {recursive: true, force: true});
  await mkdir(targetDir, {recursive: true});

  await Promise.all([
    copyFilesByExtension(appDirectory, targetDir, '.html'),
    copyFilesByExtension(appDirectory, targetDir, '.json'),
    copyFilesByExtension(path.join(appDirectory, 'config'), path.join(targetDir, 'config'), '.json'),
    copyFilesByExtension(path.join(appDirectory, 'keymaps'), path.join(targetDir, 'keymaps'), '.json'),
    copyFilesByExtensions(path.join(appDirectory, 'static'), path.join(targetDir, 'static'), ['.png', '.svg']),
    copyDirectory(path.join(appDirectory, 'patches'), path.join(targetDir, 'patches'), allowMissingPatches)
  ]);
};

/** Copies renderer static assets to the renderer output directory. */
export const copyRendererArtifacts = async (options: RendererCopyOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const targetDir = options.targetDir ?? path.join(rootDir, 'target', 'renderer');
  const allowMissingAssets = options.allowMissingAssets ?? false;
  await copyFilesByExtensions(
    path.join(rootDir, 'assets'),
    path.join(targetDir, 'assets'),
    ['.png', '.svg'],
    allowMissingAssets
  );
};
