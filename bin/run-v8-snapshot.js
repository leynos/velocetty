const childProcess = require('child_process');
const {normaliseArch} = require('./shared/arch');

function resolveTargetArchitectures() {
  const hostArch = normaliseArch(process.arch);
  const isArm64Host = hostArch === 'arm64';
  // Non-Linux arm64 hosts often lack a reliable x64 runner for mksnapshot.
  const canRunX64Snapshots = !isArm64Host || process.platform === 'linux';

  return canRunX64Snapshots ? ['x64', 'arm64'] : ['arm64'];
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
