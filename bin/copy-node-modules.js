/**
 * Mirrors packaged production dependencies into `app/node_modules`.
 *
 * This script intentionally runs under Node.js during postinstall. Bun's
 * runtime can intermittently raise `ENOENT` from `fs-extra` while copying
 * large dependency trees on Linux/WSL, even though the same copy succeeds
 * under Node.
 */
const path = require('node:path');
const fs = require('node:fs');

function hasEntries(dirPath) {
  try {
    return fs.readdirSync(dirPath).length > 0;
  } catch (_error) {
    return false;
  }
}

function copyNodeModules() {
  const baseDir = path.resolve(__dirname, '..');
  const sourceDir = path.join(baseDir, 'dist', 'app', 'node_modules');
  const destinationDir = path.join(baseDir, 'app', 'node_modules');
  const excludedSegments = [
    path.join('node-pty', 'build', 'node_gyp_bins'),
    path.join('node-pty', 'build', 'node_gyp_bins', 'python3')
  ];

  if (!fs.existsSync(sourceDir)) {
    if (hasEntries(destinationDir)) {
      console.log(
        `Skipping node_modules copy because ${sourceDir} is unavailable and ${destinationDir} is already populated.`
      );
      return;
    }

    throw new Error(`Source node_modules not found at ${sourceDir}`);
  }

  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedSourceDir = path.resolve(sourceDir);
  const resolvedDestinationDir = path.resolve(destinationDir);

  if (!resolvedDestinationDir.startsWith(`${resolvedBaseDir}${path.sep}`)) {
    throw new Error(`Refusing to empty unexpected destination: ${resolvedDestinationDir}`);
  }
  if (resolvedDestinationDir === resolvedSourceDir) {
    throw new Error('Refusing to empty destination node_modules identical to source.');
  }

  fs.rmSync(destinationDir, {recursive: true, force: true});
  console.log(`Copying node_modules from ${sourceDir} to ${destinationDir}`);
  // Native `cpSync` avoids the chmod race seen with `fs-extra` during large
  // postinstall copies on this repository's app bundle tree.
  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: false,
    filter: (sourcePath) => {
      const relativePath = path.relative(sourceDir, sourcePath);
      return !excludedSegments.some((segment) => relativePath.startsWith(segment));
    }
  });
}

try {
  copyNodeModules();
} catch (error) {
  console.error(error);
  process.exit(1);
}
