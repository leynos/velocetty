# Architectural decision record (ADR) 006: Oxlint plug-in strategy

## Status

Accepted.

## Date

2026-10-20

## Context and problem statement

Biome provides formatting and general lint checks. The repository also has
package-boundary checks, but it does not run Oxlint. The requested Unicorn and
`ai-deslop` rule sets add syntax-aware checks for correctness, maintainability,
and evidence at TypeScript boundaries.

The rule set must be stable across installs, work alongside Biome, and preserve
documented configuration and session contracts. Oxlint's JavaScript plug-in
interface is marked alpha, so compatible tool versions must be pinned and the
enabled rules must be reviewable.

## Decision drivers

- Keep Biome as the formatter and owner of its existing general lint rules.
- Run the recommended Unicorn and `ai-deslop` rules in the existing lint gate.
- Pin the linter, JavaScript plug-in, and type-aware backend.
- Preserve documented behaviour where a style rule conflicts with a contract.
- Prefer Unicorn when a Unicorn rule conflicts with a Deslop rule.

## Decision outcome

Install Oxlint and its type-aware backend at exact versions. Enable the
built-in Unicorn plug-in and the `ai-deslop` JavaScript plug-in. `unicorn`
ships with Oxlint, so its version is fixed by the Oxlint pin.

| Component         | Version    | Role                                |
| ----------------- | ---------- | ----------------------------------- |
| `oxlint`          | `1.82.0`   | Linter and built-in Unicorn plug-in |
| `ai-deslop`       | `0.4.8`    | Recommended Deslop JavaScript rules |
| `oxlint-tsgolint` | `7.0.2004` | Type-aware lint backend             |

Table 1: exact versions in `package.json` and `bun.lock`.

Bun is pinned to `1.4.3` in `package.json`, following the requested 1.4.x
toolchain. The lockfile was regenerated with that version.

Every supported rule in Oxlint's Unicorn recommended profile and every rule in
the `ai-deslop` recommended profile is listed explicitly in
[`.oxlintrc.json](../.oxlintrc.json). Oxlint's accumulating-spread rule is also
enabled as recommended by Deslop. All Oxlint categories are off, so an upstream
category change cannot silently add or remove rules. Type-aware analysis is
enabled for the recommended rules that require it.

The Deslop `no-runtime-typeof` rule permits checks inside named type guards.
Those guards establish a reusable parser contract; checks outside them still
need to decode input at its I/O boundary. Type-aware analysis is enabled for
the Deslop rules that inspect TypeScript types. The root and app configs use
TypeScript 7-compatible path and module-resolution settings. The root config
also enables `strictNullChecks`, which the recommended
`typescript/no-unnecessary-condition` rule requires; the dedicated typecheck
config keeps its existing strictness settings.

`make lint` runs Oxlint after Biome and the package-boundary check. Biome keeps
its current responsibilities and settings. The new configuration introduces no
overrides for Biome rules or TypeDoc output.

## Disabled rule

Three rules are disabled globally for documented contract or plug-in conflicts:

- `unicorn/no-null`: the configuration layering contract says an explicit
  `null` resets a value, and the public session and configuration types include
  nullable values. Replacing these values with `undefined` would change
  configuration merging or serialized messages. See the
  [layering contract](../app/config/layering.ts#L48), [session types](../shared/src/types/common.ts#L40),
  and [configuration types](../shared/src/types/config.ts#L56).
- `deslop/no-unknown-parameters`: the transport guidance requires untrusted IPC
  responses to enter the transport boundary as `unknown` and be validated with
  Zod before reaching application code. This rule rejects that required
  boundary parameter type. See
  [transport abstraction practice](developers-guide.md#transport-abstraction-practice).
- `deslop/no-reflect-apply`: this directly conflicts with
  `unicorn/prefer-reflect-apply`; the Unicorn rule takes precedence.

`unicorn/prefer-event-target` remains enabled except at the specific Node
event-emitter integration points. The Linux updater implements Electron's
`AutoUpdater` API, `Session` is passed to the existing session-class plug-in
hook, and the RPC bridges expose the shared `TypedEmitter` contract using
Node's synchronous emitter semantics. The RPC server test double also models
Electron's `WebContents` emitter. These sites carry inline explanations; the
rule remains active for other code.

`unicorn/number-literal-case` is disabled only for two files because Biome's
existing formatter writes hexadecimal digits in lowercase, while this rule
requires uppercase digits. The conflict is limited to
[the ELF header checks](../bin/mksnapshot-wrapper.js#L40) and
[the Unicode escape bound](../app/runtime/plugin-runtime-json5-parser.ts#L331).

The snapshot loader models module exports as `SnapshotModuleExport` and module
definitions using the `electron-link` callback contract, so its dynamic module
cache retains a concrete type without widening exports to `unknown`. The
snapshot bootstrap requirement is recorded in the
[esbuild migration ADR](adr-002-replace-webpack-babel-with-esbuild.md#required-plugin-and-bespoke-transform-analysis).

When a construct is reported by both plug-ins, its implementation must satisfy
both rules; if their preferred forms conflict, the Unicorn form takes
precedence. `deslop/no-reflect-apply` is the current mutually exclusive pair.

`bin/rimraf-standalone.js` is a generated vendored script and remains excluded
from both Biome and Oxlint. Its source is maintained by the `rimraf` package.

## Known risks and limitations

- Oxlint's JavaScript plug-in interface is alpha. The exact pins keep the
  current configuration reproducible; upgrades require rerunning the lint and
  typecheck gates.
- `ai-deslop` brings `@oxlint/plugins` as a runtime dependency. Its compatible
  version is recorded in `bun.lock` and is upgraded with the plug-in.
- The recommended rules may expose existing code that needs a real correction.
  New global disables require a documented conflict with project guidance,
  Biome, TypeDoc, or the other plug-in.

## References

- [Developers' guide: formatting and linting](developers-guide.md#formatting-and-linting)
- [Oxlint plug-ins](https://oxc.rs/docs/guide/usage/linter/plugins.html)
- [`ai-deslop`](https://github.com/maharshi365/deslop)
- [Model pull request](https://github.com/leynos/simulacat-core/pull/121)
