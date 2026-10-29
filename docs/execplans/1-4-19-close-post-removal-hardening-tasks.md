# Close post-removal hardening tasks for security and compatibility

This ExecPlan (execution plan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT

Implementation must not begin until this plan is explicitly approved and the
prerequisite roadmap item `9.2.4` is complete or explicitly waived. See
`Decision log` entry D-1.

## Purpose / big picture

Roadmap item `1.4.19` closes the security and compatibility loose ends left
behind when Velocetty removed `styled-jsx` and its Babel bridge (roadmap items
`1.4.16` to `1.4.18`). Two questions remain open.

The first is about the renderer Content Security Policy (CSP). A CSP is a
browser rule set, delivered here as a
`<meta http-equiv="Content-Security-Policy">` tag in `app/index.html`, that
tells Chromium which scripts and styles the page may run. The current policy is
`script-src 'self' 'unsafe-inline'`. Project documentation
(`docs/velocetty-hyper-codebase.md`) says `'unsafe-inline'` is "required for
styled-jsx CSS-in-JS". `styled-jsx` is gone, so that justification is stale.
This plan establishes what still needs `'unsafe-inline'`, removes it where it
is no longer needed, and records every remaining blocker to a stricter policy
with an owner and a review date.

The second is about custom CSS compatibility. Users write custom CSS in the
`css` key of their configuration file, and Hyper-era plugins inject CSS through
`decorateConfig`. Both commonly target Hyper's DOM class names, such as
`.tab_tab` or `.header_header`. The CSS Modules migration replaced almost all
of those names with generated names such as `tab_tabTab`; only four
terminal-pane names survive. Separately, the `termCSS` configuration key has
had no consumer in the renderer for years and silently does nothing. These are
intentional breakages under the product stance ("reuses useful work from
Hyper/Vercel where it helps, without targeting backwards compatibility"), but
they are currently silent and untracked.

After this change, a user or maintainer can observe the following:

1. `app/index.html` ships `script-src 'self'` with no `'unsafe-inline'`, and
   the application starts with no CSP violation messages in the renderer
   console. A contract test and an end-to-end (E2E) check prove both.
2. A user whose `css` configuration targets a retired Hyper class name, for
   example `.tab_tab { color: red; }`, receives a configuration warning that
   names the retired selector and points to the users' guide. A user with a
   non-empty `termCSS` receives a warning that the key has no effect.
3. `docs/users-guide.md` documents which selectors are supported for custom
   CSS, which Hyper selectors were retired, and what to do instead.
4. `docs/tracking-issues.md` lists every remaining follow-up (stricter style
   policy, retired class names, inert `termCSS`, the deprecated `xterm`
   packages) with an owner, a review date, a mitigation, and a GitHub issue.
5. A machine-checked proof shows that the CSS class-token scanner behind the
   warning reports exactly the class selectors that appear outside comments,
   strings, and `url(...)` tokens.

## Constraints

- Do not start implementation until the plan is approved and `9.2.4` is
  complete or explicitly waived by the maintainer (D-1).
- Do not weaken any existing security setting. In particular, do not add
  `'unsafe-eval'`, nonces, hashes, or wildcard sources to `script-src`.
- Do not introduce a `style-src`, `default-src`, `img-src`, `font-src`, or
  `connect-src` directive in this item. Doing so changes plugin and custom CSS
  behaviour beyond what this item has assessed (D-3).
- Do not change `webPreferences` (`nodeIntegration`, `contextIsolation`,
  `sandbox`) in `app/ui/window.ts`. Those are a separate, larger hardening
  decision; this item records them as context only.
- Do not restore retired Hyper class names. Do not add new legacy
  compatibility classes. The four retained terminal classes (`term_fit`,
  `term_term`, `term_active`, `term_wrapper`) stay exactly as they are (D-4).
- Do not change the semantics of the existing `getDeprecatedCSS` and
  `htermConfigTranslate` helpers in `app/config.ts`; the new advisory sits
  beside them.
- Domain and policy logic (the CSS scanner, the retired-hook registry, and the
  advisory policy) must be pure TypeScript under `shared/src/styling/` with no
  Electron, Node, filesystem, or DOM imports. Delivery (notifications,
  configuration loading) stays in `app/`. `bun run check:boundaries` must stay
  green.
- No source file may exceed 400 lines (`AGENTS.md`).
  `test/e2e/electron.e2e.test.ts` is already 541 lines and
  `test/e2e/electron-e2e-helpers.ts` is 376 lines, so new E2E code goes in new
  files.
- Every new module starts with a `/** @file … */` header. Comments and
  documentation use en-GB-oxendict spelling (`make spelling`).
- Tests must not use module mocking (`deslop/no-module-mocking` is an error in
  `.oxlintrc.json`); inject collaborators instead.
- Use caret ranges for any new dependency (`AGENTS.md`).
- `make check-fmt`, `make lint`, and `make test` must pass at the end of every
  milestone. Milestones that touch Markdown also run `make markdownlint` and
  `make nixie`. The proof milestone also runs `make proofs`.

## Tolerances (exception triggers)

- Scope: if implementation needs changes to more than 30 non-ExecPlan files
  or more than 2,000 net lines of code and other documentation, stop and
  escalate. This ExecPlan file is excluded from both counts, as is any
  regenerated `bun.lock` and any generated `.dfy.gen` file.
- Interface: if any exported function, prop, or type outside the new
  `shared/src/styling/` modules and the new
  `app/config/custom-css-advisories.ts` must change signature, stop and
  escalate. `getDeprecatedCSS` and `htermConfigTranslate` keep their signatures.
- Dependencies: this plan pre-authorizes exactly two new development
  dependencies, `fast-check` (`^4.10.2`) and `lemmascript` (`^0.6.5`), plus the
  `dafny-lang/setup-dafny-action` GitHub Action in CI. Any other new dependency
  requires escalation.
- Security posture: if removing `'unsafe-inline'` from `script-src` breaks
  startup in a way that cannot be fixed by moving inline code into the bundle,
  stop and escalate rather than adding hashes or nonces.
- Proof feasibility: if the EP-M4 prototype shows LemmaScript cannot model the
  scanner's string indexing, or the full proof does not verify after three
  focused attempts, stop and escalate with the failing obligations. Do not
  reach for `//@ assume`.
- CI cost: if the new proof CI job adds more than 6 minutes to the Linux leg,
  stop and escalate.
- Iterations: if a gate still fails after three fix-and-rerun cycles, stop and
  escalate with the failing logs.
- Time: if any milestone takes more than one working day of active effort,
  stop and escalate.
- Ambiguity: if the maintainer's answer to D-1, D-3, or D-4 differs from the
  recommendation, revise this plan before continuing.

## Risks

- Risk: roadmap `9.2.4` (styled-jsx removal regression coverage) is not done,
  so this item's prerequisite is unmet. Severity: high. Likelihood: certain at
  the time of writing. Mitigation: the plan is blocked on D-1; EP-M0 re-checks
  the roadmap and refuses to start otherwise.
- Risk: the fast E2E console monitor may not capture Chromium's CSP violation
  messages, which would make the runtime CSP check vacuous. Severity: high.
  Likelihood: low. Mitigation: EP-M2 includes a seeded-fault run (an inline
  script left in place under the tightened policy) that must make the E2E check
  fail before the fix is accepted.
- Risk: `'self'` may behave unexpectedly for `file://` pages in Electron 40
  once `'unsafe-inline'` is gone. Severity: medium. Likelihood: low; the bundle
  already loads under `'self'` today. Mitigation: the E2E run in EP-M2 is the
  arbiter; the security-posture tolerance applies.
- Risk: LemmaScript is a technology preview; string indexing, the datatype
  encoding of tokens, or loop invariants may not translate cleanly. Severity:
  medium. Likelihood: medium. Mitigation: EP-M4 starts with a disposable
  prototype and a go/no-go gate; fast-check properties in EP-M3 already provide
  a regression net if the proof is delayed.
- Risk: the advisory produces false positives (for example `.tab_tab` inside
  an unusual declaration value) or false negatives (escaped identifiers such as
  `.tab\_tab`, or attribute selectors such as `[class~="tab_tab"]`). Severity:
  low; the advisory only warns. Likelihood: medium. Mitigation: the lexical
  rules are specified and proved; the residual gaps are documented in the
  users' guide and ADR-007.
- Risk: the notification path in `app/notify.ts` may not be observable in the
  fast E2E lane, making the user-facing warning hard to assert end to end.
  Severity: medium. Likelihood: medium. Mitigation: EP-M5 first proves the
  adapter with behavioural tests; the E2E check asserts the warning text via
  whichever channel the fast lane can observe (renderer DOM or main-process
  log). If neither works, record the gap and escalate.
- Risk: internal class names quoted in the users' guide drift as CSS Modules
  change. Severity: low. Likelihood: high over time. Mitigation: a contract
  test checks every internal name quoted by the registry against the built
  renderer CSS, and the guide states that internal names are unsupported.
- Risk: adding a Dafny job to CI is slow or flaky. Severity: low.
  Likelihood: medium. Mitigation: pin the Dafny version, cache it, and apply
  the CI-cost tolerance.

## Progress

- [x] (2026-10-29 17:00Z) Renamed the branch to
  `1-4-19-close-post-removal-hardening-tasks`.
- [x] (2026-10-29 17:20Z) Reconnaissance with a Wyvern team: CSP and style
  injection, plugin and custom CSS compatibility, and test and gate
  infrastructure.
- [x] (2026-10-29 17:40Z) External research on Electron CSP guidance, CSP
  `style-src` semantics, and xterm.js CSP behaviour.
- [x] (2026-10-29 18:10Z) First draft of this ExecPlan.
- [ ] Community-of-experts design review and revision.
- [ ] Maintainer approval of the plan and decisions D-1, D-3, and D-4.
- [ ] EP-M0: prerequisite check and baseline evidence.
- [ ] EP-M1: ADR-007 and design-document decisions.
- [ ] EP-M2: remove `'unsafe-inline'` from `script-src`.
- [ ] EP-M3: pure CSS class-token scanner, retired-hook registry, and advisory
  policy, with unit and property tests.
- [ ] EP-M4: LemmaScript proof of scanner soundness and completeness.
- [ ] EP-M5: configuration advisory adapter and user-facing warnings.
- [ ] EP-M6: compatibility clean-up of dead legacy selectors and a retained
  hook contract check.
- [ ] EP-M7: tracking issues, users' guide, developers' guide, and roadmap
  closure.

## Surprises & discoveries

- Observation: the shipped CSP never restricted styles at all.
  Evidence: `app/index.html:8` sets only `script-src 'self' 'unsafe-inline'`;
  there is no `style-src` or `default-src`. Impact: `styled-jsx` never needed a
  style exemption. The "inline style transform" constraint in the roadmap
  really refers to the `script-src 'unsafe-inline'` that the documentation
  attributed to `styled-jsx`.
- Observation: the only remaining consumers of `script-src 'unsafe-inline'`
  are two one-line inline scripts in `app/index.html` (lines 34 and 37) that
  time renderer start-up. Evidence: direct inspection; no `eval`,
  `new Function`, or inline event handlers exist in `lib/`, `app/`, `build/`, or
  `shared/`. Impact: `'unsafe-inline'` can be removed by moving the timing
  into the bundle.
- Observation: the installed `xterm@5.3.0` DOM renderer injects `<style>`
  elements with `document.createElement("style")` for theme and dimension
  rules. Evidence: `node_modules/xterm/lib/xterm.js` (two call sites, in
  `_injectCss` and the dimensions update). Upstream fixed this with constructed
  stylesheets (xterm.js PR #4611 for issue #4445) in a later release; the
  unscoped `xterm` and `xterm-addon-*` packages are deprecated in favour of
  `@xterm/*` since 5.4.0. Impact: a future `style-src` without
  `'unsafe-inline'` is blocked by xterm until the `@xterm/*` migration, even
  though Velocetty normally renders through the WebGL or canvas addons.
- Observation: user custom CSS reaches the page through
  `<style dangerouslySetInnerHTML={{__html: stylis('#hyper', customCSS)}} />` in
  `lib/containers/hyper.tsx:130`. Impact: also a future `style-src` blocker;
  it could move to a constructed stylesheet (`CSSStyleSheet` with
  `document.adoptedStyleSheets`), which is not governed by `style-src`.
- Observation: React `style={…}` props and direct `element.style.x = …`
  writes use the CSS Object Model (CSSOM) and are not blocked by `style-src`;
  `setAttribute('style', …)`, `style.cssText`, and `style="…"` in parsed markup
  are. Evidence: MDN `style-src` reference, "Violation cases". Impact:
  Velocetty's own 19 React style props are not blockers.
- Observation: `termCSS` has no consumer. `lib/containers/terms.ts:27` maps it
  to a `customCSS` prop that no component reads, and the pre-migration
  `StyleSheet` component ignored it too. Evidence:
  `git show af0dc0e6^:lib/components/style-sheet.tsx`. Impact: this is a
  pre-existing silent breakage, not a regression from `1.4.18`, but it belongs
  in the compatibility record.
- Observation: of roughly 55 Hyper class names in use before the migration,
  only `term_fit`, `term_term`, `term_active`, and `term_wrapper` are still
  emitted. `tabs.module.css` keeps a `:global(.tabs_list)` rule "for Hyper
  plugin compatibility", but no element carries `tabs_list`, so the rule is
  dead. Evidence: `git show af0dc0e6^:lib/components/*.tsx` versus current
  `lib/components/*.tsx`; `lib/components/tabs-component.tsx:87`. Impact: the
  developers' guide example cites a compatibility rule that preserves nothing.
- Observation: `styled-jsx` was never in the plugin module allowlist
  (`lib/utils/plugins.ts:403-437`, `app/plugins.ts:121-153`). A plugin that
  imports `styled-jsx/style` resolves it from its own `node_modules`, before
  and after `1.4.18`. Impact: removing `styled-jsx` from the host did not
  change plugin module resolution.
- Observation: `app/config.ts` already carries Hyper's precedent for this
  exact problem: `getDeprecatedCSS` warns about hterm-era selectors and
  `htermConfigTranslate` rewrites some of them. Its detection is a raw
  substring check (`config.css.includes(css)`). Impact: the new advisory
  follows the same user-facing pattern but uses a proved lexical scanner, so
  `.tab_tabTab` does not trigger a warning for `.tab_tab`.
- Observation: `docs/tracking-issues.md` entries have `Status`, `Owner`,
  `Last updated`, and an optional `Issue` field, but no review date. Impact:
  the success criterion requires review dates, so EP-M7 adds a `Review by`
  field.

## Decision log

- D-1 (prerequisite): roadmap `1.4.19` requires `9.2.4`, which is unchecked
  in `docs/roadmap.md`. Options: (a) wait for `9.2.4` to land, then implement
  this plan; (b) the maintainer waives the dependency, accepting that this
  item's E2E checks run without `9.2.4`'s parity coverage; (c) fold the `9.2.4`
  work into this item. Recommendation: (a). Option (c) would double the scope
  and blur two roadmap items. Status: awaiting maintainer decision.
  Date/Author: 2026-10-29, planning agent.
- D-2 (script policy): remove `'unsafe-inline'` from `script-src` by moving
  the two inline timing scripts into the renderer bundle, rather than allowing
  them with SHA-256 hashes or a nonce. Rationale: a static `file://` page
  cannot have a per-load secret nonce, and hashes couple the policy to
  incidental script text. Moving the code removes the need entirely and leaves
  the simplest policy, `script-src 'self'`. Also add `object-src 'none'` and
  `base-uri 'none'`, which no current code needs and which close two well-known
  injection routes at no compatibility cost. The start-up timing log changes
  meaning slightly: it will measure from navigation start via
  `performance.now()` inside the bundle instead of from an inline marker before
  the bundle. Date/Author: 2026-10-29, planning agent.
- D-3 (style policy): do not add `style-src` in this item. Record the
  blockers in ADR-007 and tracking issue `CSP-001` instead. Rationale: the
  blockers are (1) the inline `<style>` block in `app/index.html`, (2) the
  custom CSS `<style>` element in `lib/containers/hyper.tsx`, (3) the
  `xterm@5.3.0` DOM renderer's `<style>` elements, and (4) third-party plugins
  that render `<style>` elements or `style="…"` markup. Items 1 and 2 are cheap
  to fix, but item 3 needs the `@xterm/*` migration and item 4 is plugin
  breakage that the maintainer has not accepted. While the renderer runs with
  `nodeIntegration: true` and `contextIsolation: false`, any script injection
  is already full code execution, so `style-src` buys little until those
  settings change. The marginal threat it would address, CSS-based data
  exfiltration, is out of scope here. Alternatives considered: fix items 1 and
  2 now and ship `style-src 'self'` (rejected: breaks xterm's DOM renderer path
  and unknown plugins); ship `style-src 'self' 'unsafe-inline'` (rejected: no
  security value). Status: recommended; needs maintainer confirmation.
  Date/Author: 2026-10-29, planning agent.
- D-4 (class-name compatibility): treat the retired Hyper class names as an
  intentional breakage. Do not restore them. Publish a small supported styling
  surface (`#hyper`, `.fullScreen`, the four retained `term_*` classes, and
  xterm's own `.xterm*` classes, which xterm owns), state that CSS Modules
  generated names (`<file>_<localName>`) are internal and may change, and warn
  users whose `css` targets a retired name. Rationale: the product requirements
  document (PRD) rejects backwards compatibility and plugin reliance on
  internal implementation details; the design document replaces DOM decoration
  with stable plugin APIs. A warning turns a silent breakage into an actionable
  one, following the existing `getDeprecatedCSS` precedent. Alternatives
  considered: restore all legacy classes as dual classes (rejected: re-creates
  the internal-detail contract the PRD rejects); automatically rewrite retired
  selectors to current generated names, like `htermConfigTranslate` (rejected:
  it would make generated names a de facto public contract). Status:
  recommended; needs maintainer confirmation. Date/Author: 2026-10-29, planning
  agent.
- D-5 (`termCSS`): keep the `termCSS` key in the schema for now, and warn
  when it is non-empty that it has no effect and that rules belong in `css`.
  Track removal as `CSSCOMPAT-002`. Rationale: removing the key would make
  existing configuration files fail schema validation, which is a harsher
  failure than the silent no-op it replaces. Date/Author: 2026-10-29, planning
  agent.
- D-6 (architecture): pure policy in `shared/src/styling/`, a thin adapter in
  `app/config/custom-css-advisories.ts`, and the existing `notify` function as
  the driven port. Do not model the CSP as a domain object: it is static
  configuration in one HTML file, and a builder or serializer would be a
  pattern transplant with no second consumer. Validate it with a contract test
  instead. Date/Author: 2026-10-29, planning agent.
- D-7 (verification tooling): add `fast-check` for property tests and
  `lemmascript` with Dafny for the scanner proof, as the task requires. Wire
  the proof into a `make proofs` target and a CI job so it cannot rot.
  Date/Author: 2026-10-29, planning agent.

## Outcomes & retrospective

Not started. Complete this section at each milestone boundary and at
completion, comparing the result against `Purpose / big picture`.

## Context and orientation

Velocetty is a fork of the Hyper terminal. It is an Electron application: a
main process (`app/`) creates windows, and each window runs a renderer process
that loads `app/index.html` and the React bundle built from `lib/index.tsx`.
Shared pure code lives in `shared/src/` and is imported through the `@shared/*`
path alias. `bun run check:boundaries` (`scripts/check-package-boundaries.mjs`)
enforces the import direction.

Renderer styling now uses CSS Modules. esbuild builds `lib/index.tsx` with
loaders `'.css': 'css'` and `'.module.css': 'local-css'`
(`build/esbuild/run-esbuild.ts:60-85`) and emits a separate
`dist/app/renderer/bundle.css`, which `app/index.html` links. esbuild's default
`local-css` naming produces `<file stem>_<local name>`, for example
`tab_tabTab` from `.tabTab` in `tab.module.css`.
`test/unit/esbuild-migration-contracts.test.ts` (370 lines) is the existing
bundle-contract test and shows how to run the renderer build in memory with
`runEsbuildBuild({...createRendererBuildOptions(...), write: false})`.

`app/index.html` contains, in order: a CSP meta tag
(`script-src 'self' 'unsafe-inline'`), an inline `<style>` block with base
resets, `<div id="mount">`, an inline script `start = performance.now();`, the
stylesheet link, `renderer/bundle.js`, and an inline script that logs
`total init time`. `build/esbuild/copy-artefacts.ts:113` copies the HTML into
`dist/app/` unchanged. Nothing else reads the `start` global.

The renderer window is created in `app/ui/window.ts:104-108` with
`nodeIntegration: true` and `contextIsolation: false`. Plugins load through
Node's `require` with a `Module._load` allowlist
(`lib/utils/plugins.ts:393-437`). CSP does not govern Node's `require`.

User custom CSS: `app/config/config-default.json` defines `css` and `termCSS`
as empty strings. The `css` value flows through `state.ui.css` into
`lib/containers/hyper.tsx`, which scopes it to `#hyper` with `stylis` and
renders it as an inline `<style>` element. `termCSS` reaches
`lib/containers/terms.ts:27` and is never read. Plugin `decorateConfig` hooks
run in the main process (`app/plugins.ts`) and may append to `css`.

Configuration warnings: `app/config.ts` defines `getDeprecatedCSS` and
`checkDeprecatedConfig`, which calls `notify('Configuration warning', …)` from
`app/notify.ts` at start-up (line 159) and after each reload (line 69).
`app/config.ts` imports Electron and `chokidar`, so new logic that needs tests
goes in a separate module with injected collaborators.

Tests: `make test` runs `bun test --concurrent --isolate test/unit`.
`bun run test:e2e:fast` runs the fast Electron lane
(`test/e2e/electron.e2e.test.ts`, gated by `RUN_E2E=1`), whose helpers
(`test/e2e/electron-e2e-helpers.ts`) collect renderer console errors and drop
known non-critical ones with `isNonCriticalRendererError`. The deep Playwright
lane lives in `test/e2e-deep/` (`bun run test:e2e:deep`). The memory note
"Velocetty local E2E headless" in the maintainer's environment describes
running the fast lane locally with `--ozone-platform=headless`. There is no
`fast-check`, LemmaScript, or Dafny use in the repository yet; Dafny 4.11 is
installed on the development host at `~/.local/bin/dafny`.

Terms used in this plan:

- Content Security Policy (CSP): a list of directives, such as `script-src`,
  that tell the browser which sources of script or style may execute. `'self'`
  means "same origin as the page"; `'unsafe-inline'` allows inline
  `<script>`/`<style>` blocks and inline attributes.
- Constructed stylesheet: a `CSSStyleSheet` created in script and attached
  with `document.adoptedStyleSheets`. It is not subject to `style-src`.
- Class-token scanner: the pure function this plan introduces to find CSS
  class selectors (`.name`) in a stylesheet string, ignoring comments, strings,
  and `url(...)` contents.
- Retired hook: a Hyper DOM class name that Velocetty no longer emits.
- Supported hook: a selector Velocetty promises to keep for custom CSS.
- LemmaScript: a toolchain that turns `//@` specification comments in
  TypeScript into Dafny code, which the Dafny verifier then proves.

Documentation and skills to keep open while implementing:

- `docs/roadmap.md` §1.4.19 and §9.2.4.
- `docs/velocetty-product-requirements-document.md` §Product stance.
- `docs/velocetty-design.md` §Plugin system redesign, §Renderer styling
  migration model, §Testing, observability, and performance.
- `docs/velocetty-hyper-codebase.md` around lines 7100-7660 and 9292 (stale
  CSP claims to correct).
- `docs/adr-002-replace-webpack-babel-with-esbuild.md` (CSP-safe module
  shims) and `docs/adr-005-enhance-e2e-testing-strategy.md` (fast and deep
  lanes).
- `docs/developers-guide.md` §CSS modules conventions, §Tests,
  §Preserving legacy plugin-targeted class names.
- `docs/documentation-style-guide.md` (ADR format, roadmap conventions).
- `docs/tracking-issues.md`.
- Skills: `execplans`, `typescript-router`,
  `typescript-boundaries-and-validation`, `electron-and-ipc`,
  `typescript-testing`, `typescript-verification`, `fast-check`, `lemmascript`,
  `hexagonal-architecture`, `biome-typescript`, `typescript-quality-tools`,
  `en-gb-oxendict-style`, `commit-message`, `pr-creation`, `codegraph-mcp`, and
  `firecrawl-mcp` for any further external lookups.

## Conformance basis

Upstream artefacts, at the revision of `main` commit `40949b2f`:

- PRD: `docs/velocetty-product-requirements-document.md`, §Product stance
  (PRD-STANCE: no backwards-compatibility target; plugins must not rely on
  internal implementation details).
- Technical design: `docs/velocetty-design.md`, §Plugin goals
  (TDD-PLUGIN-GOALS: avoid fragile UI decoration hooks) and §Renderer styling
  migration model (TDD-STYLING).
- ADR-002 (`docs/adr-002-replace-webpack-babel-with-esbuild.md`), which
  forbids `eval` or `Function` escape hatches under a `script-src` without
  `'unsafe-eval'` (ADR2-CSP).
- ADR-005 (`docs/adr-005-enhance-e2e-testing-strategy.md`): fast-lane
  renderer readiness and critical console-error assertions (ADR5-FAST).
- Roadmap requirements: RM-1.4.19-a (reassess CSP constraints tied to inline
  style transform behaviour and document any remaining blocker), RM-1.4.19-b
  (confirm plugin and custom CSS compatibility expectations and open tracking
  issues for intentional breakage with ownership and mitigation), and
  RM-1.4.19-c (follow-ups resolved or tracked with explicit owners and review
  dates).
- No Terms of Reference document exists for this project.

Trace links:

```plaintext
RM-1.4.19-a -> ADR2-CSP -> D-2 -> EP-M2 -> test/unit/renderer-csp-contract.test.ts
RM-1.4.19-a -> ADR2-CSP -> D-2 -> EP-M2 -> test/e2e/post-removal-hardening.e2e.test.ts::no CSP violations
RM-1.4.19-a -> D-3 -> EP-M1 -> docs/adr-007-renderer-csp-and-custom-css-compatibility.md
RM-1.4.19-a -> D-3 -> EP-M7 -> docs/tracking-issues.md::CSP-001, XTERM-001
RM-1.4.19-b -> PRD-STANCE, TDD-PLUGIN-GOALS -> D-4 -> EP-M3, EP-M4, EP-M5 -> shared/src/styling/*, app/config/custom-css-advisories.ts
RM-1.4.19-b -> D-4 -> EP-M6 -> test/e2e/post-removal-hardening.e2e.test.ts::supported hooks present
RM-1.4.19-b -> D-5 -> EP-M5, EP-M7 -> termCSS advisory, docs/tracking-issues.md::CSSCOMPAT-002
RM-1.4.19-c -> EP-M7 -> docs/tracking-issues.md (Owner, Review by), test/unit/tracking-issues-register.test.ts
```

## Verification plan

The change introduces one piece of non-trivial logic, the class-token scanner,
and several static or behavioural contracts. Each obligation below names its
method, artefact, evidence, and non-vacuity check.

### Axioms (trusted, not verified here)

- AX-1: Chromium in Electron 40 enforces a meta-delivered CSP on `file://`
  pages according to CSP Level 3, including `'self'` matching the bundle and
  stylesheet loaded beside `index.html`. This is exercised by the E2E start-up
  check rather than proved.
- AX-2: Chromium reports blocked inline scripts as error-level console
  messages whose text contains "Content Security Policy". The fast lane
  forwards these as `[e2e][renderer-error]` lines. EP-M2's seeded-fault run
  exercises this axiom.
- AX-3: CSSOM writes (`element.style.x = …`, `style.setProperty`) and
  constructed stylesheets are not governed by `style-src`; `<style>` elements,
  `style="…"` markup, `setAttribute('style', …)`, and `style.cssText` are (MDN
  `style-src` reference). This is used only for documentation of blockers.
- AX-4: `xterm@5.3.0`'s DOM renderer creates `<style>` elements (observed in
  `node_modules/xterm/lib/xterm.js`).
- AX-5: Node's `require` and `Module._load` are not governed by CSP.
- AX-6: LemmaScript's model of `string` as a sequence of characters, with
  `s.length` and `s[i]` as sequence length and indexing, is faithful for the
  ASCII comparisons the scanner makes, and Dafny 4.x is sound. LemmaScript
  treats `number` as a mathematical integer; the scanner only uses indices
  bounded by `css.length`, so the 2^53 limit is irrelevant.

### Lexical specification of the scanner

The scanner works over a deliberately small lexical model of CSS, chosen so
that each rule is checkable:

1. Outside any special region, `/*` opens a comment that ends at the next
   `*/` (or end of input).
2. Outside any special region, `"` or `'` opens a string that ends at the next
   unescaped matching quote (or end of input). A backslash inside a string
   escapes the next character.
3. Outside any special region, the case-insensitive sequence `url(` opens an
   unquoted URL region that ends at the next `)`. A quoted URL such as
   `url("a.b")` falls under rule 2 because the quote is seen first after `url(`.
4. Outside any special region, a `.` followed by an identifier-start
   character (`A-Z`, `a-z`, `_`, or `-` followed by `A-Z`, `a-z`, or `_`)
   starts a class token. The token name is the longest following run of
   identifier characters (`A-Z`, `a-z`, `0-9`, `_`, `-`).
5. Backslash escapes in identifiers are not decoded. `.tab\_tab` is not
   reported as `tab_tab`. This is a documented false negative.

### Obligations

- Obligation SCAN-SOUND: every token reported by `scanClassTokens(css)` has
  a start index `i` such that the lexical state before `i` is "normal",
  `css[i] === '.'`, rule 4 holds at `i + 1`, and the name is the maximal
  identifier run starting at `i + 1`. Method: formal proof (LemmaScript to
  Dafny), plus fast-check properties. Rationale: the advisory's correctness is
  exactly the scanner's correctness, and the input space (arbitrary user CSS)
  is unbounded. Domain: all strings. Artefact:
  `shared/src/styling/css-class-tokens.ts` with `//@` annotations;
  `shared/src/styling/css-class-tokens.dfy` (proof helpers);
  `test/unit/css-class-tokens.property.test.ts`. Evidence: `make proofs`
  reports the scanner verified with zero errors;
  `bun test test/unit/css-class-tokens.property.test.ts` passes. Non-vacuity:
  the proof's precondition is `true` (every string is admissible), so the
  antecedent is inhabited. The empty string, `.a`, and `/*.a*/` are named
  witnesses for the empty, reported, and suppressed cases. Seeded faults that
  must be rejected: (a) treating `//` as a comment opener, (b) forgetting to
  honour backslash escapes inside strings, (c) ending the name one character
  early. Each must make Dafny report a failed postcondition or invariant and
  make at least one property fail.
- Obligation SCAN-COMPLETE: for every index `i` that satisfies the
  SCAN-SOUND conditions, the output contains a token starting at `i`, and
  tokens appear in strictly increasing start order with no duplicates. Method,
  rationale, domain, and artefacts: as SCAN-SOUND. Evidence: as SCAN-SOUND.
  Non-vacuity: seeded fault (d), skipping the character after a reported
  token's name, must be rejected, as must (e), failing to return to the normal
  state after a comment closes.
- Lemma SCAN-REFINES: the imperative single-pass loop maintains
  `state === lexStateAt(css, i)`, where `lexStateAt` is a pure recursive
  function over the prefix `css[0..i)` that encodes rules 1 to 3. SCAN-SOUND
  and SCAN-COMPLETE are proved about `lexStateAt` and transfer to the loop.
  Method: LemmaScript loop invariants and Dafny helper lemmas. Rationale:
  refinement to a pure specification is the recommended structure for
  loop-heavy code and keeps the specification independent of the loop.
  Non-vacuity: the proof must not use `//@ assume`; review the `.dfy` diff for
  any `assume` or added axiom before accepting it.
- Obligation ADVISE-EXACT: `findRetiredStyleHooks(css)` reports a retired
  hook `h` if and only if some scanned token's name equals `h` exactly.
  Findings are de-duplicated and ordered by first occurrence. Method:
  fast-check property against an independent oracle, plus named examples.
  Rationale: once the scanner is proved, this is a simple filter and map;
  sampling is proportionate. Domain: CSS strings generated from a fragment
  grammar (selectors, comments, strings, `url(...)`, declarations) that records
  where retired names were placed in "live" selector positions. The oracle is
  the generator's own record, not a second scanner. Artefact:
  `test/unit/retired-style-hooks.property.test.ts`. Evidence: the property
  passes at the default 100 runs in `make test` and at 10,000 runs in a one-off
  local run recorded in `Artifacts and notes`. Non-vacuity: use `fc.statistics`
  (or a classification counter) to show that each run includes retired names in
  selectors, inside comments, inside strings, inside `url(...)`, and as
  prefixes of longer names such as `tab_tabTab`. Reject the run if any class
  has under 5 % of cases. Seeded fault: replacing exact comparison with
  `startsWith` must fail the prefix class.
- Obligation REG-WELLFORMED: the retired and supported hook sets are
  disjoint; every retired name matches `^[a-z]+_[A-Za-z]+$`; every internal
  name quoted in a retired entry's guidance exists as a class in the built
  renderer CSS. Method: parameterized unit test plus a bundle contract test.
  Artefact: `test/unit/retired-style-hooks.test.ts` and
  `test/unit/retired-style-hooks-bundle-contract.test.ts`. Non-vacuity: the
  contract test must fail if one quoted internal name is misspelt (seeded
  fault, reverted).
- Obligation TERMCSS-ADVISE: the advisory policy reports "termCSS has no
  effect" if and only if `termCSS.trim()` is non-empty. Method: table test over
  empty, whitespace-only, comment-only, and real CSS values. Rationale: a
  finite partition. Artefact: `test/unit/custom-css-advisories.test.ts`.
- Obligation ADAPTER-NOTIFY: given a configuration with retired hooks or
  non-empty `termCSS`, `reportCustomCssAdvisories(config, {notify})` calls
  `notify` exactly once with the title `Configuration warning` and a body that
  names each retired selector and the users' guide; given a clean configuration
  it does not call `notify`. Method: behavioural unit tests with an injected
  recording `notify`. Artefact: `test/unit/custom-css-advisories.test.ts`.
  Non-vacuity: the clean-configuration case must observe zero calls, and the
  retired case must observe the selector text, so an adapter that always or
  never notifies fails.
- Obligation CSP-STATIC: `app/index.html` has exactly one CSP meta tag; its
  `script-src` is exactly `'self'`; it contains `object-src 'none'` and
  `base-uri 'none'`; the document contains no inline `<script>` elements (every
  `<script>` has a `src`) and no `on*` event-handler attributes. Method:
  contract unit test that parses the HTML with Happy DOM's `DOMParser`.
  Rationale: one static file, so a direct contract check is exact. Artefact:
  `test/unit/renderer-csp-contract.test.ts`. Evidence: red against the current
  `app/index.html` (it has `'unsafe-inline'` and two inline scripts), green
  after EP-M2.
- Obligation CSP-RUNTIME: launching the built application through the fast
  E2E lane produces zero renderer console errors that mention "Content Security
  Policy" before renderer readiness and for two seconds afterwards. Method: E2E
  (fast lane). Artefact: `test/e2e/post-removal-hardening.e2e.test.ts` and
  helper `test/e2e/csp-violation-detection.ts`. Non-vacuity: a unit test of the
  helper uses a recorded real Chromium violation line and must classify it as a
  violation. A one-off seeded-fault run (tightened policy with one inline
  script left in place) must make the E2E check fail; record the failing output
  in `Artifacts and notes`, then revert the fault.
- Obligation HOOKS-PRESENT: after start-up, the renderer DOM contains at least
  one element for each supported terminal hook (`.term_fit`, `.term_term`,
  `.term_wrapper`), the active pane carries `.term_active`, and `#hyper`
  exists. Method: E2E (fast lane). Artefact:
  `test/e2e/post-removal-hardening.e2e.test.ts`. Non-vacuity: the query list
  comes from the registry's supported set, so an empty registry would fail a
  separate unit assertion that the set has exactly the six documented hooks.
- Obligation TRACK-REGISTER: each tracking issue introduced by this item
  (`CSP-001`, `XTERM-001`, `CSSCOMPAT-001`, `CSSCOMPAT-002`) has a non-`TBD`
  `Owner`, a `Review by` date in `YYYY-MM-DD` form, a mitigation, and an
  `Issue` link. Method: unit test that parses `docs/tracking-issues.md`.
  Artefact: `test/unit/tracking-issues-register.test.ts`. Non-vacuity: the test
  enumerates the four IDs explicitly, so deleting an entry fails it.

Residual gaps, recorded for ADR-007 and the users' guide: escaped identifiers,
attribute selectors on `class`, and selectors built at runtime by plugins are
not detected. CSS nesting and `@import` are scanned only lexically. The proof
covers the scanner, not the advisory adapter or the notification channel.

## Plan of work

### Stage A: confirm and decide (no code)

EP-M0 confirms that `9.2.4` is complete (or waived), records baseline gate
results, and captures the evidence listed under `Surprises & discoveries` again
against the then-current tree, because `9.2.4` may have changed it. EP-M1
writes ADR-007 and the design-document updates so that every later change
implements a recorded decision.

### Stage B: red tests and failing verification artefacts

Each code milestone starts by adding the smallest failing test. EP-M2 starts
with `test/unit/renderer-csp-contract.test.ts`, which fails on the current
HTML. EP-M3 starts with the named-example tests for the scanner and the
advisory, which fail because the modules do not exist. EP-M4 starts with
annotated specifications whose proof obligations Dafny reports as open.

### Stage C: implementation with verification

EP-M2 moves the timing scripts into the bundle and tightens the policy. EP-M3
implements the pure modules and property tests. EP-M4 completes the proof.
EP-M5 wires the adapter. EP-M6 removes dead compatibility code and adds the
supported-hook E2E check.

### Stage D: documentation, tracking, and closure

EP-M7 opens the GitHub issues, writes the tracking entries, the users' guide,
and the developers' guide updates, corrects the stale CSP claims, and marks the
roadmap item done.

## Milestones and plateaus

### EP-M0: prerequisite check and baseline

- Outcome: a recorded go/no-go. No repository changes except this plan.
- Requirements and gaps: D-1.
- Steps: confirm `9.2.4` is checked in `docs/roadmap.md` (or that the
  maintainer waived it in writing, recorded in D-1). Run `make check-fmt`,
  `make lint`, `make test`, and `bun run test:e2e:fast` and record results.
  Re-run the evidence commands in `Concrete steps` §EP-M0 and update
  `Surprises & discoveries` if anything moved.
- Acceptance evidence: all four commands pass on the unmodified tree.
- Conformance check:
  - D-1 resolved.
  - Design unchanged.
  - Baseline facts still true.
  - No interface, dependency, trust-boundary, or format change.
  - Trace links current.
- Recovery: none needed; this milestone changes nothing.
- Remaining gaps: everything else.
- Compatibility decision: none.

### EP-M1: ADR-007 and design decisions

- Outcome: `docs/adr-007-renderer-csp-and-custom-css-compatibility.md` exists
  with status `Accepted` once the maintainer confirms D-2 to D-5, and
  `docs/velocetty-design.md` references it.
- Requirements and gaps: RM-1.4.19-a (documentation part), RM-1.4.19-b
  (expectations part).
- Edits:
  - New ADR following `docs/documentation-style-guide.md`: title
    `# Architectural decision record (ADR) 007: Renderer CSP and custom CSS
    compatibility after styled-jsx removal`; sections Status, Date, Context
    and Problem Statement, Decision Drivers, Options Considered (with a
    captioned table for the style-policy options), Decision Outcome, Known
    Risks and Limitations (the residual scanner gaps), and Outstanding
    Decisions (`webPreferences` hardening, `style-src`).
  - `docs/velocetty-design.md` §Renderer styling migration model: add a
    "Custom CSS compatibility contract" subsection listing supported hooks,
    the internal-name rule, and the advisory, citing ADR-007. While editing,
    remove the stray blank lines between every line in that section.
  - `docs/velocetty-design.md`: add a short "Renderer Content Security
    Policy" subsection under the security material (or beside §Plugin command
    security) stating the shipped policy and the D-3 blockers.
- Acceptance evidence: `make markdownlint`, `make nixie`, `make check-fmt`,
  `make lint`, and `make test` pass.
- Conformance check: ADR-007 matches D-2 to D-5 word for word in substance;
  no code changed.
- Recovery: revert the documentation commit.
- Remaining gaps: implementation.
- Compatibility decision: none.

### EP-M2: remove `'unsafe-inline'` from `script-src`

- Outcome: `app/index.html` ships
  `script-src 'self'; object-src 'none'; base-uri 'none'`, has no inline
  scripts, and the app starts cleanly.
- Requirements and gaps: RM-1.4.19-a, D-2.
- Red: add `test/unit/renderer-csp-contract.test.ts` (CSP-STATIC). Run it
  and observe failures for `'unsafe-inline'`, the missing directives, and the
  two inline scripts.
- Red (runtime guard): add `test/e2e/csp-violation-detection.ts` exporting
  `isCspViolationMessage(text: string): boolean` and
  `findCspViolations(messages: readonly string[]): string[]`, with
  `test/unit/csp-violation-detection.test.ts` covering a recorded Chromium
  violation line, a non-CSP error, and an empty list. Add
  `test/e2e/post-removal-hardening.e2e.test.ts` with the CSP-RUNTIME check,
  reusing `startRendererConsoleMonitor` and the launch helpers from
  `test/e2e/electron-e2e-helpers.ts`. Extend the `test:e2e:run` script in
  `package.json` to run both E2E files.
- Green: delete both inline `<script>` elements from `app/index.html`. In
  `lib/index.tsx`, after the existing bootstrap completes, log
  `console.log('total init time', performance.now())`, with a comment that the
  value is measured from navigation start since the inline marker was removed
  for CSP (D-2). Change the meta content to
  `script-src 'self'; object-src 'none'; base-uri 'none'`.
- Seeded fault (non-vacuity for CSP-RUNTIME): temporarily re-add
  `<script>window.__cspProbe = 1;</script>` under the new policy, run
  `bun run test:e2e:fast`, confirm the new check fails with a "Content Security
  Policy" message, record the output, and revert.
- Acceptance evidence: CSP-STATIC passes; `bun run test:e2e:fast` passes
  with the new file; `make check-fmt`, `make lint`, and `make test` pass.
- Conformance check: script policy strictly tighter than before; no style
  directive added (D-3); no `webPreferences` change.
- Recovery: revert the commit; the old policy is one line.
- Remaining gaps: style policy (tracked in EP-M7).
- Compatibility decision: none. No external consumer depends on the inline
  `start` global.

### EP-M3: pure scanner, registry, and advisory policy

- Outcome: three pure modules under `shared/src/styling/` with unit and
  property tests.
- Requirements and gaps: RM-1.4.19-b, D-4, D-5, D-6.
- Red: add `test/unit/css-class-tokens.test.ts` (named examples for each
  lexical rule, including the witnesses named in SCAN-SOUND),
  `test/unit/retired-style-hooks.test.ts` (REG-WELLFORMED and ADVISE-EXACT
  examples, including `.tab_tabTab` not matching `tab_tab`), and
  `test/unit/custom-css-advisories.test.ts` (TERMCSS-ADVISE table). They fail
  to import.
- Green:
  - `shared/src/styling/css-class-tokens.ts`: `scanClassTokens(css: string):
    ClassToken[]` with `type ClassToken = {readonly name: string; readonly
    start: number}`, written as a single index-based loop with explicit
    character comparisons (no regular expressions, no closures over mutable
    state) so that EP-M4 can annotate it in place. Character-class helpers
    (`isIdentStart`, `isIdentChar`) are small pure functions.
  - `shared/src/styling/retired-style-hooks.ts`: the registry as readonly
    data. `SUPPORTED_STYLE_HOOKS` lists `#hyper`, `.fullScreen`,
    `.term_fit`, `.term_term`, `.term_active`, `.term_wrapper`.
    `RETIRED_STYLE_HOOKS` lists each retired Hyper class with an optional
    `internalName` (the current generated class, quoted for orientation only)
    and a short guidance string. Export
    `findRetiredStyleHooks(css: string): RetiredHookFinding[]`.
  - `shared/src/styling/custom-css-advisories.ts`: the policy
    `collectCustomCssAdvisories(config: {readonly css: string; readonly
    termCSS: string}): CustomCssAdvisory[]`, where `CustomCssAdvisory` is the
    discriminated union `{kind: 'retired-hook'; hook: string; internalName?:
    string} | {kind: 'inert-term-css'}`. Retired hooks are searched in both
    `css` and `termCSS`.
  - Add `fast-check@^4.10.2` as a development dependency and write
    `test/unit/css-class-tokens.property.test.ts` and
    `test/unit/retired-style-hooks.property.test.ts` per the verification
    plan, including the classification evidence.
  - Add `test/unit/retired-style-hooks-bundle-contract.test.ts`, which builds
    the renderer CSS in memory (as `esbuild-migration-contracts.test.ts`
    does) and checks every quoted `internalName`.
- The retired list is generated once from the pre-migration tree and pasted
  into the registry; see `Concrete steps` §EP-M3. Exclude the four retained
  `term_*` names.
- Acceptance evidence: all new tests pass; each seeded fault listed under
  SCAN-SOUND, SCAN-COMPLETE, and ADVISE-EXACT is tried once, observed to fail,
  and reverted; `make check-fmt`, `make lint`, and `make test` pass;
  `bun run check:boundaries` passes.
- Conformance check: modules import nothing outside `shared/`; no runtime
  behaviour changes yet.
- Recovery: revert the milestone commits; nothing depends on the modules yet.
- Remaining gaps: proof, wiring.
- Compatibility decision: none.

### EP-M4: LemmaScript proof (proof milestone)

- Outcome: SCAN-SOUND, SCAN-COMPLETE, and SCAN-REFINES verified by Dafny for
  the shipped `scanClassTokens` source, checked by `make proofs` and CI.
- Requirements and gaps: D-7.
- Prototype (go/no-go): in a scratch file outside the repository, annotate a
  ten-line function that counts `.` characters outside `/* */` comments, and run
  `npx --yes --package=lemmascript@0.6.5 -- lsc check --backend=dafny`. Go if
  it verifies; no-go (escalate) if string indexing or the loop cannot be
  modelled. Delete the prototype either way.
- Red: add `//@ verify`, `//@ requires`, `//@ ensures`, `//@ invariant`, and
  `//@ decreases` annotations to `shared/src/styling/css-class-tokens.ts`, with
  pure specification functions `lexStateAt`, `isClassTokenStartAt`, and
  `identRunEnd`. Run `lsc check`; record the open obligations.
- Green: add helper lemmas to `shared/src/styling/css-class-tokens.dfy` only
  (never to `.dfy.gen`). Iterate within the proof-feasibility tolerance.
- Add `lemmascript@^0.6.5` as a development dependency; add
  `LemmaScript-files.txt` listing `shared/src/styling/css-class-tokens.ts`; add
  a `proofs` Makefile target that runs `lsc check --backend=dafny` for each
  listed file; add a CI job (Linux leg only) using
  `dafny-lang/setup-dafny-action` pinned to Dafny 4.11 that runs `make proofs`.
  Add `proofs` to `.PHONY`, and validate the Makefile with
  `mbake validate Makefile`.
- Seeded faults: apply faults (a) to (e) from the verification plan one at a
  time to the TypeScript, run `make proofs`, confirm a named failure, record
  it, and revert.
- Acceptance evidence: `make proofs` reports success with zero errors and no
  `assume` statements in the `.dfy` diff
  (`rg -n 'assume' shared/src/styling/*.dfy` returns nothing); the fast-check
  properties still pass; `make check-fmt`, `make lint`, and `make test` pass.
- Conformance check: the verified function is the shipped function (no
  parallel model); the only TypeScript changes are `//@` comments.
- Recovery: if the proof stalls, the annotations are comments and can be
  reverted without behaviour change; escalate per tolerance.
- Remaining gaps: wiring.
- Compatibility decision: none.

### EP-M5: configuration advisory adapter

- Outcome: users see a configuration warning for retired hooks and inert
  `termCSS`.
- Requirements and gaps: RM-1.4.19-b, D-4, D-5.
- Red: extend `test/unit/custom-css-advisories.test.ts` with the
  ADAPTER-NOTIFY cases against `app/config/custom-css-advisories.ts`, which
  does not exist yet.
- Green: add `app/config/custom-css-advisories.ts` exporting
  `reportCustomCssAdvisories(config: Pick<configOptions, 'css' | 'termCSS'>,
  deps: {readonly notify: (title: string, body: string) => void}): void`.
  It calls the pure policy and formats one message, for example:
  `Your custom CSS uses selectors Velocetty no longer provides (.tab_tab,
  .header_header). termCSS has no effect; move its rules to css. See the
  users' guide, "Custom CSS".`
  Call it from `checkDeprecatedConfig` in `app/config.ts`, passing the existing
  `notify`.
- E2E: add a scenario to `test/e2e/post-removal-hardening.e2e.test.ts` that
  seeds the isolated test configuration with `css: '.tab_tab { color: red; }'`
  and asserts the warning is observable. First confirm in the fast-lane helpers
  how notifications surface (renderer DOM or main-process output).
- Acceptance evidence: unit, behavioural, and E2E checks pass;
  `make check-fmt`, `make lint`, and `make test` pass.
- Conformance check: `getDeprecatedCSS` and `htermConfigTranslate`
  unchanged; adapter imports only `@shared/*` and its injected collaborator.
- Recovery: revert; the call in `checkDeprecatedConfig` is one line.
- Remaining gaps: clean-up and documentation.
- Compatibility decision: none.

### EP-M6: compatibility clean-up and supported-hook contract

- Outcome: no dead legacy selector remains, and the supported hooks are
  checked end to end.
- Requirements and gaps: RM-1.4.19-b, D-4.
- Edits: remove `:global(.tabs_list)` and its comment from
  `lib/components/tabs.module.css`; remove `.tabs_list` from the readiness
  selector list in `test/e2e/electron-e2e-helpers.ts` and its unit test in
  `test/unit/electron-e2e-helpers.test.ts`; add a comment at each retained
  `term_*` usage site in `lib/components/term.tsx` that names
  `SUPPORTED_STYLE_HOOKS` as the contract. Add the HOOKS-PRESENT check to the
  E2E file, driven by `SUPPORTED_STYLE_HOOKS`.
- Acceptance evidence: `bun run test:e2e:fast` passes; `make check-fmt`,
  `make lint`, and `make test` pass; `rg 'tabs_list' lib test` returns nothing.
- Conformance check: no new compatibility classes; retained classes
  unchanged.
- Recovery: revert.
- Remaining gaps: documentation and tracking.
- Compatibility decision: retained `term_*` classes stay because they are
  already emitted and documented; no new layer is introduced.

### EP-M7: tracking, documentation, and closure

- Outcome: every follow-up is tracked with an owner and a review date, the
  users' and developers' guides describe the new behaviour, and the roadmap
  item is done.
- Requirements and gaps: RM-1.4.19-a, RM-1.4.19-b, RM-1.4.19-c.
- Edits:
  - Open four GitHub issues in `leynos/velocetty` with `gh issue create`
    (authenticated as `leynos`) and record their numbers.
  - `docs/tracking-issues.md`: add a `Review by:` field to the entry format
    and add four entries, each with `Status: Open`, `Owner: @leynos`,
    `Last updated`, `Review by` (90 days after the implementation date,
    written as an absolute date), `Issue`, a summary with an explicit
    `Mitigation:` line, and exit criteria:
    - `CSP-001` Add a `style-src` directive to the renderer CSP. Blockers:
      the inline base `<style>` in `app/index.html`, the custom CSS
      `<style>` element in `lib/containers/hyper.tsx`, `XTERM-001`, and
      third-party plugin `<style>` injection. Mitigation: no style
      restriction today; script policy tightened; nothing relies on style
      injection for security. Exit: blockers 1 and 2 moved to a stylesheet
      and a constructed stylesheet, `XTERM-001` closed, plugin impact
      accepted, policy shipped with an E2E check.
    - `XTERM-001` Migrate from the deprecated unscoped `xterm` and
      `xterm-addon-*` packages to `@xterm/*`, whose DOM renderer uses
      constructed stylesheets. Mitigation: the WebGL and canvas addons are
      the normal render path.
    - `CSSCOMPAT-001` Retired Hyper DOM class names. Mitigation: the
      configuration warning, the users' guide table, the supported-hook
      list, and the roadmap's stable plugin APIs (tab decoration providers).
      Exit: review whether any retired name needs a supported replacement,
      based on issue reports, at the review date.
    - `CSSCOMPAT-002` Remove the inert `termCSS` key. Mitigation: the
      configuration warning. Exit: key removed from the schema, defaults,
      types, reducer, and reloadability registries, with a configuration
      migration note.
  - Add `test/unit/tracking-issues-register.test.ts` (TRACK-REGISTER).
  - Create `docs/users-guide.md` with a "Custom CSS" section: how `css` is
    scoped to `#hyper`, the supported hooks, the rule that generated names
    are internal, a table of retired Hyper selectors with their current
    internal names "for orientation only", the `termCSS` notice, the scanner's
    residual gaps, and a short "Security policy" note for plugin authors
    (inline scripts are blocked; load code through modules).
  - `docs/developers-guide.md`: replace the `tabs_list` example in §CSS
    modules conventions; rewrite §Preserving legacy plugin-targeted class
    names as "Supported styling hooks" pointing at `SUPPORTED_STYLE_HOOKS`
    and ADR-007; add a "Renderer Content Security Policy" section (no inline
    scripts, no `eval`, how the contract and E2E checks guard it); add a
    "Property tests and proofs" subsection under §Tests describing
    `fast-check` conventions and `make proofs`.
  - `docs/velocetty-hyper-codebase.md`: correct every claim that
    `'unsafe-inline'` is required for `styled-jsx` (around lines 7123-7136,
    7643, 7657, and 9292) to describe the new policy and cite ADR-007.
  - `docs/roadmap.md`: mark `1.4.19` and its sub-items done, and cite the
    tracking IDs.
- Acceptance evidence: TRACK-REGISTER passes; `make markdownlint`,
  `make nixie`, `make spelling`, `make check-fmt`, `make lint`, `make test`, and
  `make proofs` pass; `bun run test:e2e:fast` passes.
- Conformance check: every RM item maps to evidence; ADR-007 and the design
  document match what shipped.
- Recovery: documentation commits revert cleanly; GitHub issues can be closed
  with a comment if the plan is abandoned.
- Remaining gaps: the tracked follow-ups themselves.
- Compatibility decision: none.

## Concrete steps

Run every command from the repository root,
`/home/leynos/.lody/repos/github---leynos---velocetty/worktrees/3cf39369-95ea-483f-a13a-99c45828f9c1`
or its successor checkout. Capture long output with `tee`, for example:

```bash
make test 2>&1 | tee /tmp/test-velocetty-1-4-19-close-post-removal-hardening-tasks.out
```

### EP-M0

```bash
grep -n '9\.2\.4' docs/roadmap.md
grep -n 'Content-Security-Policy' app/index.html
grep -c 'createElement("style")' node_modules/xterm/lib/xterm.js
rg -n 'tabs_list' lib test
rg -n 'customCSS' lib/components lib/containers
```

Expected today: `9.2.4` shows `- [ ]`; the CSP line shows
`script-src 'self' 'unsafe-inline'`; the xterm count is `2`; `tabs_list`
appears in `lib/components/tabs.module.css` and the E2E helpers only;
`customCSS` appears only in `lib/containers/hyper.tsx`.

### EP-M3 retired-name extraction

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
Also check `lib/components/search-box.tsx` and any other component in that
commit for class prefixes the pattern misses. Remove the four retained `term_*`
names before pasting the rest into the registry.

### EP-M4

```bash
npx --yes --package=lemmascript@0.6.5 -- lsc check --backend=dafny shared/src/styling/css-class-tokens.ts
make proofs
rg -n 'assume' shared/src/styling/*.dfy
```

Expected after green: `lsc check` and `make proofs` report the file verified
with `0 errors`; the `rg` command prints nothing.

### Every milestone

```bash
make check-fmt 2>&1 | tee /tmp/check-fmt-velocetty-1-4-19-close-post-removal-hardening-tasks.out
make lint 2>&1 | tee /tmp/lint-velocetty-1-4-19-close-post-removal-hardening-tasks.out
make test 2>&1 | tee /tmp/test-velocetty-1-4-19-close-post-removal-hardening-tasks.out
```

Run these sequentially, never in parallel. Prefer delegating full gate runs to
the `scrutineer` agent. Commit after each milestone passes its gates.

## Validation and acceptance

The item is accepted when all of the following hold:

1. `grep -n 'Content-Security-Policy' app/index.html` prints
   `script-src 'self'; object-src 'none'; base-uri 'none'`.
2. `bun test test/unit/renderer-csp-contract.test.ts` failed before EP-M2
   (recorded) and passes after.
3. `bun run test:e2e:fast` passes, including
   `test/e2e/post-removal-hardening.e2e.test.ts`, and the recorded seeded-fault
   run shows the CSP check failing on an inline script.
4. Starting Velocetty with `css: '.tab_tab { color: red; }'` in the
   configuration shows a "Configuration warning" notification naming
   `.tab_tab`; starting with an empty `css` and `termCSS` shows none.
5. `make proofs` passes, and the five seeded faults were each rejected
   (recorded).
6. `docs/tracking-issues.md` contains `CSP-001`, `XTERM-001`,
   `CSSCOMPAT-001`, and `CSSCOMPAT-002`, each with `Owner: @leynos`, a
   `Review by` date, a mitigation, and an issue link, and
   `bun test test/unit/tracking-issues-register.test.ts` passes.
7. `docs/users-guide.md`, `docs/developers-guide.md`,
   `docs/velocetty-design.md`, ADR-007, and `docs/velocetty-hyper-codebase.md`
   reflect the shipped behaviour, and `docs/roadmap.md` marks `1.4.19` done.

Quality criteria:

- Tests: `make test` and `bun run test:e2e:fast` pass.
- Verification: SCAN-SOUND, SCAN-COMPLETE, and SCAN-REFINES discharged by
  `make proofs`; ADVISE-EXACT discharged by fast-check with recorded
  classification evidence; the remaining obligations discharged by their named
  tests.
- Lint and types: `make check-fmt`, `make lint`, and `make typecheck` pass.
- Documentation: `make markdownlint`, `make nixie`, and `make spelling` pass.
- Security: the CSP is strictly tighter than before; no new `webPreferences`
  change.

## Idempotence and recovery

Every step is a file edit or a test run and can be repeated. The seeded-fault
runs must be reverted immediately after recording; check with `git diff` before
committing. `lsc regen` preserves hand-written proof helpers; never delete a
`.dfy` file to start again. If a GitHub issue is created twice, close the
duplicate with a link to the original. Each milestone is one or more commits, so
`git revert` restores the previous plateau.

## Artifacts and notes

Record here, during implementation: the red output of
`renderer-csp-contract.test.ts`, the seeded-fault E2E output, the property
classification statistics, the 10,000-run property output, each seeded proof
fault's Dafny error, and the GitHub issue numbers.

## Interfaces and dependencies

New development dependencies: `fast-check@^4.10.2` and `lemmascript@^0.6.5`.
New CI dependency: `dafny-lang/setup-dafny-action` with Dafny 4.11.

In `shared/src/styling/css-class-tokens.ts`:

```ts
export type ClassToken = {readonly name: string; readonly start: number};
export const scanClassTokens: (css: string) => ClassToken[];
```

In `shared/src/styling/retired-style-hooks.ts`:

```ts
export type SupportedStyleHook = {readonly selector: string; readonly description: string};
export type RetiredStyleHook = {readonly className: string; readonly internalName?: string; readonly guidance: string};
export type RetiredHookFinding = {readonly className: string; readonly internalName?: string};
export const SUPPORTED_STYLE_HOOKS: readonly SupportedStyleHook[];
export const RETIRED_STYLE_HOOKS: readonly RetiredStyleHook[];
export const findRetiredStyleHooks: (css: string) => RetiredHookFinding[];
```

In `shared/src/styling/custom-css-advisories.ts`:

```ts
export type CustomCssAdvisory =
  | {readonly kind: 'retired-hook'; readonly className: string; readonly internalName?: string}
  | {readonly kind: 'inert-term-css'};
export const collectCustomCssAdvisories: (config: {readonly css: string; readonly termCSS: string}) => CustomCssAdvisory[];
```

In `app/config/custom-css-advisories.ts`:

```ts
export const reportCustomCssAdvisories: (
  config: {readonly css: string; readonly termCSS: string},
  deps: {readonly notify: (title: string, body: string) => void}
) => void;
```

In `test/e2e/csp-violation-detection.ts`:

```ts
export const isCspViolationMessage: (text: string) => boolean;
export const findCspViolations: (messages: readonly string[]) => string[];
```

## Revision note

- 2026-10-29: initial draft from Wyvern reconnaissance and external research.
