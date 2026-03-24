<!-- markdownlint-disable MD013 -->
# Replace process-global timer and logger overrides with injected seams in DOM-heavy unit tests
<!-- markdownlint-enable MD013 -->

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

## Purpose / big picture

Enable reliable parallel unit-test execution by replacing process-global timer
and logger mutations with dependency injection seams. Currently,
`test/unit/notification.test.ts` replaces `globalThis.setTimeout` and
`globalThis.clearTimeout`, and `test/unit/updater.test.ts` replaces both timers
and `console.error`. These global mutations cause cross-test interference when
running with `--concurrent`.

After this change, tests will inject test-doubles through component/module
interfaces rather than mutating shared global state. This allows the
notification and updater suites to run safely in parallel with other tests,
advancing roadmap item 9.3.7 and unblocking 9.3.8.

Observable success: `bun test --concurrent test/unit/notification.test.ts` and
`bun test --concurrent test/unit/updater.test.ts` pass without mutating
global timer or logger functions.

## Constraints

Hard invariants that must hold throughout implementation:

- Production behaviour must remain unchanged; no functional changes to
  notification dismissal timing or updater scheduling.
- The existing test coverage must be preserved; all current assertions must
  continue to pass.
- Component props interfaces may be extended with optional dependencies but
  must not break existing callers.
- The updater module's public export signature (`default updater(win)`) must
  remain stable.
- No new external dependencies; use existing test infrastructure.

## Tolerances (exception triggers)

Thresholds that trigger escalation when breached:

- Scope: if implementation requires changes to more than 8 files, stop and
  escalate.
- Interface: if a public API signature must change in a breaking way, stop and
  escalate.
- Dependencies: if a new external dependency is required, stop and escalate.
- Iterations: if tests still fail after 3 fix attempts, stop and escalate.
- Time: if a milestone takes more than 4 hours, stop and escalate.

## Risks

Known uncertainties that might affect the plan:

- Risk: The notification component's timer usage is inside a React hook
  (`useNotification`), which may complicate seam injection.
  Severity: medium
  Likelihood: medium
  Mitigation: Accept timer methods as optional hook parameters with global
  fallbacks, or create a timer context/provider seam.

- Risk: The updater module captures timers at module scope, requiring factory
  pattern introduction.
  Severity: medium
  Likelihood: high
  Mitigation: Introduce an optional `scheduler` parameter to the `updater`
  function with global fallbacks.

- Risk: Happy DOM may have timing quirks that affect transition events after
  timer seam injection.
  Severity: low
  Likelihood: medium
  Mitigation: Run notification tests with both real and fake timers to verify
  behaviour parity.

## Progress

Use a list with checkboxes to summarize granular steps. Every stopping point
must be documented here, even if it requires splitting a partially completed
task into two ("done" vs. "remaining"). This section must always reflect the
actual current state of the work.

- [x] (2026-03-23) Stage A: Analysis and seam design
  - [x] Review notification.tsx timer usage patterns
  - [x] Review updater.ts timer and logger usage patterns
  - [x] Design timer seam interface for notification component
  - [x] Design scheduler/logger seam interface for updater module

- [x] (2026-03-23) Stage B: Notification timer seam implementation
  - [x] Add optional timer seam to Notification component props
  - [x] Update useNotification hook to accept injected timer methods
  - [x] Refactor notification.test.ts to use injected seams
  - [x] Remove global timer replacement from notification.test.ts
  - [x] Verify notification tests pass with `--concurrent`

- [x] (2026-03-23) Stage C: Updater scheduler/logger seam implementation
  - [x] Add optional scheduler seam to updater function signature
  - [x] Add optional logger seam to updater function signature
  - [x] Update updater.ts to use injected seams with global fallbacks
  - [x] Refactor updater.test.ts to use injected seams
  - [x] Remove global timer and console.error replacement from updater.test.ts
  - [x] Verify updater tests pass with `--concurrent`

- [x] (2026-03-23) Stage D: Documentation and quality gates
  - [x] Update developers-guide.md with seam injection patterns
  - [x] Mark roadmap item 9.3.7 as done
  - [x] Run full validation: `bun install`, `make build`, `make check-fmt`,
    `make lint`, `make test`

## Surprises & Discoveries

Unexpected findings during implementation that were not anticipated as risks.
Document with evidence so future work benefits.

- Observation: CodeScene flagged string-heavy function arguments in updater.ts
  after the main refactoring was complete.
  Evidence: 53.8% of function arguments were plain `string` types, exceeding
  the 39% threshold. Required two follow-up refactorings:
  1. Introduced `UpdateChannel` type and `ReleaseInfo` interface to replace
     loose string parameters
  2. Removed redundant `currentVersion` parameter from `buildFeedUrl`
  Impact: The threshold was brought below 39% while maintaining all test
  coverage and backward compatibility.

- Observation: The nullish coalescing operator (`??`) behaves differently from
  logical OR (`||`) when handling empty strings.
  Evidence: `emitUpdateAvailable` initially used `updateUrl ?? defaultUrl`,
  causing test failures when `updateUrl` was an empty string `''`.
  Impact: Changed to `updateUrl || defaultUrl` to treat empty strings as
  falsy and trigger the fallback, matching original behaviour.

## Decision log

Record every significant decision made while working on the plan.

- Decision: Use `useMemo` to memoize the default timer seam in
  `useNotification` hook to prevent unnecessary effect re-runs.
  Rationale: Without memoization, a new `{setTimeout, clearTimeout}` default object
  is created on every render, causing effect dependencies to change and
  triggering unnecessary re-runs of `setDismissTimer` and cleanup effects.
  Date/Author: 2026-03-23

- Decision: Collapse `UpdateChannel` + `parseUpdateChannel` + `isCanary` into
  a single `isCanaryChannel(raw?: string): boolean` helper.
  Rationale: Reduces cognitive load and removes the need for callers to
  handle type conversions. The single helper safely handles undefined and
  non-'canary' values.
  Date/Author: 2026-03-23

- Decision: Narrow `SchedulerSeam` to only expose `setTimeout` and
  `setInterval` (remove `clearTimeout`/`clearInterval`).
  Rationale: The updater module never calls the clear methods. Narrowing
  the seam reduces surface area while preserving full testability.
  Date/Author: 2026-03-23

## Outcomes & retrospective

Summarize outcomes, gaps, and lessons learned at completion.

### Outcomes

- Successfully replaced process-global timer and logger mutations with
  dependency injection seams in both notification and updater test suites.
- All 270 unit tests pass, including concurrent execution of the target
  test files (`notification.test.ts` and `updater.test.ts`).
- No global timer or logger mutations remain in either test file.
- Documentation updated in `developers-guide.md` with seam injection patterns.
- Roadmap item 9.3.7 marked as complete.
- CodeScene string-heavy argument warnings resolved through follow-up
  refactoring.

### Lessons learned

- Memoizing default seams is critical to prevent React effect re-runs;
  creating new objects on every render defeats the stability benefits of
  dependency injection.
- The distinction between `||` and `??` matters when empty strings are
  valid inputs that should trigger fallbacks.
- Narrowing seam interfaces to only the methods actually used keeps the
  contract minimal and maintainable.
- Single-purpose helper functions (`isCanaryChannel`) can replace type +
  parser + predicate trios, reducing indirection without losing type safety.

## Context and orientation

### Current state

The codebase has two test files that mutate process-global functions:

1. `test/unit/notification.test.ts` (lines 46-89): Originally defined `createFakeTimers()`
   that replaced `globalThis.setTimeout` and `globalThis.clearTimeout` during
   each test. The fake timers were installed before rendering and restored in
   `finally` blocks. This has been replaced with injected timer seams.

2. `test/unit/updater.test.ts` (lines 42-105): Originally defined `createTimerCapture()`
   that replaced `globalThis.setTimeout`, `globalThis.clearTimeout`,
   `globalThis.setInterval`, and `globalThis.clearInterval`. Also defined
   `createConsoleErrorCapture()` that replaced `console.error`. These were
   installed at test start and restored in `finally` blocks. This has been
   replaced with injected scheduler and logger seams.

### Target files

1. `lib/components/notification.tsx`: React component that uses
   `setTimeout`/`clearTimeout` for auto-dismiss timing. The timer
   calls are inside the `useNotification` hook.

2. `app/updater.ts`: Module that uses `setTimeout`/`setInterval` for update
   checking (lines 77-84) and `console.error` for error logging (line 62).

### Key terms

- **Seam**: A place in the code where behaviour can be altered without
  modifying the code itself. In this context, optional dependency injection
  points.
- **Test double**: A replacement for a real dependency in tests (mocks, stubs,
  fakes).
- **DOM-heavy**: Tests that require a DOM environment (via Happy DOM) because
  they render React components or exercise browser-like APIs.

## Plan of work

### Stage A: Analysis and seam design

Understand the current timer and logger usage in the target modules. Design
minimal seam interfaces that allow injection without breaking existing callers.

Acceptance: Document the seam interfaces with type signatures before proceeding.

### Stage B: Notification timer seam implementation

Modify the notification component to accept an optional `timer` prop containing
`setTimeout` and `clearTimeout` implementations. The `useNotification` hook
should use these when provided, falling back to globals otherwise.

Refactor the test to pass fake timer implementations through props instead of
mutating globals. Remove the `createFakeTimers()` helper and its install/
restore calls.

Validation: `bun test --concurrent test/unit/notification.test.ts` passes.

### Stage C: Updater scheduler/logger seam implementation

Modify the updater module to accept an optional `scheduler` parameter
containing `setTimeout`, `clearTimeout`, `setInterval`, and `clearInterval`
implementations, plus an optional `logger` parameter with `error` method.

The `updater` function should use injected implementations when provided,
falling back to globals otherwise. The `init` function should receive the
scheduler via closure or parameter.

Refactor the test to pass scheduler and logger implementations through the
function call instead of mutating globals. Remove `createTimerCapture()` and
`createConsoleErrorCapture()` helpers and their install/restore calls.

Validation: `bun test --concurrent test/unit/updater.test.ts` passes.

### Stage D: Documentation and quality gates

Update `docs/developers-guide.md` in the "Unit tests (Bun)" section to document
the seam injection pattern as the preferred approach for timer-dependent tests.

Mark roadmap item 9.3.7 as done in `docs/roadmap.md`.

Run full validation suite:

```bash
bun install
make build
make check-fmt
make lint
make test
```

## Concrete steps

### Stage B: Notification changes

In `lib/components/notification.tsx`:

1. Define a `TimerSeam` interface:

```typescript
interface TimerSeam {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}
```

1. Extend `NotificationProps` to accept optional `timer?: TimerSeam`.

2. Update `useNotification` to accept optional timer parameter and use it
   instead of globals:

```typescript
const useNotification = (
  props: NotificationProps,
  ref: React.ForwardedRef<HTMLDivElement>,
  timer?: TimerSeam
) => {
  // Memoize the default to prevent effect re-runs
  const timerSeam = useMemo(
    () => timer ?? {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout},
    [timer]
  );
  const {setTimeout, clearTimeout} = timerSeam;
  // ... use setTimeout/clearTimeout from destructured timer
};
```

1. Pass timer from props through to `useNotification` in the component.

In `test/unit/notification.test.ts`:

1. Remove `createFakeTimers()` helper entirely.

2. Create a test-double factory that returns a TimerSeam:

```typescript
const createFakeTimerSeam = () => {
  let now = 0;
  let nextId = 1;
  const scheduled: Array<{id: number; runAt: number; callback: () => void}> = [];

  return {
    advanceTimersByTime: (ms: number) => {
      const target = now + ms;
      while (scheduled.length > 0 && scheduled[0].runAt <= target) {
        const [nextTimer] = scheduled;
        scheduled.shift();
        now = nextTimer.runAt;
        nextTimer.callback();
        scheduled.sort((a, b) => a.runAt - b.runAt);
      }
      now = target;
    },
    timerSeam: {
      setTimeout: (callback: () => void, delay = 0) => {
        const id = nextId++;
        scheduled.push({id, runAt: now + delay, callback});
        scheduled.sort((a, b) => a.runAt - b.runAt);
        return id as unknown as NodeJS.Timeout;
      },
      clearTimeout: (handle?: NodeJS.Timeout) => {
        const id = Number(handle);
        const index = scheduled.findIndex((t) => t.id === id);
        if (index !== -1) scheduled.splice(index, 1);
      }
    }
  };
};
```

1. Update each test to pass `timerSeam` through props:

```typescript
const {advanceTimersByTime, timerSeam} = createFakeTimerSeam();
// ... render with timer={timerSeam} prop
// ... use advanceTimersByTime instead of timers.advanceTimersByTime
```

1. Remove all `timers.install()` and `timers.restore()` calls.

### Stage C: Updater changes

In `app/updater.ts`:

1. Define `SchedulerSeam` and `LoggerSeam` interfaces:

```typescript
interface SchedulerSeam {
  setTimeout: typeof globalThis.setTimeout;
  setInterval: typeof globalThis.setInterval;
}

interface LoggerSeam {
  error: (...args: unknown[]) => void;
}
```

1. Update `updater` function signature to accept optional seams:

```typescript
export interface UpdaterOptions {
  scheduler?: SchedulerSeam;
  logger?: LoggerSeam;
}

const updater = (win: BrowserWindow, options?: UpdaterOptions) => {
  const scheduler = options?.scheduler ?? {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval
  };
  const logger = options?.logger ?? console;
  // ... pass scheduler/logger through to init or use directly
};
```

1. Update `init` to accept and use scheduler/logger with concurrency guard:

```typescript
async function init(scheduler: SchedulerSeam, logger: LoggerSeam) {
  if (isInitializing) return;
  isInitializing = true;

  try {
    autoUpdater.on('error', (err) => {
      logger.error('Error fetching updates', `${err.message} (${err.stack})`);
    });
    // ... use scheduler.setTimeout and scheduler.setInterval
    isInit = true;
  } finally {
    isInitializing = false;
  }
}
```

In `test/unit/updater.test.ts`:

1. Remove `createTimerCapture()` and `createConsoleErrorCapture()` helpers.

2. Create test-double seam factories:

```typescript
const createSchedulerSeam = () => {
  const timeoutCallbacks: Array<() => void> = [];
  const intervalCallbacks: Array<() => void> = [];
  let nextTimerId = 0;

  return {
    timeoutCallbacks,
    intervalCallbacks,
    scheduler: {
      setTimeout: (callback: () => void) => {
        nextTimerId += 1;
        timeoutCallbacks.push(callback);
        return nextTimerId as unknown as NodeJS.Timeout;
      },
      setInterval: (callback: () => void) => {
        nextTimerId += 1;
        intervalCallbacks.push(callback);
        return nextTimerId as unknown as NodeJS.Timeout;
      }
    }
  };
};

const createLoggerSeam = () => {
  const errorCalls: unknown[][] = [];
  return {
    errorCalls,
    logger: {
      error: (...args: unknown[]) => {
        errorCalls.push(args);
      }
    }
  };
};
```

1. Update tests to pass seams through `updater(win, {scheduler, logger})`:

```typescript
const {scheduler, timeoutCallbacks, intervalCallbacks} = createSchedulerSeam();
const {logger, errorCalls} = createLoggerSeam();
const {default: updater} = await loadUpdater();
updater(winStub as unknown as Electron.BrowserWindow, {scheduler, logger});
```

Note: The scheduler seam only exposes `setTimeout` and `setInterval` since the
updater module does not call the clear methods.

1. Remove all `timers.install()`, `timers.restore()`, `consoleCapture.install()`,
   and `consoleCapture.restore()` calls.

### Stage D: Documentation update

In `docs/developers-guide.md`, add a new subsection under "Unit tests (Bun)"
after the existing 9.3.6 section and before "End-to-end (E2E) tests":

```markdown
For roadmap item 9.3.7 and similar timer/logger-dependent module work, use
injected seams instead of process-global mutations:

- Pass timer implementations (`setTimeout`, `clearTimeout` for notification;
  `setTimeout`, `setInterval` for updater) through component props or function
  options rather than replacing `globalThis` methods.
- Pass logger implementations (`console.error`, etc.) through function options
  rather than replacing `console` methods.
- Keep global fallbacks for production code when seams are not provided.
- Test with explicit `--concurrent` stress runs to verify isolation:

  ```bash
  bun test --concurrent test/unit/notification.test.ts
  bun test --concurrent test/unit/updater.test.ts
  ```

Suites that rely on timer or logger seams must not mutate global state during
test execution; instead, provide test-doubles through the module's public
interface.

## Validation and acceptance

### Quality criteria (what "done" means)

- Tests: Both notification and updater unit test suites pass.
- Concurrent safety: Both suites pass with `bun test --concurrent`.
- No global mutations: Neither suite replaces `globalThis.setTimeout`,
  `globalThis.clearTimeout`, `globalThis.setInterval`, or `console.error`.
- Lint/typecheck: `make lint` and `make typecheck` pass with no new errors.
- Build: `make build` succeeds.
- Format: `make check-fmt` succeeds.
- Documentation: `docs/developers-guide.md` updated with seam injection
  patterns.
- Roadmap: Item 9.3.7 marked as done in `docs/roadmap.md`.

### Quality method (how we check)

1. Run notification tests with concurrency:

   ```bash
   bun test --concurrent test/unit/notification.test.ts
   ```

   Expected: All tests pass, no global timer mutations detected.

2. Run updater tests with concurrency:

   ```bash
   bun test --concurrent test/unit/updater.test.ts
   ```

   Expected: All tests pass, no global timer or logger mutations detected.

3. Run full validation suite:

   ```bash
   bun install
   make build
   make check-fmt
   make lint
   make test
   ```

   Expected: All commands succeed.

4. Verify no global replacements in test files:

   ```bash
   grep -E 'globalThis\.(setTimeout|clearTimeout|setInterval)' \
     test/unit/notification.test.ts test/unit/updater.test.ts || echo "No global timer mutations found"
   grep -E 'console\.error\s*=' \
     test/unit/updater.test.ts || echo "No console.error mutation found"
   ```

   Expected: Both grep commands report no matches (or only the verification
   echo).

## Idempotence and recovery

Steps can be re-run safely:

- `bun test` commands are read-only and can be repeated.
- File modifications are additive (new props/options) with backward-compatible
  fallbacks.
- If validation fails, fix the issue and re-run the same validation command.

Rollback: If the approach proves unworkable, revert the changes and escalate
with findings documented in Decision Log.

## Interfaces and dependencies

### New TypeScript interfaces

In `lib/components/notification.tsx`:

```typescript
interface TimerSeam {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}
```

In `typings/hyper.d.ts`:

```typescript
interface NotificationProps {
  // ... existing props
  timer?: TimerSeam;
}
```

In `app/updater.ts`:

```typescript
interface SchedulerSeam {
  setTimeout: typeof globalThis.setTimeout;
  setInterval: typeof globalThis.setInterval;
}

interface LoggerSeam {
  error: (...args: unknown[]) => void;
}

export interface UpdaterOptions {
  scheduler?: SchedulerSeam;
  logger?: LoggerSeam;
}

// Updated updater function signature
const updater = (win: BrowserWindow, options?: UpdaterOptions) => { ... };
```

### Dependencies

No new external dependencies required. Uses:

- Existing Bun test runner
- Existing Happy DOM setup
- Existing React Testing Library patterns
- Existing TypeScript type system

## Revision note

(Initial draft - no revisions yet)
