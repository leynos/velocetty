# Testing with Bun

## Module header

- Purpose: Explain Bun's test runner capabilities, limitations, and how it
  fits with Playwright in this repository.
- Invariants: Keep guidance aligned with Bun versions and repository test
  commands.
- Cross-links: [Developers' guide](docs/developers-guide.md) and
  [ADR 001](docs/adr-001-replace-ava-with-bun-test.md).

## What Bun’s test runner is (and what it isn’t)

Bun ships with a fast, built-in, **Jest-compatible** test runner. Tests are
written in JavaScript (JS) and TypeScript (TS) using a Jest-like API from
`bun:test`, and executed with `bun test`. It supports TypeScript/JSX, lifecycle
hooks, snapshot testing, DOM/UI testing patterns, watch mode, and preloaded
setup scripts. Bun aims for broad Jest compatibility, but it doesn’t implement
everything; the docs explicitly frame compatibility as “aiming” rather than
“complete”.[^1]

A key practical implication: treat Bun’s runner as the “unit + integration +
component” workhorse; for serious cross-browser end-to-end testing, Playwright
(and usually Node) remains the full-fidelity option—more on that below.[^2]

---

## Mental model and file layout

### How `bun test` finds test files

By default, `bun test` recursively scans from the current working directory and
runs files matching these patterns:

- `*.test.{js,jsx,ts,tsx}`
- `*_test.{js,jsx,ts,tsx}`
- `*.spec.{js,jsx,ts,tsx}`
- `*_spec.{js,jsx,ts,tsx}`[^3]

It ignores `node_modules`, hidden directories, and files without JS-like
extensions/loaders.[^3]

### Execution order (important for shared state)

By default:

1. Test files execute **sequentially** (not in parallel)
2. Within each file, tests run sequentially in definition order[^3]

So: if global mutable state is relied upon, it may appear to “work” locally
until concurrency or randomization is enabled, and the behaviour is exposed (the
best kind of truth: reproducible).[^1]

---

## Writing unit/integration tests with `bun:test`

### Basic test and suite structure

```ts
import { test, describe, expect } from "bun:test";

describe("arithmetic", () => {
  test("2 + 2", () => {
    expect(2 + 2).toBe(4);
  });
});
```

`test` defines a test, `describe` groups tests, and `expect` performs
assertions.[^4]

### Async tests

Use `async` tests:

```ts
import { test, expect } from "bun:test";

test("async works", async () => {
  const result = await Promise.resolve(4);
  expect(result).toEqual(4);
});
```

A `done` callback is also supported; accepting `done` requires calling it or
the test will hang.[^4]

### Per-test timeouts (and what “timeout” means in Bun)

A per-test timeout can be passed in milliseconds as an additional argument:

```ts
import { test, expect } from "bun:test";

const slowOperation = async () => 42;

test("fast operation", async () => {
  const data = await slowOperation();
  expect(data).toBe(42);
}, 500);
```

Bun’s timeout behaviour is intentionally forceful: it throws an *uncatchable*
exception to stop the test, and it kills child processes spawned by the test to
avoid zombie processes. Default per-test timeout is **5000ms** unless overridden
(per-test, config, or CLI).[^4]

### Retries (for flaky tests)

Bun supports retrying failed tests via `test.retry` (useful for genuine
flakiness—though the best outcome is still fixing the flake).[^4]

---

## Test modifiers and conditional tests (the “control flow” toolkit)

### Skip and todo

- `test.skip(...)` skips a test.[^4]
- `test.todo(...)` marks it as TODO and doesn’t run it by default.[^4]

There’s a special mode: `bun test --todo`. In this mode, failing TODO tests
don’t error the run, but **TODO tests that pass** get reported as failures—so
the TODO marker can be removed or the test re-checked.[^4]

### Focused execution with `.only` (Bun’s “safety catch”)

Tests/suites can be marked with `test.only` / `describe.only`, but Bun only
respects them when `--only` is passed.

- Run only `.only` tests: `bun test --only`
- Run everything (even if `.only` exists): `bun test`[^4]

This is a useful CI foot-gun prevention pattern: committed `.only` doesn’t
silently skip the suite unless the command line opts into it.

### Conditional execution

Bun provides expressive conditionals:

- `test.if(condition)(name, fn)` runs only if truthy[^4]
- `test.skipIf(condition)(...)` skips if truthy[^4]
- `test.todoIf(condition)(...)` marks TODO if truthy[^4]

The same pattern applies at suite level (`describe.if`, `describe.skipIf`,
`describe.todoIf`).[^4]

### “Expected failure” tracking

`test.failing(...)` inverts the result:

- failing test marked `.failing()` → treated as pass
- passing test marked `.failing()` → treated as fail (so regressions are
  flagged and expectations can be updated)[^4]

---

## Parameterized tests with `test.each` and `describe.each`

Use `test.each(cases)(title, fn)` to run one logical test over multiple inputs:

```ts
import { test, expect } from "bun:test";

test.each([
  [1, 2, 3],
  [3, 4, 7],
])("%p + %p should be %p", (a, b, expected) => {
  expect(a + b).toBe(expected);
});
```

`describe.each` parameterizes entire suites.[^4]

Argument passing rules:

- if a row is an array, Bun spreads it into positional args
- otherwise Bun passes the row as a single argument[^4]

Title format specifiers include `%p %s %d %i %f %j %o %# %%`.[^4]

---

## Assertions: counting and typing

### Assertion counting

Bun supports:

- `expect.hasAssertions()` to require at least one assertion in the test (handy
  for async tests that might accidentally return early)[^4]
- `expect.assertions(count)` is also documented as supported.[^4]

### Type-level tests with `expectTypeOf`

Type assertions (compile-time intent checks) are supported via `expectTypeOf`:

```ts
import { expectTypeOf } from "bun:test";

expectTypeOf(123).toBeNumber();
expectTypeOf("hello").toBeString();
expectTypeOf(Promise.resolve(42)).resolves.toBeNumber();
```

This is especially useful for public APIs and generic-heavy libraries.[^4]

---

## `expect` matchers: what is available in Bun

Bun lists supported matchers explicitly and notes that full Jest compatibility
remains a goal.[^4]

Here’s the supported set from the docs, grouped:

### Basics

- `.not`
- `.toBe()`, `.toEqual()`, `.toStrictEqual()`
- `.toBeNull()`, `.toBeUndefined()`, `.toBeNaN()`, `.toBeDefined()`
- `.toBeFalsy()`, `.toBeTruthy()`[^4]

### String and array

- `.toContain()`, `.toContainEqual()`
- `.toHaveLength()`
- `.toMatch()`
- `.stringContaining()`, `.stringMatching()`
- `.arrayContaining()`[^4]

### Object

- `.toHaveProperty()`, `.toMatchObject()`
- `.toContainAllKeys()`
- `.toContainValue()`, `.toContainValues()`
- `.toContainAllValues()`, `.toContainAnyValues()`
- `.objectContaining()`[^4]

### Numbers

- `.toBeCloseTo()`, `.closeTo()`
- `.toBeGreaterThan()`, `.toBeGreaterThanOrEqual()`
- `.toBeLessThan()`, `.toBeLessThanOrEqual()`[^4]

### Functions and classes

- `.toThrow()`
- `.toBeInstanceOf()`[^4]

### Promises

- `.resolves()`
- `.rejects()`[^4]

### Mock function matchers

- `.toHaveBeenCalled()`, `.toHaveBeenCalledTimes()`, `.toHaveBeenCalledWith()`
- `.toHaveBeenLastCalledWith()`, `.toHaveBeenNthCalledWith()`
- `.toHaveReturned()`, `.toHaveReturnedTimes()`, `.toHaveReturnedWith()`
- `.toHaveLastReturnedWith()`, `.toHaveNthReturnedWith()`[^4]

### Snapshots

- `.toMatchSnapshot()`, `.toMatchInlineSnapshot()`
- `.toThrowErrorMatchingSnapshot()`, `.toThrowErrorMatchingInlineSnapshot()`[^4]

### Utilities

- `.extend`
- `.anything()`, `.any()`
- `.assertions()`, `.hasAssertions()`[^4]

One explicitly “not yet implemented” item: `.addSnapshotSerializer()`.[^4]

---

## Running tests effectively (CLI patterns used most often)

### The basics

Run all tests:

```bash
bun test
```

[^1]

### Filter which test files run (substring filters, not globs)

Positional arguments act as simple substring filters on file paths:

```bash
bun test utils
```

To force Bun to treat an argument as a literal path (not a filter), start it
with `./` or `/`:

```bash
bun test ./test/specific-file.test.ts
```

Bun doesn’t support glob patterns for these positional filters yet.[^3]

### Filter by test name (regex-ish)

Use `-t/--test-name-pattern` to filter by test names. Bun matches against the
concatenation of parent `describe` labels plus the test name, separated by
spaces.[^3]

```bash
bun test --test-name-pattern addition
```

### Watch mode

```bash
bun test --watch
```

[^1]

### Timeouts (global)

```bash
bun test --timeout 20000
```

Default is 5000ms.[^1]

### Bail early

```bash
bun test --bail
bun test --bail=10
```

[^1]

### Re-run each test file repeatedly (flake hunting)

```bash
bun test --rerun-each 10
```

[^1]

### Randomize execution order (find hidden coupling)

```bash
bun test --randomize
bun test --seed 123456   # implies --randomize
```

[^1]

---

## Concurrency: speed vs determinism, made explicit

By default, Bun runs tests sequentially within a file. Concurrent execution
can be enabled for async tests.

### Enable concurrency broadly

```bash
bun test --concurrent
bun test --concurrent --max-concurrency 4
```

Bun defaults max concurrency to 20.[^1]

### Mark individual tests as concurrent / serial

- `test.concurrent(...)` runs concurrently even without `--concurrent`.[^1]
- `test.serial(...)` forces sequential behaviour even when `--concurrent`
  runs.[^1]

This provides a clean way to keep “stateful” integration tests serial while
letting pure/isolated tests fly.

### Gradual migration with `concurrentTestGlob`

Concurrency can be enabled only for matching files via `bunfig.toml`:

```toml
[test]
concurrentTestGlob = "**/concurrent-*.test.ts"
```

Matching files behave as though `--concurrent` is set; `--concurrent` on the CLI
still overrides and forces concurrency everywhere.[^5]

---

## Test environment setup: preload scripts

Bun runs the whole suite in a **single process**, and it loads any `--preload`
scripts before executing tests.[^1]

CLI form:

```bash
bun test --preload ./setup.ts --preload ./global-mocks.ts
```

Config form (`bunfig.toml`):

```toml
[test]
preload = ["./test-setup.ts", "./global-mocks.ts"]
```

[^5]

The docs show common preload uses like global setup/teardown with hooks and
global module mocks (example uses `mock.module(...)`).[^5]

---

## `bunfig.toml` configuration for tests (the practical subset)

Create a `[test]` section in `bunfig.toml`.[^5]

### Test discovery root

```toml
[test]
root = "src"
```

[^5]

### Default timeout

```toml
[test]
timeout = 10000
```

[^5]

### Memory-saving mode (`--smol`)

```toml
[test]
smol = true
```

This corresponds to `bun test --smol` and reduces memory usage by shrinking
heap, increasing GC aggressiveness, and reducing buffers.[^5]

### Randomization / seed / reruns

```toml
[test]
randomize = true
seed = 2444615283
rerunEach = 3
```

[^5]

### Coverage (high signal, minimal pain)

```toml
[test]
coverage = true
coverageReporter = ["text", "lcov"]
coverageDir = "./coverage"
coverageSkipTestFiles = true
coverageThreshold = { lines = 0.9, functions = 0.8, statements = 0.85 }
coveragePathIgnorePatterns = ["dist/**", "**/*.test.ts"]
coverageIgnoreSourcemaps = true
```

Bun supports both a single numeric threshold and a detailed object threshold;
setting thresholds enables failing the run on low coverage.[^5]

### Reporters (JUnit in config)

```toml
[test.reporter]
junit = "./reports/junit.xml"
```

This complements `--reporter=junit` with `--reporter-outfile`.[^5]

### Environment variables for tests

Bun loads `.env` from project root, and the docs recommend `.env.test` for test-
specific variables, loaded via:

```bash
bun test --env-file=.env.test
```

[^5]

### Override behaviour and “profiles”

CLI flags override config values.[^5]

Environment-specific config sections like `[test.ci]` can be defined and
selected with:

```bash
bun test --config=ci
```

[^5]

### Debugging effective config

```bash
bun test --dry-run
bun test --verbose
```

[^5]

---

## CI integration and reporting

### GitHub Actions annotations

`bun test` detects when it runs inside GitHub Actions and emits annotations
automatically—no special configuration beyond installing Bun and running `bun
test`.[^1]

### JUnit XML output (GitLab, etc.)

```bash
bun test --reporter=junit --reporter-outfile=./bun.xml
```

Bun still prints to stdout/stderr normally, and it writes the JUnit XML at the
end.[^1]

---

## Component/DOM testing with Testing Library + Happy DOM

Bun’s docs describe a pragmatic setup: use **Happy DOM** to provide a DOM-like
environment, then use Testing Library packages as usual.[^6]

### Install dependencies

```bash
bun add -D @happy-dom/global-registrator
bun add -D @testing-library/react @testing-library/dom @testing-library/jest-dom
```

[^6]

### Preload script: register Happy DOM

```ts
// happydom.ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
```

[^6]

### Preload script: extend `expect` and cleanup

```ts
// testing-library.ts
import { afterEach, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(() => cleanup());
```

[^6]

### Wire preloads in `bunfig.toml`

```toml
[test]
preload = ["./happydom.ts", "./testing-library.ts"]
```

[^6]

### TypeScript: declaration merging for matcher types

Bun’s guide shows extending `Matchers` via module augmentation so editors
understand `toBeInTheDocument()` etc.[^6]

### Example test

```tsx
import { test, expect } from "bun:test";
import { screen, render } from "@testing-library/react";
import { MyComponent } from "./myComponent";

test("Can use Testing Library", () => {
  render(MyComponent);
  expect(screen.getByTestId("my-component")).toBeInTheDocument();
});
```

[^6]

---

## End-to-end tests: Bun + Playwright (and the sharp edges)

Playwright provides cross-browser automation (Chromium/WebKit/Firefox) and is
widely used for e2e testing.[^7]

### Reality check: Playwright is Node-first

BrowserStack’s 2026 guide states bluntly that Playwright does **not** have full
native support for Bun because Playwright targets Node APIs for browser process
control, and Bun’s compatibility can be incomplete. It calls out potential
issues around browser launching/child processes and warns that advanced
Playwright features (e.g. tracing/network interception) may not behave reliably
under Bun without extra work. It also says Node remains the primary runtime and
Bun isn’t “officially supported” for full feature compatibility.[^2]

So the sane strategy is usually:

- Use Bun for fast unit/component feedback loops.
- Use Playwright (often under Node) for “real” cross-browser e2e in CI.
- Optionally experiment with Bun locally for faster iteration, while accepting
  Node may be required for flaky or feature-heavy scenarios.[^2]

### Setting up Playwright in a Bun project

As described in the BrowserStack guide.

```bash
bun init
bun add @playwright/test
```

[^2]

The guide also notes that Playwright browser binaries must be installed (it
references using the Node-style `npx playwright install` approach).[^2]

### Running “Playwright tests” via Bun commands

The BrowserStack guide gives examples like:

```bash
bun test example.spec.ts
bun test
```

and suggests passing environment variables inline, e.g. `ENV=staging bun
test`.[^2]

Pragmatically, two interpretations can be adopted in real projects:

1. **Bun runner + Playwright API**: write `bun:test` tests that call
   Playwright’s browser automation API inside the test body (fast, simple, fewer
   moving parts).
2. **Playwright runner**: run Playwright’s own test runner (more features),
   while using Bun for dependency management and other scripts—accepting that
   Bun-as-runtime might still encounter Node-compat friction.

Given the BrowserStack warnings, option (1) tends to be the cleaner “Bun-native”
approach, and option (2) tends to be the feature-complete approach.[^2]

### Cross-browser accuracy still matters (and Bun doesn’t magically grant it)

The BrowserStack guide explicitly warns that Bun-run Playwright execution can
skew towards Chromium and that real cross-browser validation is still required
to catch engine-specific bugs. It argues for cloud real-browser testing to
prevent regressions from browser-specific behaviour.[^2]

---

## High-value “gotchas” and habits (learned the fun way)

- `.only` is ignored unless `--only` is passed. This reduces accidental CI
  under-testing.[^4]
- Positional filters are substring matches, not globs; the `./path` prefix runs
  a specific file.[^3]
- Default execution is sequential; concurrency (`--concurrent`,
  `test.concurrent`) surfaces hidden coupling fast and acts as a bug detector
  disguised as a performance knob.[^1]
- `--randomize`/`--seed` make order-dependence reproducible instead of mystical.[^1]
- Preloads handle global setup, DOM registration, matcher extension, and global
  mocks while keeping per-test files focused.[^5]
- When Playwright’s advanced features are required, Node remains necessary for
  full reliability; treat Bun as an optimization path, not a guaranteed
  replacement.[^2]

---

A single Markdown file suitable for a repo wiki (with a compact TOC and
“copy/paste” config snippets) can be produced as a clean doc artefact in the
same style—self-contained and easier to store and version.

[^1]: <https://bun.com/docs/test> "Test runner - Bun"
[^2]: <https://www.browserstack.com/guide/bun-playwright> "How to Use Bun for
Tests in 2026? | BrowserStack"
[^3]: <https://bun.com/docs/test/discovery> "Finding tests - Bun"
[^4]: <https://bun.com/docs/test/writing-tests> "Writing tests - Bun"
[^5]: <https://bun.com/docs/test/configuration> "Test configuration - Bun"
[^6]: <https://bun.com/docs/guides/test/testing-library> "Using Testing
Library with Bun - Bun"
[^7]: <https://playwright.dev/> "Fast and reliable end-to-end testing for modern
web apps | Playwright"
