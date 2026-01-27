const DEFAULT_ARCH = 'x64';

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
