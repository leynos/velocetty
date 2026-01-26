const childProcess = require('child_process');

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

function resolveTargetArchitectures() {
  const hostArch = normaliseArch(process.arch);
  const isLinuxArmHost = process.platform === 'linux' && hostArch === 'arm64';

  return isLinuxArmHost ? ['arm64'] : ['x64', 'arm64'];
}

function runSnapshotForArch(arch) {
  console.log(`Generating V8 snapshots for ${arch}...`);
  const result = childProcess.spawnSync('bun', ['run', 'v8-snapshot:arch'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_arch: arch
    }
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const arch of resolveTargetArchitectures()) {
  runSnapshotForArch(arch);
}
