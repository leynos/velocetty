# Installing on aarch64 Linux

This guide covers the extra steps needed to build V8 snapshots on aarch64
Linux. The main build is supported, but Electron only ships x86_64
`mksnapshot` binaries for Linux. To run those binaries on aarch64, the build
requires QEMU user emulation plus an x86_64 sysroot.

## Prerequisites

- QEMU user emulation providing `qemu-x86_64` in the `PATH`.
- An x86_64 sysroot that contains the dynamic loader and standard C++ runtime.

On Fedora aarch64, the default repositories do not provide x86_64 runtime
packages, so a sysroot must be supplied separately.

## Option A: Package-backed sysroot (recommended for CI)

On Ubuntu/Debian hosts, install amd64 runtime libraries directly into the
multiarch rootfs:

```bash
sudo dpkg --add-architecture amd64
cat <<'EOF' | sudo tee /tmp/velocetty-aarch64-bootstrap.sources.list >/dev/null
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-security main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy-updates main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy-backports main restricted universe multiverse
deb [arch=amd64] http://security.ubuntu.com/ubuntu jammy-security main restricted universe multiverse
EOF
sudo apt-get \
  -o Dir::Etc::sourcelist=/tmp/velocetty-aarch64-bootstrap.sources.list \
  -o Dir::Etc::sourceparts=- \
  update
sudo apt-get \
  -o Dir::Etc::sourcelist=/tmp/velocetty-aarch64-bootstrap.sources.list \
  -o Dir::Etc::sourceparts=- \
  install -y --no-install-recommends \
  qemu-user-static \
  libc6:amd64 \
  libstdc++6:amd64 \
  libgcc-s1:amd64 \
  libglib2.0-0:amd64 \
  libexpat1:amd64 \
  libpcre2-8-0:amd64 \
  libarchive-tools
export QEMU_LD_PREFIX=/
```

Verify the emulator and loader:

```bash
test -x /usr/bin/qemu-x86_64-static
ls /lib64/ld-linux-x86-64.so.2
```

## Option B: Container-backed sysroot (Fedora fallback)

If cross-runtime packages are unavailable, export an x86_64 rootfs and point
`QEMU_LD_PREFIX` to it:

```bash
mkdir -p /tmp/x86_64-sysroot
podman pull --arch x86_64 fedora:40
podman create --arch x86_64 --name fedora-x64 fedora:40
podman export fedora-x64 | tar -C /tmp/x86_64-sysroot -xf -
podman rm fedora-x64
export QEMU_LD_PREFIX=/tmp/x86_64-sysroot
```

## Run the snapshot step

Once QEMU and the sysroot are available, generate the snapshot:

```bash
bun run mk-snapshot
```

For the full postinstall chain, run:

```bash
bun run postinstall
```

For Linux aarch64 lanes that package only arm64 artefacts, set
`SKIP_X64_V8_SNAPSHOT=1` during `bun install` to skip the additional x64
snapshot pass:

```bash
SKIP_X64_V8_SNAPSHOT=1 bun install
```

This project uses `bun ./build/esbuild/build.ts` inside scripts for bundling.
Similarly, the rebuild step runs `bun bin/rebuild-node-pty.cjs`, which
executes `node-gyp` from the module directory; avoid calling
`electron-rebuild` directly. The copy step uses `bun bin/copy-node-modules.js`.
Electron-builder is invoked via `bun bin/run-electron-builder.cjs` to avoid
its package-manager detection spawning Bun through Node.
Schema generation uses `bunx typescript-json-schema --ignoreErrors`.
Development scripts also rely on local `electronmon` and `concurrently`
binaries. If either command is not found, run the local entry points:

```bash
bun node_modules/electronmon/bin/cli.js target
bun node_modules/concurrently/dist/bin/concurrently.js --help
```

## Troubleshooting

### `qemu-x86_64: Could not open '/lib64/ld-linux-x86-64.so.2'`

The sysroot is missing the loader, or QEMU is not pointed at it. Ensure the
loader exists and export `QEMU_LD_PREFIX` to the sysroot path.

### `qemu-x86_64` not found

Install QEMU user emulation for the distribution, or ensure the
distribution-provided `qemu-x86_64` binary is on `PATH`.

### `E: Unable to locate package ...:amd64`

Your distribution does not provide Debian multiarch runtime packages. Use
Option B and set `QEMU_LD_PREFIX` to the exported x86_64 sysroot path.

### `404 Not Found` for `.../binary-amd64/Packages` on `ports.ubuntu.com`

The apt source configuration is querying Ubuntu ports for amd64 indexes. Keep
`ports.ubuntu.com` entries for `arm64` only, and add amd64 entries from
`archive.ubuntu.com` plus `security.ubuntu.com`.

### Bundler command errors

Do not run ad hoc bundler binaries directly on aarch64. Use the Bun scripts
instead:

```bash
bun run build:hyper-app
```

### TypeScript errors inside `node_modules`

If `tsgo --build --watch` reports errors from `@types/node` or other
dependencies, ensure the dependencies are up to date and that `skipLibCheck`
is enabled in `tsconfig.base.json`.

### `Invalid header: Does not start with Cr24`

This usually indicates a stale `target/node_modules` tree still using an old
`electron-devtools-installer` build. Refresh app dependencies and retry:

```bash
bun run build:hyper-app
bun bin/run-electron-builder.cjs install-app-deps
```
