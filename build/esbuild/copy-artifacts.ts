/** @file Copies non-module assets required for app and renderer bundles. */
import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import path from 'node:path';

type CopyOptions = {
  rootDir?: string;
  targetDir?: string;
};

const sortedFileNames = async (directoryPath: string, extension: string) => {
  const entries = await readdir(directoryPath, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
};

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
        cp(path.join(sourceDirectory, fileName), path.join(targetDirectory, fileName), {
          force: true
        })
      )
    );
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

const copyDirectory = async (sourceDirectory: string, targetDirectory: string, allowMissing = false) => {
  try {
    await mkdir(path.dirname(targetDirectory), {recursive: true});
    await cp(sourceDirectory, targetDirectory, {
      recursive: true,
      force: true
    });
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

/** Copies the former `hyper-app` webpack artefacts into `target/`. */
export const copyHyperAppArtifacts = async (options: CopyOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const targetDir = options.targetDir ?? path.join(rootDir, 'target');
  const appDirectory = path.join(rootDir, 'app');

  await rm(path.join(targetDir, 'patches'), {recursive: true, force: true});
  await mkdir(targetDir, {recursive: true});

  await copyFilesByExtension(appDirectory, targetDir, '.html');
  await copyFilesByExtension(appDirectory, targetDir, '.json');
  await copyFilesByExtension(path.join(appDirectory, 'config'), path.join(targetDir, 'config'), '.json');
  await copyFilesByExtension(path.join(appDirectory, 'keymaps'), path.join(targetDir, 'keymaps'), '.json');
  await copyDirectory(path.join(appDirectory, 'static'), path.join(targetDir, 'static'));
  await copyDirectory(path.join(appDirectory, 'patches'), path.join(targetDir, 'patches'), true);
};

/** Copies renderer static assets to the renderer output directory. */
export const copyRendererArtifacts = async (options: CopyOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const targetDir = options.targetDir ?? path.join(rootDir, 'target', 'renderer');
  await copyDirectory(path.join(rootDir, 'assets'), path.join(targetDir, 'assets'));
};
