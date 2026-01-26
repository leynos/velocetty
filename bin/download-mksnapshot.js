const fs = require('fs');
const path = require('path');
const {downloadArtifact} = require('@electron/get');
const extractZip = require('extract-zip');

function normaliseArch(arch) {
  if (!arch) {
    return 'x64';
  }

  if (arch === 'aarch64') {
    return 'arm64';
  }

  if (arch === 'amd64') {
    return 'x64';
  }

  return arch;
}

function resolveElectronVersion() {
  if (process.env.ELECTRON_CUSTOM_VERSION) {
    return process.env.ELECTRON_CUSTOM_VERSION;
  }

  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  return packageJson.devDependencies?.electron;
}

async function main() {
  const version = resolveElectronVersion();
  if (!version) {
    throw new Error('Electron version not found. Set ELECTRON_CUSTOM_VERSION.');
  }

  const platform = process.env.npm_config_platform || process.platform;
  const arch = normaliseArch(process.env.npm_config_arch || process.arch);
  const downloadArch =
    arch.startsWith('arm') && platform !== 'darwin' ? `${arch}-x64` : arch;
  const strictSslEnv = process.env.npm_config_strict_ssl;
  // npm's strict-ssl defaults to true; only disable verification explicitly.
  const rejectUnauthorized = strictSslEnv !== 'false';

  const targetFolder = path.resolve(__dirname, '..', 'node_modules', 'electron-mksnapshot', 'bin');
  if (!fs.existsSync(path.dirname(targetFolder))) {
    throw new Error('electron-mksnapshot is not installed. Run bun install first.');
  }

  fs.mkdirSync(targetFolder, {recursive: true});

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'mksnapshot',
    platform,
    arch: downloadArch,
    rejectUnauthorized,
    quiet: ['info', 'verbose', 'silly', 'http'].indexOf(process.env.npm_config_loglevel) === -1
  });

  await extractZip(zipPath, {dir: targetFolder});

  if (platform !== 'win32') {
    const mksnapshotPath = path.join(targetFolder, 'mksnapshot');
    if (fs.existsSync(mksnapshotPath)) {
      fs.chmodSync(mksnapshotPath, 0o755);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
