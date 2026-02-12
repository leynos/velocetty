# Tracking issues

## BIOME-001 Re-enable Biome legacy rules

Status: Open  
Owner: TBD  
Last updated: 2026-01-28  
Issue: [#24](https://github.com/leynos/velocetty/issues/24)

### BIOME-001 summary

- Re-enable Biome rules currently disabled for legacy code:
  `noExplicitAny`, `noNonNullAssertion`, `useNodejsImportProtocol`,
  `useExhaustiveDependencies`, and the accessibility (a11y) rule set.
- Record each rule's enablement date in
  `docs/velocetty-hyper-codebase.md`.

### BIOME-001 exit criteria

- All targeted rules are enabled with no new lint violations.
- Roadmap item 1.4.8 is complete.

## BOUNDARY-001 Parse CommonJS imports in package boundary checks

Status: Open  
Owner: TBD  
Last updated: 2026-02-12  
Issue: [#23](https://github.com/leynos/velocetty/issues/23)

### BOUNDARY-001 summary

- Extend `scripts/check-package-boundaries.mjs` to detect boundary violations in
  CommonJS `require(...)` usage as well as ECMAScript modules (ESM)
  `import`/`export` forms.
- Prefer Abstract Syntax Tree (AST)-based parsing over regex-only
  matching so alias, relative, dynamic, and CommonJS import forms are
  evaluated consistently.
- Add targeted unit tests for the checker to prevent regressions in import
  detection logic.

### BOUNDARY-001 exit criteria

- `bun run check:boundaries` fails on disallowed cross-layer imports using
  `require(...)`.
- Checker tests cover alias, relative, dynamic import, and CommonJS paths.
- `make lint` and `make test` remain green with the stronger guardrail.

## CONTRACT-001 Decouple schema generation from legacy typings source

Status: Open  
Owner: TBD  
Last updated: 2026-02-12  
Issue: [#22](https://github.com/leynos/velocetty/issues/22)

### CONTRACT-001 summary

- Move the schema generation source of truth to `shared/src/types/config.ts`
  and remove reliance on `typings/config.d.ts` as generator input.
- Keep `typings/` exports as compatibility shims only during migration.
- Preserve runtime compatibility by continuing to sync generated schema output
  to `app/config/schema.json` until downstream runtime consumers are migrated.

### CONTRACT-001 exit criteria

- `bun run generate-schema` reads source types from `shared/` directly.
- `typings/config.d.ts` is no longer part of schema generation inputs.
- Generated schema remains identical for runtime consumers and all gates pass.

## CONFIG-001 Support hot-reload for WebGL renderer setting

Status: Open  
Owner: TBD  
Last updated: 2026-02-12

### CONFIG-001 summary

- Remove the current requirement to restart terminal sessions after changing
  `webGLRenderer`.
- Apply renderer-setting changes to existing sessions without reopening tabs.
- Preserve fallback behavior when WebGL contexts are unavailable.

### CONFIG-001 exit criteria

- Changing `webGLRenderer` takes effect for active sessions without restart.
- Unit or integration tests cover hot-reload behavior and fallback handling.
- `make lint` and `make test` remain green.
