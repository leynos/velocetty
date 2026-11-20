# Close post-removal hardening tasks for security and compatibility

This ExecPlan (execution plan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT

Implementation must not begin until this plan is explicitly approved. Under the
recommended answer to decision D-1, the documentation and tracking milestones
(EP-M1 and EP-M2) may then start at once, while every code milestone (EP-M3
onwards) also waits for roadmap item `9.2.4` to be complete.

## Purpose / big picture

Roadmap item `1.4.19` closes the security and compatibility loose ends left
behind when Velocetty removed `styled-jsx` and its Babel bridge (roadmap items
`1.4.16` to `1.4.18`). Two questions remain open.

The first concerns the renderer Content Security Policy (CSP). A CSP is a
browser rule set, delivered here as a
`<meta http-equiv="Content-Security-Policy">` tag in `app/index.html`, that
tells Chromium which scripts and styles the page may run. The current policy is
`script-src 'self' 'unsafe-inline'`. Project documentation
(`docs/velocetty-hyper-codebase.md`) says `'unsafe-inline'` is "required for
styled-jsx CSS-in-JS". `styled-jsx` is gone, so that justification is stale.
This plan establishes what still needs `'unsafe-inline'`, removes it, and
records every remaining blocker to a stricter policy with an owner and a review
trigger.

The second concerns custom CSS compatibility. Users write custom CSS in the
`css` key of their configuration file (globally or per profile), and Hyper-era
theme plugins append CSS through `decorateConfig`. Both commonly target Hyper's
DOM class names, such as `.tab_tab` or `.header_header`. The CSS Modules
migration in `1.4.17` replaced almost all of those names with generated names
such as `tab_tabTab`; only four terminal-pane names survive. That migration's
own constraints said such names would be preserved, and no retirement was
recorded, so roughly 51 names broke silently. Separately, the `termCSS`
configuration key has had no consumer for years and silently does nothing.
Under the product stance ("reuses useful work from Hyper/Vercel where it helps,
without targeting backwards compatibility") these breakages are acceptable, but
only if they are ratified, tracked, and made visible.

After this change, a user or maintainer can observe the following:

1. `app/index.html` ships a policy whose `script-src` has no
   `'unsafe-inline'`, and the application starts with no CSP violation in the
   renderer console. A contract test and an end-to-end (E2E) check prove both,
   and a seeded fault proves the E2E check can fail.
2. A user whose `css` (global or per-profile) targets a retired Hyper class
   name, for example `.tab_tab { color: red; }`, receives one configuration
   warning naming the retired selectors and linking to the users' guide. A
   plugin whose `decorateConfig` CSS does the same is named in its own warning.
   A user with a non-empty `termCSS` is told the key has no effect.
3. `docs/users-guide.md` documents the supported custom CSS selectors, the
   retired Hyper selectors with what to do instead, and the plugin-facing
   security policy.
4. `docs/tracking-issues.md` lists every remaining follow-up with an owner, a
   `Review by` date and event trigger, a mitigation, and a GitHub issue in a
   milestone with that due date.
5. A machine-checked proof shows that the class-token scanner behind the
   warning reports exactly the dot-identifier tokens defined by the lexical
   model in `Verification plan`. That model approximates CSS class selectors;
   ADR-007 documents where it differs.

## Constraints

- Do not start implementation until the plan is approved. Do not start EP-M3
  or later until `9.2.4` is complete, unless the maintainer waives it (D-1).
- Do not add `'unsafe-eval'`, nonces, hashes, or wildcard sources to
  `script-src`. `'wasm-unsafe-eval'` is a separate, narrower keyword and may be
  added only under decision D-8.
- Do not introduce `style-src`, `default-src`, `img-src`, `font-src`, or
  `connect-src` in this item (D-3).
- Do not change `webPreferences` (`nodeIntegration`, `contextIsolation`,
  `sandbox`) in `app/ui/window.ts`, and do not change the `file://` loading
  model in `app/start.ts`. Both are tracked follow-ups.
- Do not restore retired Hyper class names or add new compatibility classes.
  The four retained terminal classes (`term_fit`, `term_term`, `term_active`,
  `term_wrapper`) stay exactly as they are (D-4).
- Do not quote CSS Modules generated names (`<file stem>_<local name>`) in
  user-facing text, the registry, or warnings (D-4).
- Do not change the behaviour of `getDeprecatedCSS` or `htermConfigTranslate`
  in `app/config.ts`.
- `app/` main-process modules may not import runtime values from `@shared/*`:
  the alias is type-only there and fails with `MODULE_NOT_FOUND` in the
  packaged app (`docs/developers-guide.md`, "Use shared imports via TypeScript
  path aliases"). The pure policy modules therefore live in
  `app/config/custom-css/` and must import nothing from Electron, Node, the
  filesystem, or the DOM.
- No source file may exceed 400 lines. `test/e2e/electron.e2e.test.ts` is
  already 541 lines and `test/e2e/electron-e2e-helpers.ts` is 376 lines, so new
  E2E code goes in new files.
- Every new module starts with a `/** @file … */` header, and every field of
  an exported type has a `/** … */` comment, as in
  `shared/src/constants/config-reloadability.ts`.
- Comments and documentation use en-GB-oxendict spelling (`make spelling`).
- Tests must not use module mocking (`deslop/no-module-mocking`); inject
  collaborators instead.
- Use caret ranges for new dependencies and pin GitHub Actions to commit SHAs,
  as `.github/workflows/nodejs.yml` already does.
- Gate order at the end of every code milestone, run sequentially:
  `bun run build:packages`, `bunx tsgo --project app/tsconfig.build.json`,
  `make check-fmt`, `make lint`, `make test`. (`make typecheck` relaxes
  `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; the build
  projects do not.) Milestones that touch Markdown also run `make markdownlint`
  and `make nixie`. From EP-M5 onwards, `make proofs` is also a gate.

## Tolerances (exception triggers)

- Delivery shape: implementation lands as two stacked pull requests. PR A
  covers EP-M1 to EP-M3 and EP-M7 (decisions, tracking, CSP, clean-up). PR B
  covers EP-M4 to EP-M6 and EP-M8 (advisory, proof, documentation, closure).
- Scope: if either PR needs more than 25 non-ExecPlan files, or the whole item
  needs more than 45 files or 3,000 net lines of code and other documentation,
  stop and escalate. This ExecPlan file, `bun.lock`, generated `*.dfy.gen`
  files, and a regenerated `typos.toml` are excluded from both counts.
- Interface: the only pre-authorized interface changes are the new modules
  under `app/config/custom-css/`, an additional optional `retiredHooks` field
  on the `getDeprecatedConfig` record (`shared/src/types/common.ts:192`,
  `lib/transport/ipc-schemas.ts:110`), and the `console-message` listener
  signature in `app/rpc.ts`. Any other exported signature change requires
  escalation.
- Dependencies: pre-authorized are `fast-check` (`^4.10.2`) and `lemmascript`
  (`^0.6.5`) as development dependencies, and `dafny-lang/setup-dafny-action`
  (SHA-pinned) in CI. Anything else requires escalation.
- Security posture: if removing `'unsafe-inline'` breaks start-up in a way
  that moving code into the bundle cannot fix, stop and escalate rather than
  adding hashes or nonces.
- Proof feasibility: if the EP-M5 prototype gate fails, or the full proof does
  not verify after three focused attempts, stop and escalate with the failing
  obligations. Never use `//@ assume` or add an axiom to the `.dfy` file.
- CI cost: if the new `proofs` job takes more than 6 minutes wall-clock, stop
  and escalate.
- Iterations: if a gate still fails after three fix-and-rerun cycles, stop and
  escalate with the failing logs.
- Time: if any milestone takes more than one working day of active effort,
  stop and escalate.
- Ambiguity: if the maintainer's answer to D-1, D-3, D-4, or D-8 differs from
  the recommendation, revise this plan before continuing.

## Risks

- Risk: roadmap `9.2.4` is not done, so the code milestones are blocked.
  Severity: high. Likelihood: certain at the time of writing. Mitigation: D-1
  option (d) lets the decision and tracking work, which is what the success
  criterion measures, land first.
- Risk: renderer console errors may not reach the E2E output at all, because
  `app/rpc.ts:70-75` reads Electron's deprecated positional `level` argument
  and Electron 44's typings only offer `(event, details)`. If `level` is
  `undefined`, `level >= 3` is false and every error is silently dropped, which
  would make any console-based CSP check vacuous. Severity: high. Likelihood:
  medium. Mitigation: EP-M0 runs a seeded CSP fault on the unmodified tree to
  see whether the error appears; EP-M3 moves the listener to
  `details.level === 'error'` with a unit test either way.
- Risk: `'self'` on a `file://` page matches any `file:` URL in Chromium, so
  an injected `<script src="file:///tmp/x.js">` would still be allowed.
  Severity: medium. Likelihood: low (no HTML-injection sink is known).
  Mitigation: the plan does not call the result strict; tracking issue
  `CSP-002` covers serving the renderer from a custom `app://` protocol, as
  Electron's security checklist recommends.
- Risk: sixel image support (`imageSupport` defaults to `true`) may already be
  broken, because `xterm-addon-image` compiles WebAssembly and Chromium blocks
  that when `script-src` has neither `'unsafe-eval'` nor `'wasm-unsafe-eval'`.
  Severity: medium. Likelihood: high. Mitigation: EP-M0 checks; D-8 decides;
  EP-M3 adds a sixel E2E probe.
- Risk: LemmaScript is a technology preview. In `lemmascript@0.6.0`, string
  bracket indexing resolves to `unknown`; only `charCodeAt` is modelled, and
  `unicorn/prefer-code-point` makes `charCodeAt` a lint error. Dafny 4.11
  defaults to Unicode-scalar characters, whereas JavaScript indexes UTF-16 code
  units. Severity: medium. Likelihood: medium. Mitigation: the EP-M5 prototype
  gate tests the scanner's exact idioms and `--unicode-char:false`; one
  justified lint suppression per `charCodeAt` call site is pre-authorized;
  fast-check properties from EP-M4 remain a regression net if the proof stalls;
  EP-M8 closure does not depend on EP-M5 succeeding (see `Tolerances`, proof
  feasibility).
- Risk: the advisory produces false positives (dot-identifier tokens in
  declaration values) or false negatives (attribute selectors on `class`,
  selectors built at runtime). Severity: low; it only warns. Likelihood:
  medium. Mitigation: the lexical model is specified and proved, and the
  residual gaps are documented in ADR-007 and the users' guide.
- Risk: repeated notifications on every configuration save or window load.
  Severity: low. Likelihood: high without care. Mitigation: the reporter
  notifies only when the set of findings changes.
- Risk: review dates lapse unnoticed. Severity: medium. Likelihood: medium.
  Mitigation: every `Review by` names both a date and an event trigger, and the
  GitHub issues sit in a milestone with that due date.

## Progress

- [x] (2026-10-29 17:00Z) Renamed the branch to
  `1-4-19-close-post-removal-hardening-tasks`.
- [x] (2026-10-29 17:20Z) Reconnaissance with a Wyvern team: CSP and style
  injection, plugin and custom CSS compatibility, and test and gate
  infrastructure.
- [x] (2026-10-29 17:40Z) External research on Electron CSP guidance, CSP
  `style-src` semantics, and xterm.js CSP behaviour.
- [x] (2026-10-29 18:10Z) First draft of this ExecPlan.
- [x] (2026-10-29 19:30Z) Community-of-experts review (Electron security,
  verification, TypeScript architecture, product and compatibility) and
  revision. See the revision note.
- [ ] Maintainer approval of the plan and decisions D-1, D-3, D-4, and D-8.
- [ ] EP-M0: baseline evidence, including the seeded CSP visibility check and
  the sixel check.
- [ ] EP-M1: ADR-007 and design-document decisions.
- [ ] EP-M2: tracking issues and the tracking register test.
- [ ] EP-M3: renderer CSP hardening and console forwarding fix.
- [ ] EP-M4: pure scanner, registry, and advisory policy with unit and
  property tests.
- [ ] EP-M5: LemmaScript proof (proof milestone).
- [ ] EP-M6: advisory reporter wiring for user and plugin CSS.
- [ ] EP-M7: compatibility clean-up and supported-hook check.
- [ ] EP-M8: users' guide, developers' guide, corrections, and roadmap
  closure.

## Surprises & discoveries

- Observation: the shipped CSP never restricted styles.
  Evidence: `app/index.html:8` sets only `script-src 'self' 'unsafe-inline'`;
  there is no `style-src` or `default-src`. Impact: `styled-jsx` never needed a
  style exemption; the "inline style transform" constraint in the roadmap is
  really the `script-src 'unsafe-inline'` that the documentation attributed to
  `styled-jsx`.
- Observation: the only consumers of `script-src 'unsafe-inline'` are two
  one-line inline scripts in `app/index.html` (lines 34 and 37) that time
  renderer start-up. Nothing else reads the `start` global. No `eval`,
  `new Function`, or inline event handlers exist in `lib/`, `app/`, `build/`, or
  `shared/`. HMR is not a concern (development uses `esbuild --watch` plus an
  `electronmon` restart), nor is the V8 snapshot (`bin/mk-snapshot.js`).
- Observation: the installed Electron is 44.4.1 (`package.json:123`), not 40
  as older documents say.
- Observation: `app/rpc.ts:70-75` forwards renderer console errors to stdout
  as `[e2e][renderer-error]` using the deprecated positional `level` argument.
  The fast E2E lane's default `spawn` driver depends on this output; the
  Playwright console monitor only runs with `E2E_DRIVER=playwright` and
  attaches after the first window exists.
- Observation: `xterm-addon-image` uses `WebAssembly.Module` and
  `WebAssembly.instantiate` (`node_modules/xterm-addon-image/lib/`), and
  `imageSupport` defaults to `true` (`app/config/config-default.json:64`).
- Observation: `xterm@5.3.0`'s DOM renderer creates `<style>` elements in
  `_injectCss` and the dimensions update, and writes per-cell `style`
  attributes in `_addStyle` with `setAttribute("style", …)`
  (`node_modules/xterm/lib/xterm.js`). Upstream's constructed-stylesheet fix
  (xterm.js PR #4611 for issue #4445) is not in 5.3.0, and the unscoped `xterm`
  packages are deprecated in favour of `@xterm/*` since 5.4.0.
- Observation: user custom CSS reaches the page through
  `<style dangerouslySetInnerHTML={{__html: stylis('#hyper', customCSS)}} />` in
  `lib/containers/hyper.tsx:130`.
- Observation: React `style={…}` props and `element.style.x = …` writes use
  the CSS Object Model (CSSOM) and are not blocked by `style-src`;
  `setAttribute('style', …)`, `style.cssText`, `<style>` elements, and
  `style="…"` markup are (MDN `style-src`, "Violation cases").
- Observation: `termCSS` has no consumer. `lib/containers/terms.ts:27` maps it
  to a prop no component reads, and the pre-migration `StyleSheet` component
  ignored it too (`git show af0dc0e6^:lib/components/style-sheet.tsx`).
- Observation: of about 55 Hyper class names in use before `1.4.17`, only
  `term_fit`, `term_term`, `term_active`, and `term_wrapper` are still emitted.
  `tabs.module.css` keeps a `:global(.tabs_list)` rule, cited in its `@file`
  header and in `docs/developers-guide.md`, but no element carries `tabs_list`.
  The `1.4.17` plan's constraints promised to preserve such names, and its
  decision log records no retirement.
- Observation: `styled-jsx` was never in the plugin module allowlist
  (`lib/utils/plugins.ts:403-437`, `app/plugins.ts:121-153`), so removing it
  from the host did not change plugin module resolution.
- Observation: `app/config.ts` already carries Hyper's precedent for this
  problem: `getDeprecatedCSS` warns about hterm-era selectors and
  `htermConfigTranslate` rewrites some. Detection is a raw substring check.
  `checkDeprecatedConfig` returns early when there are no hterm-era selectors,
  reads only the root configuration, and runs at start-up and on every save.
  Plugin CSS is checked separately by `getDeprecatedConfig` in
  `app/plugins.ts:463-487`, whose result only reaches a renderer `console.warn`
  (`lib/utils/plugins.ts:653-659`).
- Observation: `app/config/schema.json` does not set
  `additionalProperties: false`, so removing a key such as `termCSS` would not
  make old configuration files fail validation.
- Observation: `docs/tracking-issues.md` entries have `Status`, `Owner`,
  `Last updated`, and an optional `Issue`, but no review date.

## Decision log

- D-1 (prerequisite): roadmap `1.4.19` requires `9.2.4`, which is unchecked.
  Options: (a) wait for `9.2.4`, then implement everything; (b) waive the
  dependency; (c) fold `9.2.4` into this item; (d) let EP-M1 and EP-M2 (ADR,
  design, and tracking) proceed on approval and gate EP-M3 onwards on `9.2.4`.
  Recommendation: (d). The dependency partly runs the other way: `9.2.4`'s
  "global selectors" parity checks need D-4's supported-hook list, and ADR-007
  and the tracking entries need nothing from `9.2.4`. Status: awaiting
  maintainer decision. Date/Author: 2026-10-29, planning agent.
- D-2 (script policy): remove `'unsafe-inline'` from `script-src` by moving
  the two inline timing scripts into the renderer bundle, not by allowing them
  with hashes or a nonce. A static `file://` page cannot carry a per-load
  secret nonce, and hashes couple the policy to incidental script text. Add
  `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'`.
  `form-action` matters here because `app/ui/window.ts:78-79,173-178` writes
  http(s) navigation targets into the shell, so an injected form could type an
  attacker's URL at the prompt. Explicitly rejected: `frame-ancestors`,
  `sandbox`, and `report-uri` (ignored in a meta tag, and `frame-ancestors`
  logs an error that would trip the E2E check); `require-trusted-types-for`
  (breaks the custom CSS `<style>` element and plugins); `worker-src` (falls
  back to `script-src`; no workers are used). The result is tighter but not
  strict, because `'self'` on `file://` matches any local file (`CSP-002`). The
  start-up timing log will now measure from navigation start via
  `performance.now()` at the end of the `lib/index.tsx` module body. Date/
  Author: 2026-10-29, planning agent.
- D-3 (style policy): do not add `style-src` in this item. `nodeIntegration`
  raises the stakes of script injection, which is why `script-src` matters; it
  does not by itself lower the value of `style-src`, whose purpose is to limit
  HTML injections that never reach script. Deferral rests on three grounds
  instead. First, no HTML-injection sink is known: React escapes text, xterm
  renders terminal output as text, and the remote news message is rendered as
  text. Second, `style-src` alone would not close CSS exfiltration, because
  `img-src`, `font-src`, and `connect-src` stay open and user CSS legitimately
  uses `url()`. Third, the blockers are real: the inline base `<style>` in
  `app/index.html`; the custom CSS `<style>` element in
  `lib/containers/hyper.tsx`; the `xterm@5.3.0` DOM renderer's `<style>`
  elements and per-cell `style` attributes; and third-party plugins that render
  `<style>` elements or `style="…"` markup. Plugins can also rewrite
  `webPreferences` through `decorateBrowserOptions` (`app/plugins.ts:521`).
  Track as `CSP-001` and `XTERM-001`. Status: recommended; needs maintainer
  confirmation. Date/Author: 2026-10-29, planning agent.
- D-4 (class-name compatibility): ratify, after the fact, the retirement of
  the Hyper class names that `1.4.17` removed without recording it. Do not
  restore them. Publish a small supported styling surface: `#hyper`,
  `.fullScreen`, and the four retained `term_*` classes, plus xterm's own
  `.xterm*` classes, which xterm owns. State that generated names are internal
  and never quote them. Warn users and name plugins whose CSS targets a retired
  name, with guidance per group: tab, tab-strip, and header names have no
  supported replacement until the vertical tab rail (roadmap `6.1.1`) and its
  decoration API; split-pane and terms names map to the `.term_*` hooks;
  `hyper_main` maps to `#hyper`; notification names have no replacement.
  Alternatives rejected: restoring dual legacy classes (re-creates the
  internal-detail contract the PRD rejects); rewriting retired selectors to
  generated names like `htermConfigTranslate` does, or quoting generated names
  in guidance (either makes generated names a de facto public contract). EP-M7
  adds a retrospective note to the `1.4.17` plan. Status: recommended; needs
  maintainer confirmation. Date/Author: 2026-10-29, planning agent.
- D-5 (`termCSS`): keep the key for now and warn when it is non-empty that it
  has no effect and its rules belong in `css`. Track removal as
  `CSSCOMPAT-002`. Removal would not break validation (the schema accepts
  unknown keys), but it touches about ten files (types, reducer, the IPC zod
  schema, two reloadability registries, `htermConfigTranslate`), which is
  outside this item's interface tolerance. Remove it in the next item that
  changes the configuration schema. `termCSS` is not scanned for retired hooks;
  one "has no effect" message suffices. Date/Author: 2026-10-29, planning agent.
- D-6 (architecture): pure policy in `app/config/custom-css/` (scanner,
  registry, advisory policy); a reporter there that takes an injected `notify`
  port; call sites in `app/config.ts` and `app/plugins.ts`. The pure modules
  sit in `app/` rather than `shared/` because only the main process uses them
  and `app/` cannot import runtime values from `@shared/*`. A unit test
  enforces that the pure modules import nothing but each other. Do not model
  the CSP as a domain object: it is static configuration in one HTML file with
  no second consumer, so a contract test is proportionate and a policy builder
  would be a pattern transplant. Date/ Author: 2026-10-29, planning agent.
- D-7 (verification tooling): add `fast-check` and `lemmascript` with Dafny,
  as the task requires. Wire the proof into `make proofs` and a separate
  `proofs` CI job so it cannot rot. Date/Author: 2026-10-29, planning agent.
- D-8 (WebAssembly): EP-M0 determines whether sixel images render today. If
  they do not, the recommendation is to add `'wasm-unsafe-eval'` to
  `script-src`. It permits WebAssembly compilation only, not JavaScript `eval`,
  and restores a default-on feature. If the maintainer declines, track it as
  `CSP-003` and note in the users' guide that `imageSupport` does not work. If
  sixel images already render, record why (and the evidence) and change
  nothing. Status: pending EP-M0 evidence and maintainer confirmation.
  Date/Author: 2026-10-29, planning agent.
- D-9 (delivery order): land decisions and tracking first (EP-M1, EP-M2),
  then CSP (EP-M3), then the advisory and proof (EP-M4 to EP-M6), so the
  success criterion does not wait on the riskiest work. The proof stays in
  scope because the task requires it; if it hits the feasibility tolerance,
  escalate rather than silently dropping it. Date/Author: 2026-10-29, planning
  agent.

## Outcomes & retrospective

Not started. Complete this section at each milestone boundary and at
completion, comparing the result against `Purpose / big picture`.

## Context and orientation

Velocetty is a fork of the Hyper terminal and an Electron 44 application. The
main process (`app/`) creates windows, and each window runs a renderer process
that loads `file://…/app/index.html` (`app/start.ts:81`) and the React bundle
built from `lib/index.tsx`. Shared code lives in `shared/src/` behind the
`@shared/*` alias, but `app/` is compiled to CommonJS by `tsgo`
(`app/tsconfig.build.json`) and may only use `import type` from `@shared/*`.
`bun run check:boundaries` (`scripts/check-package-boundaries.mjs`) enforces
import direction.

Renderer styling uses CSS Modules. esbuild builds `lib/index.tsx` with loaders
`'.css': 'css'` and `'.module.css': 'local-css'`
(`build/esbuild/run-esbuild.ts:60-85`) and emits
`dist/app/renderer/bundle.css`, which `app/index.html` links. esbuild's default
naming produces `<file stem>_<local name>`, such as `tab_tabTab`.

`app/index.html` contains, in order: a CSP meta tag
(`script-src 'self' 'unsafe-inline'`), an inline `<style>` with base resets,
`<div id="mount">`, an inline script `start = performance.now();`, the
stylesheet link, `renderer/bundle.js`, and an inline script logging
`total init time`. `build/esbuild/copy-artefacts.ts:113` copies the HTML into
`dist/app/` unchanged.

The renderer window is created in `app/ui/window.ts:104-108` with
`nodeIntegration: true` and `contextIsolation: false`. Plugins load through
Node's `require` with a `Module._load` allowlist
(`lib/utils/plugins.ts:393-437`); CSP does not govern `require`.

Custom CSS: `app/config/config-default.json` defines `css` and `termCSS` as
empty strings; both may also appear in a profile's `config` override
(`shared/src/types/config.ts`). The `css` value flows through `state.ui.css`
into `lib/containers/hyper.tsx`, which scopes it to `#hyper` with `stylis`.
Plugins' `decorateConfig` hooks run in the main process (`app/plugins.ts`).

Configuration warnings: `checkDeprecatedConfig` in `app/config.ts` calls
`notify('Configuration warning', …)` (`app/notify.ts`, which also logs
`[Notification] <title>: <body>` to stdout) at start-up (line 159) and after
each reload (line 69). `getDeprecatedConfig` in `app/plugins.ts:463-487` runs
each plugin's `decorateConfig` on a clone and returns
`Record<string, {css: string[]}>` over IPC (`app/plugins.ts:553`,
`lib/transport/ipc-schemas.ts:110,183`, `shared/src/types/common.ts:192`).

Tests: `make test` runs `bun test --concurrent --isolate test/unit`. The fast
E2E lane is `bun run test:e2e:fast` (`test/e2e/electron.e2e.test.ts`, gated by
`RUN_E2E=1`, default `spawn` driver, needs a packaged build from
`make build-fast`). Spawn output carries `[e2e][renderer-ready]`,
`[e2e][renderer-error]` (from `app/rpc.ts`), and `[Notification]` lines. The
isolated configuration lives at `$XDG_CONFIG_HOME/Hyper/config.json5`
(`app/config/paths.ts:16,30`). The deep Playwright lane is `test/e2e-deep/`
(`bun run test:e2e:deep`), run on schedule, manual trigger, and pushes to
`master` and `canary`. The maintainer's memory note "Velocetty local E2E
headless" explains running the fast lane locally with
`--ozone-platform=headless`. `bunfig.toml` preloads only
`test/testUtils/css-modules-plugin.ts`; there is no global DOM in unit tests.
Dafny 4.11 is at `~/.local/bin/dafny` on the development host.

Terms used in this plan:

- Content Security Policy (CSP): a list of directives, such as `script-src`,
  that tell the browser which sources may run. `'self'` means "same origin";
  `'unsafe-inline'` allows inline `<script>` blocks and inline handlers.
- Constructed stylesheet: a `CSSStyleSheet` created in script and attached
  with `document.adoptedStyleSheets`; not subject to `style-src`.
- Dot-identifier token: a `.` followed by a CSS identifier, outside comments,
  strings, and unquoted `url(...)`, as defined in `Verification plan`.
- Retired hook: a Hyper DOM class name that Velocetty no longer emits.
- Supported hook: a selector Velocetty promises to keep for custom CSS.
- LemmaScript: a toolchain that turns `//@` specification comments in
  TypeScript into Dafny, which the Dafny verifier then proves.

Documentation and skills to keep open while implementing:

- `docs/roadmap.md` §1.4.19, §6.1.1, and §9.2.4.
- `docs/velocetty-product-requirements-document.md` §Product stance.
- `docs/velocetty-design.md` §Plugin system redesign, §Renderer styling
  migration model, §Testing, observability, and performance.
- `docs/velocetty-hyper-codebase.md` around lines 7123-7136, 7643, 7657,
  7935, and 9292 (stale CSP claims).
- `docs/adr-002-replace-webpack-babel-with-esbuild.md` and
  `docs/adr-005-enhance-e2e-testing-strategy.md`.
- `docs/developers-guide.md` §Package boundaries, §CSS modules conventions,
  §Tests, §Preserving legacy plugin-targeted class names.
- `docs/documentation-style-guide.md` (ADR format and roadmap conventions).
- `docs/tracking-issues.md`.
- `docs/execplans/1-4-17-migrate-renderer-style-blocks-from-styled-jsx-to-css-modules.md`.
- Electron security checklist:
  <https://www.electronjs.org/docs/latest/tutorial/security>.
- Skills: `execplans`, `typescript-router`,
  `typescript-boundaries-and-validation`, `electron-and-ipc`,
  `typescript-testing`, `typescript-verification`, `fast-check`, `lemmascript`,
  `hexagonal-architecture`, `biome-typescript`, `typescript-quality-tools`,
  `en-gb-oxendict-style`, `commit-message`, `pr-creation`, `codegraph-mcp`, and
  `firecrawl-mcp` for external lookups.

## Conformance basis

Upstream artefacts, at `main` commit `40949b2f`:

- PRD: `docs/velocetty-product-requirements-document.md` §Product stance
  (PRD-STANCE: no backwards-compatibility target; plugins must not rely on
  internal implementation details).
- Technical design: `docs/velocetty-design.md` §Plugin goals
  (TDD-PLUGIN-GOALS: avoid fragile UI decoration hooks) and §Renderer styling
  migration model (TDD-STYLING).
- ADR-002: no `eval` or `Function` escape hatches under a `script-src`
  without `'unsafe-eval'` (ADR2-CSP).
- ADR-005: fast-lane renderer readiness and critical console-error
  assertions (ADR5-FAST).
- Roadmap: RM-1.4.19-a (reassess CSP constraints tied to inline style
  transform behaviour and document any remaining blocker), RM-1.4.19-b (confirm
  plugin and custom CSS compatibility expectations and open tracking issues for
  intentional breakage with ownership and mitigation), and RM-1.4.19-c
  (follow-ups resolved or tracked with explicit owners and review dates).
- No Terms of Reference document exists for this project.

Trace links:

```plaintext
RM-1.4.19-a -> ADR2-CSP -> D-2 -> EP-M3 -> test/unit/renderer-csp-contract.test.ts
RM-1.4.19-a -> ADR5-FAST -> D-2 -> EP-M3 -> test/e2e/post-removal-hardening.e2e.test.ts::CSP
RM-1.4.19-a -> D-8 -> EP-M0, EP-M3 -> test/e2e/post-removal-hardening.e2e.test.ts::sixel
RM-1.4.19-a -> D-3 -> EP-M1 -> docs/adr-007-renderer-csp-and-custom-css-compatibility.md
RM-1.4.19-a -> D-3 -> EP-M2 -> docs/tracking-issues.md::CSP-001, CSP-002, XTERM-001
RM-1.4.19-b -> PRD-STANCE, TDD-PLUGIN-GOALS -> D-4 -> EP-M4, EP-M5 -> app/config/custom-css/*
RM-1.4.19-b -> D-4 -> EP-M6 -> app/config.ts, app/plugins.ts, test/unit/custom-css-advisory-reporter.test.ts
RM-1.4.19-b -> D-4 -> EP-M7 -> test/e2e-deep/supported-style-hooks.e2e.ts
RM-1.4.19-b -> D-2 -> EP-M2 -> docs/tracking-issues.md::PLUGINCOMPAT-001
RM-1.4.19-b -> D-4, D-5 -> EP-M2 -> docs/tracking-issues.md::CSSCOMPAT-001, CSSCOMPAT-002
RM-1.4.19-c -> EP-M2 -> docs/tracking-issues.md (Owner, Review by), test/unit/tracking-issues-register.test.ts
```

## Verification plan

One piece of non-trivial logic is introduced: the class-token scanner. The rest
are static or behavioural contracts. Each obligation names its method,
artefact, evidence, and non-vacuity check, and each seeded fault names the
obligation it must break.

### Axioms (trusted, not verified here)

- AXIOM-1: Chromium in Electron 44 enforces a meta-delivered CSP on
  `file://` pages per CSP Level 3, with `'self'` matching `file:` URLs.
  Exercised by the E2E start-up check.
- AXIOM-2: a blocked inline script produces an error-level `console-message`
  event on the window's `webContents`. The exact wording varies by Chromium
  version, so the detector matches "Content Security Policy" and the unit test
  uses a line captured from a real Electron 44 run in EP-M0. Exercised by the
  seeded-fault runs.
- AXIOM-3: CSSOM writes and constructed stylesheets are not governed by
  `style-src`; `<style>` elements, `style="…"` markup,
  `setAttribute('style', …)`, and `style.cssText` are (MDN). Used only to
  document blockers.
- AXIOM-4: `xterm@5.3.0`'s DOM renderer creates `<style>` elements and writes
  `style` attributes (observed in `node_modules/xterm/lib/xterm.js`).
- AXIOM-5: Node's `require` and `Module._load` are not governed by CSP.
- AXIOM-6: with `--unicode-char:false`, Dafny's `char` is a 16-bit code unit
  and `string` a sequence of them, matching JavaScript's UTF-16 `length`,
  index, and `charCodeAt` semantics; LemmaScript translates `charCodeAt`,
  `length`, and `slice` faithfully to that model; Dafny is sound. LemmaScript
  treats `number` as a mathematical integer; the scanner only uses indices
  bounded by `css.length`, so the 2^53 limit does not arise. EP-M5's prototype
  gate exercises the translation.

### Lexical model

The scanner reads the stylesheet one UTF-16 code unit at a time. The model is a
state machine with states `Normal`, `Slash`, `Comment`, `CommentStar`, `Str(q)`
and `StrEsc(q)` for each quote `q` in `"` and `'`, `NormalEsc`, `UrlPre`, and
`Url`. Its transitions are:

1. Rule 0 (escapes): in `Normal`, `\` moves to `NormalEsc`; any next code unit
   returns to `Normal`. The escaped code unit takes part in no other rule.
2. Rule 1 (comments): in `Normal`, `/` moves to `Slash`. In `Slash`, `*` moves
   to `Comment`; any other code unit is reprocessed in `Normal`. In `Comment`,
   `*` moves to `CommentStar`. In `CommentStar`, `/` returns to `Normal`, `*`
   stays, anything else returns to `Comment`. An unterminated comment runs to
   the end of input.
3. Rule 2 (strings): in `Normal`, `"` or `'` moves to `Str(q)`. In `Str(q)`,
   `\` moves to `StrEsc(q)`; `q` returns to `Normal`; an unescaped line feed,
   carriage return, or form feed returns to `Normal` (a CSS "bad string");
   anything else stays. In `StrEsc(q)`, any code unit returns to `Str(q)`. The
   other quote character does not close a string.
4. Rule 3 (URLs): in `Normal`, the four code units `u r l (` matched
   case-insensitively by code-unit comparison (not `toLowerCase`), where the
   `u` is at the start of input or preceded by a code unit that is neither an
   identifier code unit nor `\`, move to `UrlPre`. In `UrlPre`, whitespace
   stays; a quote is reprocessed in `Normal` (so rule 2 handles quoted URLs,
   including `)` inside them); anything else moves to `Url`. In `Url`, `)`
   returns to `Normal`; anything else stays.
5. Rule 4 (tokens): in `Normal`, at index `i` where `css[i]` is `.` and the
   code units after it form an identifier start, a dot-identifier token starts
   at `i`. An identifier start is a letter, `_`, a code unit at or above
   U+0080, or `-` followed by one of those (not a digit and not a second `-`).
   The token's name is the maximal run of identifier code units (letters,
   digits, `_`, `-`, and code units at or above U+0080) from `i + 1`. If that
   run is immediately followed by `\`, no token is reported. The scanner then
   continues one code unit at a time, so code units inside the name are still
   processed by the rules (for example `url(` inside a name is excluded by rule
   3's preceding-code-unit condition).
6. Ordinary code units, including `<!--` and `-->`, leave `Normal` unchanged.

Consequences recorded for ADR-007 and the users' guide: dot-identifier tokens
in declaration values are reported (over-approximation); attribute selectors
such as `[class~="tab_tab"]`, escaped identifiers, and selectors built at
runtime are not (under-approximation); nesting and `@import` are scanned only
lexically.

### Specification functions

In `app/config/custom-css/css-class-tokens.ts`, alongside the shipped scanner,
define exported pure functions that serve as the specification and can also be
called from tests: `stepLexState(state, css, i)` (one transition),
`lexStateAt(css, i)` defined by recursion on `i` (the state before reading index
`i`), `identRunEnd(css, j)`, `isTokenStartAt(css, i)`, and
`classTokensSpec(css, n)` defined by recursion on `n`, which appends
`{name, start: n - 1}` when `isTokenStartAt(css, n - 1)`. The shipped
`scanClassTokens(css)` is a single imperative loop that may look ahead, and its
contract is `\result === classTokensSpec(css, css.length)`.

The specification is validated on its own terms, independently of the loop, so
that a bug in the specification cannot pass unnoticed:

- At least 12 example lemmas proved by computation, for example
  `lexStateAt("/*.a*/", 3) == Comment`,
  `lexStateAt("a\"b\\\"c\"", 8) == Normal`, `classTokensSpec(".a.b", 4)` has
  two tokens, and `classTokensSpec("url(.a)", 7)` has none.
- Characterizing lemmas, for example: if `lexStateAt(css, i) == Normal` and
  `css[i..i+2] == "/*"`, then the state is `Normal` again exactly at two past
  the first `*/` after `i + 2`, and no token starts in between.
- A fast-check differential test comparing `classTokensSpec` with an
  independent sticky-regex tokenizer written only in the test file.

### Obligations

- Obligation SCAN-REFINES: `scanClassTokens(css)` equals
  `classTokensSpec(css, css.length)` for every string. Method: LemmaScript to
  Dafny, with the loop invariant `state === lexStateAt(css, i)` and
  `tokens === classTokensSpec(css, i)`. Rationale: refinement to a pure
  specification is the recommended structure for loop code; every property of
  the specification then transfers. Artefact:
  `app/config/custom-css/css-class-tokens.ts` (annotations) and
  `app/config/custom-css/css-class-tokens.dfy` (helper lemmas only). Evidence:
  `make proofs` verifies with zero errors. Non-vacuity: precondition is `true`;
  review the `.dfy` diff against `.dfy.gen` for `assume`, `{:axiom}`, or added
  `axiom` declarations, which must be absent.
- Obligation SCAN-SOUND (lemma about the specification): every token in
  `classTokensSpec(css, n)` satisfies `isTokenStartAt(css, start)`, and its
  name is `css.slice(start + 1, identRunEnd(css, start + 1))`.
- Obligation SCAN-COMPLETE (lemma about the specification): for every
  `i < n` with `isTokenStartAt(css, i)`, `classTokensSpec(css, n)` contains a
  token starting at `i`; starts are strictly increasing.
- Obligation SPEC-VALID: the example and characterizing lemmas above hold,
  and `classTokensSpec` agrees with the regex tokenizer over generated inputs.
  Method: Dafny lemmas plus a fast-check differential property in
  `test/unit/css-class-tokens.property.test.ts`, using a small alphabet
  (`/ * " ' \ u r l U ( ) . a _ - 0 é` plus space, line feed, and an astral
  emoji) so that comments, strings, URLs, and escapes actually occur.
- Seeded faults, applied one at a time, each recorded with the failing
  obligation and then reverted:
  - (a) `//` opens a comment. Breaks SPEC-VALID and, applied to the
    implementation only, SCAN-REFINES. Also apply to the specification to
    show SPEC-VALID catches it.
  - (b) string escapes ignored. Breaks SCAN-REFINES.
  - (c) name ends one code unit early. Breaks SCAN-REFINES and SCAN-SOUND
    examples.
  - (d) the loop skips past the name run after a token. Breaks
    SCAN-REFINES on `.a.b`.
  - (e) no return to `Normal` after `*/`. Breaks SCAN-REFINES.
  - (f) no `UrlPre` check, so quoted URLs open `Url`. Breaks SCAN-REFINES;
    apply to the specification too and show SPEC-VALID catches it.
  - (g) `url(` matched case-sensitively. Breaks SCAN-REFINES on `URL(`.
  - (h) look-ahead reads past the end at a trailing `/` or `.`. Must fail
    Dafny's index-bounds check.
  - (i) a string closed by the other quote. Breaks SCAN-REFINES.
  - (j) `-` followed by a digit accepted as an identifier start. Breaks
    SCAN-REFINES on `.-1a`.
- Obligation ADVISE-EXACT: `findRetiredStyleHooks(css)` reports retired hook
  `h` exactly when some scanned token's name equals `h` (case-sensitively, as
  class names are); findings are de-duplicated and ordered by first occurrence.
  Method: fast-check property against a generator-recorded oracle, plus named
  examples including prefix pairs from the registry (`tab_text` and
  `tab_textActive`) and `.tab_tabTab`. Domain: every generated case contains at
  least one placement of every class (live selector, live declaration value,
  comment, string, unquoted `url(...)`, prefix of a longer name, case variant
  such as `Tab_tab`), shuffled and separated by `;\n`; fragment arbitraries
  exclude closers, quotes, line breaks, and trailing `\`, so joining fragments
  cannot create or destroy tokens. The oracle marks placements in live
  selectors and live values as "lexically live". Artefact:
  `test/unit/retired-style-hooks.property.test.ts`. Evidence: passes at 100
  runs in `make test`, and at 10,000 runs once locally (recorded). Non-vacuity:
  every case contains every class by construction, and a separate assertion
  checks this; seeded fault: replacing exact comparison with `startsWith` must
  fail.
- Obligation REG-WELLFORMED: the retired and supported sets are disjoint;
  every retired name matches `^[a-z]+_[A-Za-z]+$`; no retired name equals a
  current generated name. The generated names are computed in the test by
  scanning each `lib/components/*.module.css` and `lib/containers/*.module.css`
  with `scanClassTokens` and forming `<file stem>_<name>`. Method:
  parameterized unit test. Artefact: `test/unit/retired-style-hooks.test.ts`.
  Non-vacuity: adding a retired entry equal to a generated name (seeded,
  reverted) must fail; the supported set has exactly the six documented hooks.
- Obligation POLICY-PURE: no file in `app/config/custom-css/` except the
  reporter imports anything outside that directory, and the reporter imports
  only the pure modules and type-only `@shared/*`. Method: unit test reading
  import specifiers, as `test/unit/ts-project-boundaries.test.ts` does.
  Artefact: `test/unit/custom-css-boundaries.test.ts`.
- Obligation TERMCSS-ADVISE: the policy reports `inert-term-css` exactly when
  `termCSS.trim()` is non-empty. Method: table test (empty, whitespace,
  comment-only, real CSS). Artefact: `test/unit/custom-css-advisories.test.ts`.
- Obligation REPORTER: the reporter returned by
  `createCustomCssAdvisoryReporter({notify})` (1) scans the root `css` and
  every profile's `config.css`; (2) calls `notify` once with title
  `Configuration warning` and a body equal to an expected string (compared with
  `toBe`) that lists at most five selectors then "and N more", gives `termCSS`
  guidance when relevant, and ends with the users' guide URL; (3) does not
  notify for a clean configuration; (4) does not notify again when called with
  the same findings; (5) notifies again when findings change. The plugin path
  names the plugin and reports only hooks absent from the undecorated
  configuration. Method: behavioural unit tests with a recording `notify`.
  Artefact: `test/unit/custom-css-advisory-reporter.test.ts`. Non-vacuity:
  cases (3) and (4) observe zero calls, (2) and (5) observe exact bodies, so
  always-notify and never-notify adapters both fail.
- Obligation CONSOLE-FORWARD: the `console-message` listener in
  `app/rpc.ts` forwards exactly the messages whose `details.level` is
  `'error'`, formatted as `[e2e][renderer-error] <source>:<line> <message>`.
  Method: extract the predicate and formatter into
  `app/utils/renderer-console-forwarding.ts` and unit-test them. Artefact:
  `test/unit/renderer-console-forwarding.test.ts`.
- Obligation CSP-STATIC: `app/index.html` has exactly one CSP meta tag,
  placed before every `<script>`, `<style>`, and `<link>`; its directives parse
  to exactly
  `{script-src: ['self'] (plus 'wasm-unsafe-eval' if D-8
  adds it), object-src: ['none'], base-uri: ['none'], form-action: ['none']}`;
  every `<script>` has a `src`; no element has an `on*` attribute. Method:
  contract unit test parsing the HTML with a local Happy DOM `Window`
  (`new Window()`, `new window.DOMParser().parseFromString(html, 'text/html')`,
  then `await window.happyDOM.close()`), asserting the parsed directive map with
  `toEqual`. Artefact: `test/unit/renderer-csp-contract.test.ts`. Evidence:
  red against today's HTML, green after EP-M3.
- Obligation CSP-RUNTIME: a fast-lane launch yields no
  `[e2e][renderer-error]` line mentioning "Content Security Policy" from launch
  until two seconds after `[e2e][renderer-ready]`. Method: E2E over spawn
  output. Artefact: `test/e2e/post-removal-hardening.e2e.test.ts`, with spawn
  helpers moved into `test/e2e/spawn-launch.ts` and the detector in
  `test/e2e/csp-violation-detection.ts` (unit-tested in
  `test/unit/csp-violation-detection.test.ts` with the captured real line).
  Non-vacuity: the seeded fault (an inline `<script>` under the tightened
  policy) must make the check fail, under both the default `spawn` driver and
  `E2E_DRIVER=playwright`; outputs recorded.
- Obligation SIXEL (if D-8 adds `'wasm-unsafe-eval'`): writing a minimal
  sixel sequence to the active terminal produces no CSP error line. Method: E2E
  in the same file. Non-vacuity: run once without the keyword (seeded) and
  observe the error.
- Obligation WARNING-E2E: a fast-lane launch with
  `css: '.tab_tab { color: red; }'` in the seeded configuration prints a
  `[Notification] Configuration warning:` line naming `.tab_tab`; a launch with
  clean configuration prints none. Method: E2E over spawn output.
- Obligation HOOKS-PRESENT: after start-up, the DOM contains `#hyper`,
  `.term_fit`, `.term_term`, `.term_wrapper`, and an active pane with
  `.term_active`. Method: deep Playwright lane, driven by
  `SUPPORTED_STYLE_HOOKS`. Artefact:
  `test/e2e-deep/supported-style-hooks.e2e.ts`. This lane runs on schedule,
  manual trigger, and pushes to `master` and `canary`, not on every pull
  request; run it locally once and record the output.
- Obligation TRACK-REGISTER: each entry this item adds to
  `docs/tracking-issues.md` has `Status`, a non-`TBD` `Owner`, a `Review by`
  value containing a `YYYY-MM-DD` date and an event trigger, a `Mitigation:`
  line, and an `Issue` link. Method: unit test that parses the file and
  enumerates the IDs explicitly. It never compares dates with the clock.
  Artefact: `test/unit/tracking-issues-register.test.ts`.

## Plan of work

Stage A (no code): EP-M0 records baseline evidence and settles D-8's facts.
EP-M1 writes ADR-007 and the design updates. EP-M2 opens the issues and writes
the tracking entries, which already satisfies the success criterion's tracking
half.

Stage B and C (red, then green): EP-M3 hardens the CSP; EP-M4 builds the pure
modules with examples and properties; EP-M5 proves the scanner; EP-M6 wires the
reporter for user and plugin CSS; EP-M7 removes dead compatibility code and
adds the supported-hook check. Each starts with the smallest failing test.

Stage D: EP-M8 completes the guides, corrects stale documents, and closes the
roadmap item.

## Milestones and plateaus

### EP-M0: baseline evidence

- Outcome: recorded facts; no repository change except this plan.
- Requirements and gaps: D-1, D-8, and the console-forwarding risk.
- Steps: run `make build-fast` and `bun run test:e2e:fast` on the unmodified
  tree. Then, without committing, (1) change the CSP to `script-src 'self'`
  while leaving the inline scripts in place, rebuild, and run the fast lane:
  record whether a "Content Security Policy" line appears, and capture its
  exact text for AXIOM-2; (2) launch the app (`bun run app` after
  `bun run build`), run `printf` with a minimal sixel sequence in the terminal,
  and record whether an image renders and whether a WebAssembly CSP error
  appears; (3) run `bun run dev`, confirm React DevTools still detects React,
  and record it. Revert all temporary changes (`git diff` must be empty).
  Re-run the commands in `Concrete steps` §EP-M0 and update
  `Surprises & discoveries` if anything moved.
- Acceptance evidence: baseline gates pass; the three observations are
  recorded in `Artefacts and notes`.
- Conformance check: one line each — D-1 answered; design unchanged; baseline
  facts confirmed or corrected; no interface, dependency, trust-boundary, or
  format change; trace links current.
- Recovery: `git checkout -- app/index.html`.
- Remaining gaps: everything else.
- Compatibility decision: none.

### EP-M1: ADR-007 and design decisions

- Outcome: `docs/adr-007-renderer-csp-and-custom-css-compatibility.md`,
  status `Accepted` once the maintainer confirms D-2 to D-5 and D-8, cited from
  `docs/velocetty-design.md`.
- Requirements and gaps: RM-1.4.19-a and RM-1.4.19-b (decision parts).
- Edits: the ADR follows `docs/documentation-style-guide.md`: title
  `# Architectural decision record (ADR) 007: Renderer CSP and custom CSS
  compatibility after styled-jsx removal`;
  sections Status, Date, Context and Problem Statement, Decision Drivers,
  Options Considered (captioned tables for the script, style, and class-name
  options), Decision Outcome, and Known Risks and Limitations, which cites the
  tracking IDs and the lexical model's gaps. Because the ADR is `Accepted`, it
  has no Outstanding Decisions section. In `docs/velocetty-design.md` §Renderer
  styling migration model, add a "Custom CSS compatibility contract" subsection
  (supported hooks, internal-name rule, advisory), and remove the stray blank
  lines between every line of that section. Beside §Plugin command security,
  add a "Renderer Content Security Policy" subsection stating the policy and
  the D-3 blockers.
- Acceptance evidence: `make markdownlint`, `make nixie`, `make spelling`,
  `make check-fmt`, `make lint`, and `make test` pass.
- Conformance check: ADR content matches the confirmed decisions.
- Recovery: revert the commit.
- Remaining gaps: implementation.
- Compatibility decision: none.

### EP-M2: tracking issues and register

- Outcome: every follow-up is tracked with an owner, review trigger,
  mitigation, and issue.
- Requirements and gaps: RM-1.4.19-b, RM-1.4.19-c.
- Red: add `test/unit/tracking-issues-register.test.ts` enumerating the IDs
  below; it fails because the entries do not exist.
- Green: create a GitHub milestone "1.4.19 follow-up review" whose due date
  is the earliest `Review by` date, open one issue per entry in
  `leynos/velocetty` with `gh issue create --milestone`, authenticated as
  `leynos`, and record the numbers. In `docs/tracking-issues.md`, document a new
  `Review by:` field (a date, 90 days after the implementation date and
  written absolutely, "or" an event trigger, whichever comes first; new entries
  must have it, backfilling older entries is optional), then add:
  - `CSP-001` Add `style-src` to the renderer CSP. Blockers per D-3.
    Mitigation: no style restriction today; script policy tightened.
    Trigger: a change to `webPreferences` or the plugin runtime. Exit: own
    blockers moved to a stylesheet and a constructed stylesheet, `XTERM-001`
    closed, plugin impact accepted, policy shipped with an E2E check.
  - `CSP-002` Serve the renderer from a custom `app://` protocol instead of
    `file://`, so `'self'` no longer matches arbitrary local files.
    Mitigation: no known HTML-injection sink; `object-src`, `base-uri`, and
    `form-action` closed. Trigger: the remote-frontend work in the design.
  - `XTERM-001` Migrate from the deprecated unscoped `xterm` and
    `xterm-addon-*` packages to `@xterm/*`. Mitigation: WebGL and canvas
    addons are the normal render path. Exit: verify that `@xterm/*` removes
    both `<style>` element injection and `style`-attribute writes from the
    DOM renderer, or disable the DOM renderer path. Trigger: Phase 2
    rendering work.
  - `CSSCOMPAT-001` Retired Hyper DOM class names (ratified by D-4).
    Mitigation: configuration and plugin warnings, users' guide, supported
    hooks, and the roadmap's stable plugin APIs. Exit: decide at the review
    whether any group needs a supported hook, informed by issue reports.
    Trigger: roadmap `6.1.1`.
  - `CSSCOMPAT-002` Remove the inert `termCSS` key. Mitigation: the
    configuration warning. Exit: key removed from schema, defaults, types,
    reducer, IPC schema, and both reloadability registries. Trigger: the next
    configuration-schema change.
  - `PLUGINCOMPAT-001` Plugins relying on inline scripts, inline `on*`
    handlers, or `javascript:` URLs stop working once `'unsafe-inline'` is
    removed. Mitigation: users' guide note ("load code through modules");
    side benefit: `javascript:` links in remote notifications are blocked.
    Trigger: the plugin runtime redesign.
  - `CSP-003` (only if D-8 declines `'wasm-unsafe-eval'`) Sixel images need
    WebAssembly. Mitigation: documented limitation.
- Acceptance evidence: the register test passes; `make markdownlint`,
  `make spelling`, `make check-fmt`, `make lint`, and `make test` pass.
- Conformance check: every intentional breakage known so far has an entry.
- Recovery: close issues with a link to the plan if abandoned; revert docs.
- Remaining gaps: implementation and guides.
- Compatibility decision: none.

### EP-M3: renderer CSP hardening

- Outcome: the policy in D-2 (and D-8 if confirmed) ships, with no inline
  scripts, and the E2E lane can see CSP violations.
- Requirements and gaps: RM-1.4.19-a, D-2, D-8.
- Red: add `test/unit/renderer-csp-contract.test.ts` (CSP-STATIC) and
  `test/unit/renderer-console-forwarding.test.ts` (CONSOLE-FORWARD); both fail.
  Add `test/e2e/csp-violation-detection.ts` and its unit test, move the spawn
  helpers from `test/e2e/electron.e2e.test.ts` into `test/e2e/spawn-launch.ts`
  (the existing file then imports them), and add
  `test/e2e/post-removal-hardening.e2e.test.ts` with CSP-RUNTIME (and SIXEL if
  D-8 applies). Set the `test:e2e:run` script in `package.json` to:

  ```json
  "test:e2e:run": "bunx cross-env RUN_E2E=1 bun test test/e2e/electron.e2e.test.ts test/e2e/post-removal-hardening.e2e.test.ts"
  ```

- Green: add `app/utils/renderer-console-forwarding.ts` and use it in
  `app/rpc.ts` with the `(event, details)` listener signature. Delete both
  inline `<script>` elements from `app/index.html`. Append to the end of the
  `lib/index.tsx` module body
  `console.log('total init time', performance.now());` with a comment citing
  D-2. Set the meta content to
  `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`
  (plus `'wasm-unsafe-eval'` in `script-src` if D-8 confirms).
- Seeded fault: re-add `<script>window.__cspProbe = 1;</script>`, rebuild,
  run the fast lane under both drivers, record the failures, revert.
- Acceptance evidence: the new unit tests pass; `make build-fast` then
  `bun run test:e2e:fast` passes; the code gates in `Constraints` pass.
- Conformance check: policy strictly tighter than before except, if
  confirmed, `'wasm-unsafe-eval'`; no style directive; no `webPreferences`
  change; the existing E2E file shrinks.
- Recovery: revert the milestone commits.
- Remaining gaps: style policy and custom protocol (tracked).
- Compatibility decision: no external consumer depends on the `start`
  global; plugin breakage is tracked as `PLUGINCOMPAT-001`.

### EP-M4: pure scanner, registry, and advisory policy

- Outcome: pure modules in `app/config/custom-css/` with unit and property
  tests.
- Requirements and gaps: RM-1.4.19-b, D-4, D-5, D-6.
- Red: add `test/unit/css-class-tokens.test.ts` (one named example per
  lexical rule, plus the specification examples),
  `test/unit/retired-style-hooks.test.ts` (REG-WELLFORMED and ADVISE-EXACT
  examples), `test/unit/custom-css-advisories.test.ts` (TERMCSS-ADVISE), and
  `test/unit/custom-css-boundaries.test.ts` (POLICY-PURE). They fail to import.
- Green: implement `css-class-tokens.ts` (specification functions plus
  `scanClassTokens`, written as one index-based `while` loop over
  `css.charCodeAt(i)` with explicit comparisons: no regular expressions, no
  closures over mutable state, no `codePointAt`; each `charCodeAt` call carries
  `// oxlint-disable-next-line unicorn/prefer-code-point -- UTF-16
  code units are the proof model`);
  `retired-style-hooks.ts` (the registry and `findRetiredStyleHooks`); and
  `advisory-policy.ts` (`collectCustomCssAdvisories`). Add `fast-check` and
  write `test/unit/css-class-tokens.property.test.ts` (SPEC-VALID differential
  and the implementation-versus-specification property) and
  `test/unit/retired-style-hooks.property.test.ts` (ADVISE-EXACT). The retired
  list comes from `Concrete steps` §EP-M4, minus the four retained names; each
  entry carries its group guidance from D-4.
- Seeded faults: try (a) to (j) against the property tests where they apply,
  and the `startsWith` and generated-name faults; record and revert.
- Acceptance evidence: new tests pass; code gates pass.
- Conformance check: pure modules import nothing outside the directory; no
  runtime behaviour change yet.
- Recovery: revert; nothing depends on the modules yet.
- Remaining gaps: proof and wiring.
- Compatibility decision: none.

### EP-M5: LemmaScript proof (proof milestone)

- Outcome: SCAN-REFINES, SCAN-SOUND, SCAN-COMPLETE, and SPEC-VALID's Dafny
  lemmas verified for the shipped source, checked by `make proofs` locally and
  in CI.
- Requirements and gaps: D-7.
- Prototype gate (go/no-go): in a scratch directory outside the repository,
  write a function using exactly the scanner's idioms (`css.charCodeAt(i)`,
  `css.length`, `css.slice(a, b)`, `push({name, start})` into a record array,
  nested `while` loops, look-ahead `i + 1 < css.length`, a string-literal-union
  state, and a recursive `//@ pure` specification with `//@ decreases` called
  from an invariant), plus one seeded fault. Run
  `bunx lsc check --backend=dafny` with and without
  `--extra-flags=--unicode-char:false`. Go if the clean version verifies and
  the fault fails; otherwise stop and escalate. Delete the prototype.
- Red: add `//@ verify`,
  `//@ ensures \result === classTokensSpec(css, css.length)`, loop
  `//@ invariant` and `//@ decreases` annotations, and `//@ pure` markers. Run
  `lsc check`; record the open obligations.
- Green: add helper lemmas and the example and characterizing lemmas to
  `app/config/custom-css/css-class-tokens.dfy` only (never edit `.dfy.gen`). Add
  `lemmascript` as a development dependency; `LemmaScript-files.txt` listing
  the file and its flags; a `proofs` Makefile target (added to `.PHONY`) running
  `bunx lsc check` for each listed file, then
  `git diff --exit-code -- '*.dfy.gen'`; and a separate `proofs` job in
  `.github/workflows/nodejs.yml` (`runs-on: ubuntu-latest`, the same `if:` as
  `build`): checkout, SHA-pinned `oven-sh/setup-bun`,
  `bun install --ignore-scripts`, SHA-pinned `dafny-lang/setup-dafny-action`
  with `dafny-version: 4.11.0`, then `make proofs`. `make lint` runs
  `actionlint`, which must pass. Optionally run `mbake validate Makefile` if
  `mbake` is installed.
- Seeded faults: apply (a) to (j) to the TypeScript one at a time, and (a)
  and (f) to the specification, run `make proofs`, record each named failure,
  revert.
- Acceptance evidence: `make proofs` succeeds;
  `rg -n 'assume|\{:axiom\}' app/config/custom-css/*.dfy` prints nothing;
  property tests still pass; code gates pass.
- Conformance check: the verified function is the shipped function; the only
  TypeScript changes are `//@` comments.
- Recovery: annotations are comments and can be reverted without behaviour
  change; escalate per the proof-feasibility tolerance.
- Remaining gaps: wiring.
- Compatibility decision: none.

### EP-M6: reporter wiring for user and plugin CSS

- Outcome: users see one warning per change in findings, for global and
  profile CSS and for plugin CSS.
- Requirements and gaps: RM-1.4.19-b, D-4, D-5.
- Red: add `test/unit/custom-css-advisory-reporter.test.ts` (REPORTER).
- Green: add `app/config/custom-css/advisory-reporter.ts` exporting
  `createCustomCssAdvisoryReporter(ports: CustomCssAdvisoryPorts)`, which
  returns
  `{reportConfig(config: configOptions): void; reportPlugin(name:
  string, baseCss: string, decoratedCss: string): readonly string[]}`.
  In `app/config.ts`, create one reporter with the existing `notify` and call
  `reportConfig(cfg.config)` at the start of `checkDeprecatedConfig`, before
  its early return. In `app/plugins.ts` `getDeprecatedConfig`, call
  `reportPlugin` per plugin and add the result as `retiredHooks` to that
  plugin's record; update `shared/src/types/common.ts:192` and
  `lib/transport/ipc-schemas.ts:110`
  (`retiredHooks: z.array(z.string()).optional()`), and make the renderer's
  existing `console.warn` in `lib/utils/plugins.ts:653-659` mention retired
  hooks too. Add `dist/app/config/custom-css/advisory-reporter.js` to
  `targetFilesRequiringResolvableRuntimeImports` in
  `test/e2e/electron.e2e.test.ts`.
- E2E: add WARNING-E2E to `test/e2e/post-removal-hardening.e2e.test.ts`,
  seeding `$XDG_CONFIG_HOME/Hyper/config.json5`.
- Acceptance evidence: unit, behavioural, and E2E checks pass; code gates and
  `make proofs` pass.
- Conformance check: `getDeprecatedCSS` and `htermConfigTranslate`
  unchanged; the only interface changes are those pre-authorized.
- Recovery: revert; the call sites are one line each.
- Remaining gaps: clean-up and guides.
- Compatibility decision: `retiredHooks` is optional, because the IPC
  payload crosses the main/renderer boundary inside one build; no external
  consumer exists.

### EP-M7: compatibility clean-up and supported-hook check

- Outcome: no dead legacy selector remains, retirements are recorded where
  `1.4.17` should have recorded them, and the supported hooks are checked.
- Requirements and gaps: RM-1.4.19-b, D-4.
- Edits: remove `:global(.tabs_list)`, its comment, and the `@file` header
  mention from `lib/components/tabs.module.css`; remove `.tabs_list` from the
  readiness selectors in `test/e2e/electron-e2e-helpers.ts` and
  `test/unit/electron-e2e-helpers.test.ts`; add a comment at each retained
  `term_*` usage in `lib/components/term.tsx` naming `SUPPORTED_STYLE_HOOKS` as
  the contract; add a dated note to the `1.4.17` plan's
  `Outcomes & retrospective` linking ADR-007; add
  `test/e2e-deep/supported-style-hooks.e2e.ts` (HOOKS-PRESENT) and run it once
  locally.
- Acceptance evidence: `rg tabs_list lib test` prints nothing; the fast and
  deep lanes pass; code gates pass.
- Conformance check: no new compatibility classes; retained classes
  unchanged.
- Recovery: revert.
- Remaining gaps: guides.
- Compatibility decision: retained `term_*` classes stay because they are
  already emitted and documented.

### EP-M8: documentation and closure

- Outcome: users' and developers' guides describe the shipped behaviour,
  stale claims are corrected, and the roadmap item is done.
- Requirements and gaps: RM-1.4.19-a, RM-1.4.19-b, RM-1.4.19-c.
- Edits:
  - Create `docs/users-guide.md` with a "Custom CSS" section (anchor
    `#custom-css`): scoping to `#hyper`; the supported hooks; generated names
    are internal; the retired Hyper selectors grouped with D-4's guidance
    (no generated names); the warning and how it is triggered; `termCSS` has
    no effect; under WebGL rendering most `.xterm-*` row styling has no
    effect; the lexical model's gaps. Add a "Security policy for plugin
    authors" section: no inline scripts, handlers, or `javascript:` URLs;
    load code through modules.
  - `docs/developers-guide.md`: replace the `tabs_list` bullet in §CSS modules
    conventions; replace §Preserving legacy plugin-targeted class names with
    "Supported styling hooks", whose rule is "add retired names to
    `RETIRED_STYLE_HOOKS`" and which cites ADR-007; add "Renderer Content
    Security Policy" (no inline scripts or `eval`, the contract and E2E
    guards, the console-forwarding listener); add "Property tests and proofs"
    under §Tests (`fast-check` conventions, `make proofs`, the `.dfy` editing
    rule, the prototype-gate lesson).
  - `docs/velocetty-hyper-codebase.md`: correct the `'unsafe-inline'`
    claims around lines 7123-7136, 7643, 7657, 7935, and 9292, citing ADR-007.
  - `docs/roadmap.md`: mark `1.4.19` and its sub-items done, citing the
    tracking IDs.
- Acceptance evidence: `make markdownlint`, `make nixie`, `make spelling`,
  the code gates, `make proofs`, and `bun run test:e2e:fast` pass;
  `rg tabs_list docs/developers-guide.md` prints nothing.
- Conformance check: every RM item maps to evidence; ADR-007 and the design
  match what shipped; discoveries reconciled.
- Recovery: documentation commits revert cleanly.
- Remaining gaps: the tracked follow-ups.
- Compatibility decision: none.

## Concrete steps

Run every command from the repository root. Capture long output with `tee`:

```bash
make test 2>&1 | tee /tmp/test-velocetty-1-4-19-close-post-removal-hardening-tasks.out
```

### EP-M0

```bash
grep -n '9\.2\.4' docs/roadmap.md
grep -n 'Content-Security-Policy' app/index.html
grep -o 'createElement("style")' node_modules/xterm/lib/xterm.js | wc -l
grep -o 'setAttribute("style"' node_modules/xterm/lib/xterm.js | wc -l
grep -o 'WebAssembly\.[A-Za-z]*' node_modules/xterm-addon-image/lib/*.js | sort -u
rg -n 'tabs_list' lib test docs/developers-guide.md
```

Expected today: `9.2.4` shows `- [ ]`; the CSP is
`script-src 'self' 'unsafe-inline'`; the xterm counts are `2` and at least `1`;
the addon lists `WebAssembly.Instance`, `instantiate`, `Memory`, and `Module`;
`tabs_list` appears in `tabs.module.css`, the E2E helpers and their test, and
the developers' guide.

### EP-M4 retired-name extraction

```bash
for f in $(git show --name-only --format= af0dc0e6 | grep '^lib/.*\.tsx$'); do
  git show "af0dc0e6^:$f" 2>/dev/null
done | grep -oE '\b(tab|tabs|header|term|terms|splitpane|notification|notifications|hyper|new)_[A-Za-z]+\b' | sort -u
```

Expected (55 names):
`header_appTitle header_closeWindow
header_closeWindowLeft header_hamburgerMenuLeft header_hamburgerMenuRight
header_header header_headerRounded header_maximizeWindowLeft
header_minimizeWindowLeft header_shape header_windowControls
header_windowControlsLeft header_windowHeader header_windowHeaderWithBorder
hyper_main hyper_mainRounded new_tab notification_dismissLink
notification_indicator notifications_view splitpane_divider splitpane_pane
splitpane_panes splitpane_shim tab_active tab_first tab_firstActive
tab_hasActivity tab_icon tab_shape tab_tab tab_text tab_textActive
tab_textInner tab_textLast tabs_borderShim tabs_borderShimUndo
tabs_fullScreen tabs_hidden tabs_hiddenNav tabs_list tabs_nav tabs_title
tabs_visible term_active term_fit term_term term_wrapper terms_termGroup
terms_termGroupActive terms_terms terms_termsNotShifted terms_termsShifted`.
Also inspect every component in that commit (for example
`lib/components/search-box.tsx`) for class prefixes the pattern misses. Remove
the four retained `term_*` names before using the list.

### EP-M5

```bash
bunx lsc check --backend=dafny app/config/custom-css/css-class-tokens.ts
make proofs
rg -n 'assume|\{:axiom\}' app/config/custom-css/*.dfy
```

Expected after green: `lsc check` and `make proofs` report `0 errors` and
`git diff --exit-code` succeeds; `rg` prints nothing.

### Every code milestone

```bash
bun run build:packages 2>&1 | tee /tmp/build-packages-velocetty-1-4-19-close-post-removal-hardening-tasks.out
bunx tsgo --project app/tsconfig.build.json 2>&1 | tee /tmp/tsgo-app-velocetty-1-4-19-close-post-removal-hardening-tasks.out
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-1-4-19-close-post-removal-hardening-tasks.out
make lint 2>&1 | tee /tmp/lint-velocetty-1-4-19-close-post-removal-hardening-tasks.out
make test 2>&1 | tee /tmp/test-velocetty-1-4-19-close-post-removal-hardening-tasks.out
```

Run these sequentially, never in parallel; prefer delegating full gate runs to
the `scrutineer` agent. Commit after each milestone passes its gates.

## Validation and acceptance

The item is accepted when all of the following hold:

1. `grep -n 'Content-Security-Policy' app/index.html` shows
   `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`
   (with `'wasm-unsafe-eval'` in `script-src` if D-8 confirmed it).
2. `bun test test/unit/renderer-csp-contract.test.ts` failed before EP-M3
   (recorded) and passes after.
3. `bun run test:e2e:fast` passes, including
   `test/e2e/post-removal-hardening.e2e.test.ts`, and the recorded seeded-fault
   runs show the CSP check failing under both drivers.
4. Launching with `css: '.tab_tab { color: red; }'` prints
   `[Notification] Configuration warning:` naming `.tab_tab`; launching with
   clean configuration prints no such line; saving the configuration again
   without changing it does not repeat the warning.
5. `make proofs` passes locally and in the `proofs` CI job, and each seeded
   fault was rejected (recorded).
6. `docs/tracking-issues.md` contains `CSP-001`, `CSP-002`, `XTERM-001`,
   `CSSCOMPAT-001`, `CSSCOMPAT-002`, `PLUGINCOMPAT-001` (and `CSP-003` if
   applicable), each with `Owner: @leynos`, `Review by`, `Mitigation:`, and an
   issue in the review milestone; the register test passes.
7. ADR-007, `docs/users-guide.md`, `docs/developers-guide.md`,
   `docs/velocetty-design.md`, and `docs/velocetty-hyper-codebase.md` match the
   shipped behaviour, and `docs/roadmap.md` marks `1.4.19` done.

Quality criteria: `make test`, `bun run test:e2e:fast`, and the deep-lane
supported-hook check pass; SCAN-REFINES, SCAN-SOUND, SCAN-COMPLETE, and
SPEC-VALID are discharged by `make proofs`; ADVISE-EXACT and the differential
property pass with recorded evidence; `make check-fmt`, `make lint`,
`make typecheck`, the build projects, `make markdownlint`, `make nixie`, and
`make spelling` pass; the CSP is tighter than before (except a confirmed
`'wasm-unsafe-eval'`), and `webPreferences` are unchanged.

## Idempotence and recovery

Every step is a file edit or a test run and can be repeated. Seeded-fault
changes must be reverted immediately after recording; check `git diff` before
committing. `lsc regen` preserves handwritten proof helpers; never delete a
`.dfy` file to start again. If a GitHub issue is created twice, close the
duplicate with a link. Each milestone is one or more commits, so `git revert`
restores the previous plateau.

## Artefacts and notes

Record here during implementation: EP-M0's three observations and the captured
CSP violation line; the red output of the CSP contract test; the seeded-fault
E2E outputs; the property-test class counts and the 10,000-run output; each
seeded proof fault's Dafny error; the prototype-gate result; and the GitHub
milestone and issue numbers.

## Interfaces and dependencies

New development dependencies: `fast-check@^4.10.2` and `lemmascript@^0.6.5`.
New CI dependency: `dafny-lang/setup-dafny-action` (SHA-pinned), Dafny 4.11.0.
Every exported type field below carries a `/** … */` comment in the real code.

In `app/config/custom-css/css-class-tokens.ts`:

```ts
export type ClassToken = {readonly name: string; readonly start: number};
export const scanClassTokens: (css: string) => readonly ClassToken[];
// Specification functions, also exported for tests:
export const lexStateAt: (css: string, i: number) => LexState;
export const classTokensSpec: (css: string, n: number) => readonly ClassToken[];
```

In `app/config/custom-css/retired-style-hooks.ts`:

```ts
export type SupportedStyleHook = {readonly selector: string; readonly description: string};
export type RetiredStyleHook = {readonly className: string; readonly group: RetiredHookGroup; readonly guidance: string};
export type RetiredHookFinding = {readonly hook: RetiredStyleHook; readonly firstStart: number};
export const SUPPORTED_STYLE_HOOKS: readonly SupportedStyleHook[];
export const RETIRED_STYLE_HOOKS: readonly RetiredStyleHook[];
export const findRetiredStyleHooks: (css: string) => readonly RetiredHookFinding[];
```

In `app/config/custom-css/advisory-policy.ts`:

```ts
export type CustomCssAdvisory =
  | {readonly kind: 'retired-hook'; readonly hook: RetiredStyleHook; readonly source: 'config' | 'profile'}
  | {readonly kind: 'inert-term-css'};
export const collectCustomCssAdvisories: (config: {readonly css: string; readonly termCSS: string}) => readonly CustomCssAdvisory[];
```

In `app/config/custom-css/advisory-reporter.ts`:

```ts
export type CustomCssAdvisoryPorts = {readonly notify: (title: string, body: string) => void};
export const createCustomCssAdvisoryReporter: (ports: CustomCssAdvisoryPorts) => {
  readonly reportConfig: (config: configOptions) => void;
  readonly reportPlugin: (name: string, baseCss: string, decoratedCss: string) => readonly string[];
};
```

In `app/utils/renderer-console-forwarding.ts`:

```ts
export const shouldForwardConsoleMessage: (details: {readonly level: string}) => boolean;
export const formatForwardedConsoleMessage: (details: {
  readonly message: string;
  readonly lineNumber: number;
  readonly sourceId: string;
}) => string;
```

In `test/e2e/csp-violation-detection.ts`:

```ts
export const isCspViolationMessage: (text: string) => boolean;
export const findCspViolations: (messages: readonly string[]) => readonly string[];
```

## Revision note

- 2026-10-29: initial draft from Wyvern reconnaissance and external research.
- 2026-10-29: revised after a four-expert review. Security: corrected
  Electron 40 to 44; found that E2E error forwarding uses a deprecated
  `console-message` signature and may be silent, so EP-M0 now checks it and
  EP-M3 fixes it; documented that `'self'` on `file://` is not strict
  (`CSP-002`); found that sixel images need WebAssembly (D-8); added
  `form-action 'none'` and explicit rejections; tracked inline-script plugin
  breakage (`PLUGINCOMPAT-001`); restated D-3's reasoning and added xterm's
  `style`-attribute writes. Verification: replaced the lexical rules with an
  explicit state machine (escapes, `UrlPre`, bad strings, non-ASCII
  identifiers, preceding-code-unit rule for `url(`); made the specification
  independently validated (example and characterizing lemmas, regex
  differential); specified UTF-16 code-unit semantics; tightened the prototype
  gate; replaced percentage thresholds with by-construction class coverage;
  mapped seeded faults to obligations and added five. Architecture: moved the
  pure modules from `shared/` to `app/config/custom-css/` because `app/` cannot
  import runtime values from `@shared/*`; added the build projects to the
  gates; made the reporter de-duplicate, run before the early return, and scan
  profiles; moved E2E assertions to spawn output and HOOKS-PRESENT to the deep
  lane; specified the CI job. Product: added plugin `decorateConfig` CSS to the
  advisory; removed every quoted generated name; ratified the unrecorded
  `1.4.17` retirements; reordered delivery so tracking lands first (D-9) and
  split it into two PRs; adopted D-1 option (d); corrected D-5's rationale;
  made review dates event-or-date with a GitHub milestone. Remaining work is
  unchanged in intent: approval, then EP-M0.
