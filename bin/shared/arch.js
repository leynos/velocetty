const DEFAULT_ARCH = 'x64';

/**
 * Normalises architecture aliases to Electron-supported values.
 * Supports the mappings aarch64 → arm64 and amd64 → x64.
 * @param {string | undefined} arch - The raw architecture string.
 * @returns {string} The normalised architecture.
 */
function normaliseArch(arch) {
  if (!arch) {
    return DEFAULT_ARCH;
  }

  if (arch === 'aarch64') {
    return 'arm64';
  }

  if (arch === 'amd64') {
    return 'x64';
  }

  return arch;
}

module.exports = {normaliseArch};
