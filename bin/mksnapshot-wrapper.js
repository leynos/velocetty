#!/usr/bin/env node

const fs = require('fs');
const fsExtra = require('fs-extra');
const {spawnSync} = require('child_process');
const path = require('path');
const temp = require('temp').track();
const {normaliseArch} = require('./shared/arch');

const crossArchDirs = ['clang_x86_v8_arm', 'clang_x64_v8_arm64', 'win_clang_x64'];
const workingDir = temp.mkdirSync('mksnapshot-workdir');
const mksnapshotDir = path.join(__dirname, '..', 'node_modules', 'electron-mksnapshot', 'bin');

function getBinaryPath(binary, binaryPath) {
  if (process.platform === 'win32') {
    return path.join(binaryPath, `${binary}.exe`);
  }

  return path.join(binaryPath, binary);
}

function isElfX86_64(binaryPath) {
  let fd;
  try {
    const header = Buffer.alloc(20);
    fd = fs.openSync(binaryPath, 'r');
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (bytesRead < header.length) {
      return false;
    }

    if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
      return false;
    }

    const machine = header.readUInt16LE(18);
    return machine === 0x3e;
  } catch (error) {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {
        // Ignore close errors for best-effort detection.
      }
    }
  }
}

function findExecutableInPath(names) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const entry of pathEntries) {
      const candidate = path.join(entry, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (error) {
        continue;
      }
    }
  }

  return null;
}

function hasLoader(sysroot) {
  if (!sysroot) {
    return false;
  }

  const candidates = [
    path.join(sysroot, 'lib64', 'ld-linux-x86-64.so.2'),
    path.join(sysroot, 'lib', 'ld-linux-x86-64.so.2')
  ];

  return candidates.some((candidate) => fs.existsSync(candidate));
}

function resolveSysroot() {
  const envSysroot = process.env.QEMU_LD_PREFIX || process.env.QEMU_SYSROOT;
  if (envSysroot) {
    return envSysroot;
  }

  const candidates = [
    '/usr/x86_64-linux-gnu',
    '/usr/local/x86_64-linux-gnu',
    '/usr/lib/x86_64-linux-gnu',
    '/lib/x86_64-linux-gnu',
    '/usr/lib64',
    '/lib64'
  ];

  return candidates.find((candidate) => hasLoader(candidate)) || null;
}

function resolveRunner(binaryPath) {
  const hostArch = normaliseArch(process.arch);
  const isLinuxArmHost = process.platform === 'linux' && hostArch === 'arm64';
  if (!isLinuxArmHost || !isElfX86_64(binaryPath)) {
    return {command: binaryPath, prefix: []};
  }

  const runner = findExecutableInPath(['qemu-x86_64', 'qemu-x86_64-static']);
  if (!runner) {
    throw new Error("Linux arm64 hosts need qemu-user (qemu-x86_64) to run Electron's x64 mksnapshot binary.");
  }

  const sysroot = resolveSysroot();
  if (sysroot && !hasLoader(sysroot)) {
    throw new Error(`QEMU sysroot "${sysroot}" does not contain ld-linux-x86-64.so.2.`);
  }

  if (!sysroot && !fs.existsSync('/lib64/ld-linux-x86-64.so.2')) {
    throw new Error(
      'Missing /lib64/ld-linux-x86-64.so.2. Install x86_64 glibc/libstdc++ ' +
        'or set QEMU_LD_PREFIX to a sysroot that contains the loader.'
    );
  }

  return sysroot ? {command: runner, prefix: ['-L', sysroot, binaryPath]} : {command: runner, prefix: [binaryPath]};
}

function spawnWithRunner(binaryPath, args, options) {
  const {command, prefix} = resolveRunner(binaryPath);
  return spawnSync(command, [...prefix, ...args], options);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(
    'Usage: mksnapshot file.js (--output_dir OUTPUT_DIR).  Additional mksnapshot args except for --startup_blob are supported:'
  );
  args.push('--help');
}

const outDirIdx = args.indexOf('--output_dir');
let outputDir = process.cwd();
let mksnapshotArgs = args;
if (outDirIdx > -1) {
  mksnapshotArgs = args.slice(0, outDirIdx);
  if (args.length >= outDirIdx + 2) {
    outputDir = args[outDirIdx + 1];
    if (args.length > outDirIdx + 2) {
      mksnapshotArgs = mksnapshotArgs.concat(args.slice(outDirIdx + 2));
    }
  } else {
    console.log('Error! Output directory argument given but directory not specified.');
    process.exit(1);
  }
}

if (args.includes('--startup_blob')) {
  console.log('--startup_blob argument not supported. Use --output_dir to specify where to output snapshot_blob.bin');
  process.exit(1);
}

fsExtra.ensureDirSync(outputDir);
fsExtra.copySync(mksnapshotDir, workingDir);

const argsFile = path.join(mksnapshotDir, 'mksnapshot_args');
let mksnapshotBinaryDir = workingDir;
if (fs.existsSync(argsFile)) {
  const mksnapshotArgsFile = fs.readFileSync(argsFile, 'utf8');
  const newlineRegEx = /\r\n|\r|\n/g;
  const turboProfileRegEx = /--turbo-profiling/g;
  const builtinsRegEx = /.*builtins-pgo.*/g;
  const mksnapshotArgsFromFile = mksnapshotArgsFile
    .split(newlineRegEx)
    .filter(
      (arg) => !arg.match(newlineRegEx) && !arg.match(turboProfileRegEx) && !arg.match(builtinsRegEx) && arg !== ''
    );
  const mksnapshotBinaryPath = path.parse(mksnapshotArgsFromFile[0]);
  if (mksnapshotBinaryPath.dir) {
    mksnapshotBinaryDir = path.join(workingDir, mksnapshotBinaryPath.dir);
  }
  mksnapshotArgs = mksnapshotArgs.concat(mksnapshotArgsFromFile.slice(1));
} else {
  mksnapshotArgs = mksnapshotArgs.concat(['--startup_blob', 'snapshot_blob.bin']);
  if (!mksnapshotArgs.includes('--turbo_instruction_scheduling')) {
    mksnapshotArgs.push('--turbo_instruction_scheduling');
  }
  if (!fs.existsSync(getBinaryPath('mksnapshot', mksnapshotBinaryDir))) {
    const matchingDir = crossArchDirs.find((crossArchDir) => {
      const candidatePath = path.join(mksnapshotBinaryDir, crossArchDir);
      return fs.existsSync(getBinaryPath('mksnapshot', candidatePath));
    });
    if (matchingDir) {
      mksnapshotBinaryDir = path.join(workingDir, matchingDir);
    } else {
      console.log('ERROR: Could not find mksnapshot');
      process.exit(1);
    }
  }
}

const mksnapshotCommand = getBinaryPath('mksnapshot', mksnapshotBinaryDir);
const mksnapshotProcess = spawnWithRunner(mksnapshotCommand, mksnapshotArgs, {
  cwd: mksnapshotBinaryDir,
  env: process.env,
  stdio: 'inherit'
});

if (mksnapshotProcess.error) {
  console.error(mksnapshotProcess.error);
  process.exit(1);
}

if (mksnapshotProcess.status !== 0) {
  process.exit(mksnapshotProcess.status ?? 1);
}

if (args.includes('--help')) {
  process.exit(0);
}

fsExtra.ensureDirSync(outputDir);
fs.copyFileSync(path.join(mksnapshotBinaryDir, 'snapshot_blob.bin'), path.join(outputDir, 'snapshot_blob.bin'));

const v8ContextGenCommand = getBinaryPath('v8_context_snapshot_generator', mksnapshotBinaryDir);
let v8ContextFile = 'v8_context_snapshot.bin';
if (process.platform === 'darwin') {
  const targetArch = normaliseArch(process.env.npm_config_arch || process.arch);
  v8ContextFile = targetArch === 'arm64' ? 'v8_context_snapshot.arm64.bin' : 'v8_context_snapshot.x86_64.bin';
}

const v8ContextGenArgs = [`--output_file=${path.join(outputDir, v8ContextFile)}`];
const v8ContextGenProcess = spawnWithRunner(v8ContextGenCommand, v8ContextGenArgs, {
  cwd: mksnapshotBinaryDir,
  env: process.env,
  stdio: 'inherit'
});

if (v8ContextGenProcess.error) {
  console.error(v8ContextGenProcess.error);
  process.exit(1);
}

if (v8ContextGenProcess.status !== 0) {
  console.log('Error running the v8 context snapshot generator.', v8ContextGenProcess.status);
  process.exit(v8ContextGenProcess.status ?? 1);
}
