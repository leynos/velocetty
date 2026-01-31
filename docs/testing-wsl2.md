# Testing in WSL2

This guide covers running the end-to-end smoke tests in Windows Subsystem for
Linux 2 (WSL2). These tests launch the packaged Electron binary, so they require
an X server. WSL2 does not provide one by default, so use Xvfb unless you have a
separate X server configured.

## Prerequisites

- Bun installed and available on your PATH.
- A successful build output in `dist/`, produced by:

```bash
bun run build && bun bin/run-electron-builder.cjs
```

## E2E dependencies on Fedora (WSL2)

Install the X server and X authority tools:

```bash
sudo dnf install -y xorg-x11-server-Xvfb xorg-x11-xauth
```

If Electron fails to launch due to missing system libraries, install the
standard GTK and audio runtime dependencies for your Fedora release.

## E2E dependencies on Ubuntu (WSL2)

Install Xvfb, X authority, and Electron runtime libraries:

```bash
sudo apt-get update
sudo apt-get install -y \
  xvfb \
  xauth \
  libasound2 \
  libatk-bridge2.0-0 \
  libatspi2.0-0 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxshmfence1 \
  libxss1
```

## Running E2E tests under Xvfb

Run the end-to-end tests under a virtual display:

```bash
xvfb-run --auto-servernum bun run test:e2e
```

If you already run an X server in WSL2 and have `DISPLAY` configured, you can
run:

```bash
bun run test:e2e
```

If Electron still fails to launch, confirm the packaged binary exists at
`dist/linux-unpacked/hyper` and that the runtime libraries listed above are
installed.
