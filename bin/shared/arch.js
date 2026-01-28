const DEFAULT_ARCH = 'x64';
const ARCH_ALIASES = new Map([
  ['aarch64', 'arm64'],
  ['amd64', 'x64']
]);

/**
 * Normalises architecture aliases to Electron-supported values.
 * Supports the mappings aarch64 → arm64 and amd64 → x64.
 * @param {string | undefined} arch - The raw architecture string.
 * @returns {string} The normalised architecture.
 */
export const normaliseArch = (arch) => {
  if (!arch) {
    return DEFAULT_ARCH;
  }

  return ARCH_ALIASES.get(arch) ?? arch;
};
