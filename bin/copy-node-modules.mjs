/**
 * @file Mirrors packaged production dependencies into `app/node_modules`.
 *
 * This script intentionally runs under Node.js during postinstall. Bun's
 * runtime can intermittently raise `ENOENT` from `fs-extra` while copying
 * large dependency trees on Linux/WSL, even though the same copy succeeds
 * under Node.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const moduleFilePath = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(moduleFilePath);
const isMain = process.argv[1] ? path.resolve(process.argv[1]) === moduleFilePath : false;

/**
 * Mirrors packaged production dependencies into `app/node_modules`.
 *
 * The injectable parameters are annotated because this file is JavaScript in a
 * project with `checkJs` off: without the annotations the compiler synthesises
 * a declaration from the inferred types, which are `typeof import('node:fs')`
 * and friends — far wider than the three methods this function actually calls,
 * and therefore impossible for a focused test double to satisfy.
 *
 * @param {object} [options]
 * @param {string} [options.baseDir] Repository root holding `dist/` and `app/`.
 * @param {{
 *   cpSync: (
 *     source: string,
 *     destination: string,
 *     options: {recursive: boolean, force: boolean, dereference: boolean, filter: (sourcePath: string) => boolean}
 *   ) => void,
 *   existsSync: (target: string) => boolean,
 *   rmSync: (target: string, options?: {recursive: boolean, force: boolean}) => void
 * }} [options.fsModule] Filesystem surface used for the copy.
 * @param {(message: string) => void} [options.logger] Sink for progress lines.
 * @param {{
 *   join: (...parts: string[]) => string,
 *   resolve: (...parts: string[]) => string,
 *   relative: (from: string, to: string) => string,
 *   sep: string
 * }} [options.pathModule] Path surface used to build and compare locations.
 * @returns {void}
 */
export function copyNodeModules({
  baseDir = path.resolve(moduleDir, '..'),
  fsModule = fs,
  logger = console.log,
  pathModule = path
} = {}) {
  const sourceDir = pathModule.join(baseDir, 'dist', 'app', 'node_modules');
  const destinationDir = pathModule.join(baseDir, 'app', 'node_modules');
  const excludedSegments = [
    pathModule.join('node-pty', 'build', 'node_gyp_bins'),
    pathModule.join('node-pty', 'build', 'node_gyp_bins', 'python3')
  ];

  const sourceExists = fsModule.existsSync(sourceDir);
  const destinationExists = fsModule.existsSync(destinationDir);

  if (!sourceExists) {
    if (destinationExists) {
      logger(
        `Skipping node_modules mirror: source missing at ${sourceDir}, destination already exists at ${destinationDir}`
      );
      return;
    }
    throw new Error(`Source node_modules not found at ${sourceDir}`);
  }

  const resolvedBaseDir = pathModule.resolve(baseDir);
  const resolvedSourceDir = pathModule.resolve(sourceDir);
  const resolvedDestinationDir = pathModule.resolve(destinationDir);

  if (!resolvedDestinationDir.startsWith(`${resolvedBaseDir}${pathModule.sep}`)) {
    throw new Error(`Refusing to empty unexpected destination: ${resolvedDestinationDir}`);
  }
  if (resolvedDestinationDir === resolvedSourceDir) {
    throw new Error('Refusing to empty destination node_modules identical to source.');
  }

  fsModule.rmSync(destinationDir, {recursive: true, force: true});
  logger(`Copying node_modules from ${sourceDir} to ${destinationDir}`);
  // Native `cpSync` avoids the chmod race seen with `fs-extra` during large
  // postinstall copies on this repository's app bundle tree.
  fsModule.cpSync(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (sourcePath) => {
      const relativePath = pathModule.relative(sourceDir, sourcePath);
      return !excludedSegments.some((segment) => relativePath.startsWith(segment));
    }
  });
}

if (isMain) {
  try {
    copyNodeModules();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
