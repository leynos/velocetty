# Architectural decision record (ADR) 002: Replace Webpack and Babel with esbuild

## Status

Proposed.

## Date

2026-01-28.

## Context and Problem Statement

The current build pipeline relies on Webpack, Babel, and a collection of
loaders and plugins. This toolchain is flexible, but it brings a large
dependency footprint and slower build times. The project goal is to reduce dev
dependencies and speed up the build process. esbuild is a fast bundler that
supports TypeScript, JSX, and CSS bundling with a smaller dependency surface
and a simpler configuration model.[^esbuild][^esbuild-content]

## Decision Drivers

- Reduce the number of dev dependencies and configuration files.
- Improve build performance and developer feedback loops.[^esbuild]
- Maintain support for TypeScript, JSX, and CSS assets.[^esbuild]
- Preserve required Electron renderer and main process build outputs.

## Requirements

### Functional requirements

- Bundle TypeScript and JSX for renderer and app entry points.
- Support CSS and static asset pipelines currently handled via loaders.
- Preserve source maps for debugging in development builds.

### Technical requirements

- Keep the build system maintainable and well documented.
- Avoid unnecessary runtime dependencies in production artefacts.

## Options Considered

### Option A: Keep Webpack + Babel

Webpack provides a mature loader ecosystem for complex build steps and custom
transforms.[^webpack-loaders] Babel offers fine-grained control over JavaScript
and JSX transforms.[^babel-react] However, the combined dependency and
configuration overhead is high.

### Option B: Replace with esbuild

esbuild includes built-in TypeScript and JSX support and can bundle CSS
alongside JavaScript.[^esbuild][^esbuild-content] It also provides a plugin API
through its JavaScript build interface for custom transforms.[^esbuild-plugins]
This may require re-implementing some Webpack loader behaviour as plugins.

### Option C: Hybrid (Webpack with esbuild-loader)

This approach can improve build speeds while keeping the Webpack ecosystem, but
it retains a large dependency footprint and complex configuration surface. It
also preserves Babel in some pipelines.

| Topic | Webpack + Babel | esbuild |
| --- | --- | --- |
| Performance | Slower builds for large graphs | Designed for speed[^esbuild] |
| Dependency footprint | High (loaders, plugins, Babel) | Lower (single tool) |
| Loader ecosystem | Extensive[^webpack-loaders] | Plugins via JS API[^esbuild-plugins] |
| CSS handling | Via loaders | Built-in CSS bundling[^esbuild-content] |
| TypeScript | Via loader + Babel | Built-in[^esbuild] |

_Table 1: Trade-offs between Webpack/Babel and esbuild._

## Decision Outcome / Proposed Direction

Adopt esbuild as the primary bundler, replacing Webpack and Babel where
feature parity can be achieved. The recommended direction is a phased
migration, starting with renderer builds and expanding to the full pipeline
once plugin and asset handling are validated.

## Goals and Non-Goals

### Goals

- Lower the dependency count by removing redundant build tooling.
- Achieve faster development builds and production bundles.[^esbuild]
- Simplify build configuration with fewer moving parts.

### Non-Goals

- Re-implement every Webpack plugin behaviour if it is not essential.
- Introduce another bundler as a stop-gap.

## Migration Plan

### Phase 1: Capability audit

- Catalogue current Webpack loaders and Babel plugins.
- Identify any transforms that rely on Webpack-specific behaviour.

### Phase 2: Renderer migration

- Build renderer entry points with esbuild.
- Validate CSS and static asset handling.

### Phase 3: Full pipeline

- Migrate remaining build steps and remove Webpack and Babel dependencies.
- Update CI and documentation to reflect the new build flow.

## Known Risks and Limitations

- esbuild plugins may be required for complex loader behaviour.
- Some Babel or Webpack transforms may need alternative solutions or be
  rewritten.

## Outstanding Decisions

- Whether to keep a minimal Babel step for any legacy transforms.
- How to model any remaining loader-specific behaviour in esbuild.

## Architectural Rationale

A single, high-performance bundler reduces tooling complexity, aligns with the
project's dependency reduction goals, and supports faster iteration without
sacrificing TypeScript or JSX support.[^esbuild]

[^esbuild]: <https://esbuild.github.io/>
[^esbuild-content]: <https://esbuild.github.io/content-types/>
[^esbuild-plugins]: <https://esbuild.github.io/plugins/>
[^webpack-loaders]: <https://webpack.js.org/concepts/loaders/>
[^babel-react]: <https://babeljs.io/docs/babel-preset-react>
