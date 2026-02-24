import {spawnSync} from 'node:child_process';

import {normaliseArch} from './shared/arch.js';

function shouldSkipAllSnapshots() {
  return process.env.SKIP_V8_SNAPSHOT === '1';
}

function resolveTargetArchitectures() {
  const hostArch = normaliseArch(process.arch);
  const isArm64Host = hostArch === 'arm64';
  const skipX64Snapshot = process.env.SKIP_X64_V8_SNAPSHOT === '1';
  // x64 Linux hosts rely on Electron's cross-arch mksnapshot artifact
  // (`clang_x64_v8_arm64`) to build arm64 snapshots in CI.
  // Non-Linux arm64 hosts often lack a reliable x64 runner for mksnapshot.
  const canRunX64Snapshots = !isArm64Host || process.platform === 'linux';

  return canRunX64Snapshots && !skipX64Snapshot ? ['x64', 'arm64'] : ['arm64'];
}

function runSnapshotForArch(arch) {
  console.log(`Generating V8 snapshots for ${arch}...`);
  const result = spawnSync('bun', ['run', 'v8-snapshot:arch'], {
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

if (shouldSkipAllSnapshots()) {
  console.log('Skipping V8 snapshot generation because SKIP_V8_SNAPSHOT=1.');
  process.exit(0);
}

const targetArchitectures = resolveTargetArchitectures();
if (targetArchitectures.length === 0) {
  console.log('Skipping V8 snapshot generation because no target architecture is enabled.');
  process.exit(0);
}

for (const arch of targetArchitectures) {
  runSnapshotForArch(arch);
}
