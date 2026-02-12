const DEFAULT_ARCH = 'x64';
const ARCH_ALIASES = new Map([
  ['aarch64', 'arm64'],
  ['amd64', 'x64']
]);
const SUPPORTED_SNAPSHOT_ARCHITECTURES = new Set(['x64', 'arm64']);

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

  return ARCH_ALIASES.get(arch) ?? arch;
}

/**
 * Normalises and validates architectures used for snapshot assets.
 * @param {unknown} arch - The raw architecture value.
 * @param {string} sourceLabel - Description of the architecture source.
 * @returns {string} The validated snapshot architecture.
 */
function normaliseSnapshotArch(arch, sourceLabel) {
  if (typeof arch !== 'string' || arch.length === 0) {
    throw new Error(`Expected a string architecture from ${sourceLabel}, received "${String(arch)}".`);
  }

  const normalisedArch = normaliseArch(arch);
  if (normalisedArch === 'arm') {
    throw new Error('Unsupported architecture "arm". Snapshot artifacts are available only for x64 and arm64.');
  }

  if (SUPPORTED_SNAPSHOT_ARCHITECTURES.has(normalisedArch)) {
    return normalisedArch;
  }

  throw new Error(
    `Unsupported architecture "${arch}" from ${sourceLabel}. ` +
      `Supported values: ${Array.from(SUPPORTED_SNAPSHOT_ARCHITECTURES).join(', ')}.`
  );
}

module.exports = {
  normaliseArch,
  normaliseSnapshotArch,
  SUPPORTED_SNAPSHOT_ARCHITECTURES
};
