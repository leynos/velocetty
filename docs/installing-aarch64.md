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

## Option A: Container-backed sysroot (recommended)

This is the simplest way to obtain a working x86_64 sysroot on Fedora aarch64.

```bash
mkdir -p /tmp/x86_64-sysroot
podman pull --arch x86_64 fedora:40
podman create --arch x86_64 --name fedora-x64 fedora:40
podman export fedora-x64 | tar -C /tmp/x86_64-sysroot -xf -
podman rm fedora-x64
export QEMU_LD_PREFIX=/tmp/x86_64-sysroot
```

Verify the loader exists:

```bash
ls /tmp/x86_64-sysroot/lib64/ld-linux-x86-64.so.2
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

This project uses `bunx webpack-cli` inside scripts. Running `webpack`
directly can trigger an interactive npm install that fails on aarch64.
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

### `CLI for webpack must be installed`

Do not run `webpack` directly on aarch64. Use the Bun scripts instead:

```bash
bun run build:hyper-app
```

### TypeScript errors inside `node_modules`

If `tsc --build --watch` reports errors from `@types/node` or other
dependencies, ensure the dependencies are up to date and that `skipLibCheck`
is enabled in `tsconfig.base.json`.

### `Invalid header: Does not start with Cr24`

This comes from `electron-devtools-installer` failing to download CRX files on
Linux arm64. The app now logs a warning and continues to open.
