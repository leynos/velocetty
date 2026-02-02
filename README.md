# Velocetty

A modern, extensible terminal built on open web standards.

Velocetty is a fork of [Hyper][hyper] by Vercel, extending the original
vision with a command-driven architecture, improved rendering performance,
and a robust plugin system.

## Project status

Velocetty is under active development. The current roadmap focuses on:

### Core scaffolding

- Repository restructuring into `frontend/`, `backend/`, and `shared/` packages
- Transport abstraction layer for host migration (Electron to Tauri)
- Command primitives, registry, and context key engine

### Rendering overhaul

- Visible-only WebGL rendering with context pooling
- Context-loss recovery and Canvas fallbacks
- Performance instrumentation and baselines

### Configuration system

- JSON5 configuration with schema validation and hot-reload
- Layered settings (defaults, user config, runtime overrides)
- Keybindings storage with export/import support

### Command system and UI

- Command dispatcher with schema validation and cancellation
- Keybinding engine with chord support and conflict detection
- Command palette with fuzzy search and category grouping

### Plugin architecture

- Schema-driven plugin settings panels
- Tab decoration API with slot-based providers
- Golden path example plugin

### Host migration

- Backend abstraction layer shared by Electron and Tauri
- Rust PTY manager for Tauri builds
- Cross-platform packaging and update strategy

### Remote frontend

- Protobuf/WebSocket protocol for remote connections
- Authentication, capability negotiation, and redaction
- Browser-based terminal UI

For full details, see [docs/roadmap.md][roadmap].

## Usage

Velocetty is not yet available for general use. Development builds can be
created by following the contribution instructions below.

## Contribute

Bun is required for local development. Install it from [Bun][bun].

1. Install platform-specific packages:
   - **Windows**: Run `bun add -g windows-build-tools` from an elevated
     prompt.
   - **macOS**: No additional packages required.
   - **Linux (RPM-based)**: `GraphicsMagick`, `libicns-utils`, `xz`.
   - **Linux (Debian-based)**: `graphicsmagick`, `icnsutils`, `xz-utils`.
2. Fork and clone the repository.
3. Install dependencies: `bun install`.
4. Build and watch for changes: `bun run dev`.
5. Run the app: `bun run app` (from another terminal).

To generate distribution binaries:

```bash
bun run dist
```

Binaries will appear in the `./dist` folder.

### Known issues

- **node-pty build errors**: Run `bun run rebuild-node-pty`.
- **C++ errors on macOS**: Set `export CXX=clang++`.
- **codesign errors on macOS**: Set `export CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Acknowledgements

Velocetty is a fork of [Hyper][hyper], originally created by
[Vercel][vercel]. We are grateful for their work in building a beautiful,
extensible terminal experience.

## Licence

MIT Licence - see [LICENSE](LICENSE) for details.

Copyright (c) 2018 Vercel, Inc.

[bun]: https://bun.sh/
[hyper]: https://github.com/vercel/hyper
[roadmap]: docs/roadmap.md
[vercel]: https://vercel.com
