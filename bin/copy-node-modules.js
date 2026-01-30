const path = require('node:path');
const fs = require('fs-extra');

function copyNodeModules() {
  const baseDir = path.resolve(__dirname, '..');
  const sourceDir = path.join(baseDir, 'target', 'node_modules');
  const destinationDir = path.join(baseDir, 'app', 'node_modules');
  const excludedSegments = [
    path.join('node-pty', 'build', 'node_gyp_bins'),
    path.join('node-pty', 'build', 'node_gyp_bins', 'python3')
  ];

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source node_modules not found at ${sourceDir}`);
  }

  fs.emptyDirSync(destinationDir);
  console.log(`Copying node_modules from ${sourceDir} to ${destinationDir}`);
  // fs-extra handles directories and symlinks without the cpy-cli EISDIR failure.
  fs.copySync(sourceDir, destinationDir, {
    overwrite: true,
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
