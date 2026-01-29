import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {downloadArtifact} from '@electron/get';
import extractZip from 'extract-zip';

import {normaliseArch} from './shared/arch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveElectronVersion() {
  if (process.env.ELECTRON_CUSTOM_VERSION) {
    return process.env.ELECTRON_CUSTOM_VERSION;
  }

  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  const electronVersion = packageJson.devDependencies?.electron;
  if (!electronVersion) {
    return undefined;
  }

  return electronVersion.replace(/^[~^]/, '');
}

async function main() {
  const version = resolveElectronVersion();
  if (!version) {
    throw new Error('Electron version not found. Set ELECTRON_CUSTOM_VERSION.');
  }

  const platform = process.env.npm_config_platform || process.platform;
  const arch = normaliseArch(process.env.npm_config_arch || process.arch);
  const downloadArch = arch.startsWith('arm') && platform !== 'darwin' ? `${arch}-x64` : arch;
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
    downloadOptions: {
      quiet: !['info', 'verbose', 'silly', 'http'].includes(process.env.npm_config_loglevel)
    }
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
