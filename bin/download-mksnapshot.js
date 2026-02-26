import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {downloadArtifact} from '@electron/get';
import extractZip from 'extract-zip';

import {normaliseArch} from './shared/arch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RETRIABLE_DOWNLOAD_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'ENETUNREACH'
]);

const RETRIABLE_DOWNLOAD_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 521, 522, 524]);

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error) {
  return error?.code ?? error?.cause?.code;
}

function getStatusCode(error) {
  const statusCode = error?.response?.statusCode ?? error?.statusCode;
  return Number.isInteger(statusCode) ? statusCode : undefined;
}

function isRetriableDownloadError(error) {
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined && RETRIABLE_DOWNLOAD_STATUS_CODES.has(statusCode)) {
    return true;
  }

  const code = getErrorCode(error);
  return code !== undefined && RETRIABLE_DOWNLOAD_ERROR_CODES.has(code);
}

function describeDownloadError(error) {
  const code = getErrorCode(error);
  const statusCode = getStatusCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const statusPart = statusCode !== undefined ? `status=${statusCode}` : undefined;
  const codePart = code !== undefined ? `code=${code}` : undefined;
  return [statusPart, codePart, message].filter(Boolean).join(' ');
}

function shouldRetryDownload(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) {
    return false;
  }

  return isRetriableDownloadError(error);
}

function calculateRetryDelay(attempt, baseDelayMs) {
  return baseDelayMs * 2 ** (attempt - 1);
}

async function downloadArtifactWithRetry(options) {
  const maxAttempts = parsePositiveInteger(process.env.MKSNAPSHOT_DOWNLOAD_RETRY_ATTEMPTS, 4);
  const baseDelayMs = parsePositiveInteger(process.env.MKSNAPSHOT_DOWNLOAD_RETRY_DELAY_MS, 1000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await downloadArtifact(options);
    } catch (error) {
      if (!shouldRetryDownload(error, attempt, maxAttempts)) {
        throw error;
      }

      const delayMs = calculateRetryDelay(attempt, baseDelayMs);
      console.warn(
        `Retrying mksnapshot download after transient failure ` +
          `(attempt ${attempt}/${maxAttempts}, delay ${delayMs}ms): ${describeDownloadError(error)}`
      );
      await sleep(delayMs);
    }
  }

  throw new Error('Unexpected mksnapshot download retry state.');
}

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

function parseDownloadConfig() {
  const platform = process.env.npm_config_platform || process.platform;
  const arch = normaliseArch(process.env.npm_config_arch || process.arch);
  const downloadArch = arch.startsWith('arm') && platform !== 'darwin' ? `${arch}-x64` : arch;
  const strictSslEnv = process.env.npm_config_strict_ssl;
  // npm's strict-ssl defaults to true; only disable verification explicitly.
  const rejectUnauthorized = strictSslEnv !== 'false';

  return {platform, arch, downloadArch, rejectUnauthorized};
}

function resolveTargetFolder() {
  const targetFolder = path.resolve(__dirname, '..', 'node_modules', 'electron-mksnapshot', 'bin');
  if (!fs.existsSync(path.dirname(targetFolder))) {
    throw new Error('electron-mksnapshot is not installed. Run bun install first.');
  }

  return targetFolder;
}

function makeExecutable(targetFolder, platform) {
  if (platform !== 'win32') {
    const mksnapshotPath = path.join(targetFolder, 'mksnapshot');
    if (fs.existsSync(mksnapshotPath)) {
      fs.chmodSync(mksnapshotPath, 0o755);
    }
  }
}

async function main() {
  const version = resolveElectronVersion();
  if (!version) {
    throw new Error('Electron version not found. Set ELECTRON_CUSTOM_VERSION.');
  }

  const {platform, downloadArch, rejectUnauthorized} = parseDownloadConfig();

  const targetFolder = resolveTargetFolder();

  fs.mkdirSync(targetFolder, {recursive: true});

  const zipPath = await downloadArtifactWithRetry({
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

  makeExecutable(targetFolder, platform);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
