# Replace process-global timer and logger overrides with injected seams in DOM-heavy unit tests

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

Use a list with checkboxes to summarise granular steps. Every stopping point
must be documented here, even if it requires splitting a partially completed
task into two ("done" vs. "remaining"). This section must always reflect the
actual current state of the work.

- [ ] (Pending) Stage A: Analysis and seam design
  - [ ] Review notification.tsx timer usage patterns
  - [ ] Review updater.ts timer and logger usage patterns
  - [ ] Design timer seam interface for notification component
  - [ ] Design scheduler/logger seam interface for updater module

- [ ] (Pending) Stage B: Notification timer seam implementation
  - [ ] Add optional timer seam to Notification component props
  - [ ] Update useNotification hook to accept injected timer methods
  - [ ] Refactor notification.test.ts to use injected seams
  - [ ] Remove global timer replacement from notification.test.ts
  - [ ] Verify notification tests pass with `--concurrent`

- [ ] (Pending) Stage C: Updater scheduler/logger seam implementation
  - [ ] Add optional scheduler seam to updater function signature
  - [ ] Add optional logger seam to updater function signature
  - [ ] Update updater.ts to use injected seams with global fallbacks
  - [ ] Refactor updater.test.ts to use injected seams
  - [ ] Remove global timer and console.error replacement from updater.test.ts
  - [ ] Verify updater tests pass with `--concurrent`

- [ ] (Pending) Stage D: Documentation and quality gates
  - [ ] Update developers-guide.md with seam injection patterns
  - [ ] Mark roadmap item 9.3.7 as done
  - [ ] Run full validation: `bun install`, `make build`, `make check-fmt`,
    `make lint`, `make test`

## Surprises & Discoveries

Unexpected findings during implementation that were not anticipated as risks.
Document with evidence so future work benefits.

(None yet)

## Decision log

Record every significant decision made while working on the plan.

(None yet)

## Outcomes & retrospective

Summarize outcomes, gaps, and lessons learned at completion.

(None yet - to be filled at completion)

## Context and orientation

### Current state

The codebase has two test files that mutate process-global functions:

1. `test/unit/notification.test.ts` (lines 46-89): Defines `createFakeTimers()`
   that replaces `globalThis.setTimeout` and `globalThis.clearTimeout` during
   each test. The fake timers are installed before rendering and restored in
   `finally` blocks.

2. `test/unit/updater.test.ts` (lines 42-105): Defines `createTimerCapture()`
   that replaces `globalThis.setTimeout`, `globalThis.clearTimeout`,
   `globalThis.setInterval`, and `globalThis.clearInterval`. Also defines
   `createConsoleErrorCapture()` that replaces `console.error`. These are
   installed at test start and restored in `finally` blocks.

### Target files

1. `lib/components/notification.tsx`: React component that uses
   `setTimeout`/`clearTimeout` for auto-dismiss timing (lines 59-69). The timer
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

2. Extend `NotificationProps` to accept optional `timer?: TimerSeam`.

3. Update `useNotification` to accept optional timer parameter and use it
   instead of globals:

```typescript
const useNotification = (
  props: NotificationProps,
  ref: React.ForwardedRef<HTMLDivElement>,
  timer?: TimerSeam
) => {
  const {setTimeout, clearTimeout} = timer ?? {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  // ... use setTimeout/clearTimeout from destructured timer
};
```

4. Pass timer from props through to `useNotification` in the component.

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

3. Update each test to pass `timerSeam` through props:

```typescript
const {advanceTimersByTime, timerSeam} = createFakeTimerSeam();
// ... render with timer={timerSeam} prop
// ... use advanceTimersByTime instead of timers.advanceTimersByTime
```

4. Remove all `timers.install()` and `timers.restore()` calls.

### Stage C: Updater changes

In `app/updater.ts`:

1. Define `SchedulerSeam` and `LoggerSeam` interfaces:

```typescript
interface SchedulerSeam {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}

interface LoggerSeam {
  error: (...args: unknown[]) => void;
}
```

2. Update `updater` function signature to accept optional seams:

```typescript
interface UpdaterOptions {
  scheduler?: SchedulerSeam;
  logger?: LoggerSeam;
}

const updater = (win: BrowserWindow, options?: UpdaterOptions) => {
  const scheduler = options?.scheduler ?? {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  };
  const logger = options?.logger ?? console;
  // ... pass scheduler/logger through to init or use directly
};
```

3. Update `init` to accept and use scheduler/logger:

```typescript
async function init(scheduler: SchedulerSeam, logger: LoggerSeam) {
  autoUpdater.on('error', (err) => {
    logger.error('Error fetching updates', `${err.message} (${err.stack})`);
  });
  // ... use scheduler.setTimeout and scheduler.setInterval
}
```

In `test/unit/updater.test.ts`:

1. Remove `createTimerCapture()` and `createConsoleErrorCapture()` helpers.

2. Create test-double seam factories:

```typescript
const createSchedulerSeam = () => {
  const timeoutCallbacks: Array<() => void> = [];
  const intervalCallbacks: Array<() => void> = [];
  const clearedTimeouts: number[] = [];
  const clearedIntervals: number[] = [];
  let nextTimerId = 0;

  return {
    timeoutCallbacks,
    intervalCallbacks,
    clearedTimeouts,
    clearedIntervals,
    scheduler: {
      setTimeout: (callback: () => void) => {
        nextTimerId += 1;
        timeoutCallbacks.push(callback);
        return nextTimerId as unknown as NodeJS.Timeout;
      },
      clearTimeout: (timer?: NodeJS.Timeout) => {
        const timerId = Number(timer);
        if (Number.isFinite(timerId)) clearedTimeouts.push(timerId);
      },
      setInterval: (callback: () => void) => {
        nextTimerId += 1;
        intervalCallbacks.push(callback);
        return nextTimerId as unknown as NodeJS.Timeout;
      },
      clearInterval: (timer?: NodeJS.Timeout) => {
        const timerId = Number(timer);
        if (Number.isFinite(timerId)) clearedIntervals.push(timerId);
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

3. Update tests to pass seams through `updater(win, {scheduler, logger})`:

```typescript
const {scheduler, timeoutCallbacks, intervalCallbacks} = createSchedulerSeam();
const {logger, errorCalls} = createLoggerSeam();
const {default: updater} = await loadUpdater();
updater(winStub as unknown as Electron.BrowserWindow, {scheduler, logger});
```

4. Remove all `timers.install()`, `timers.restore()`, `consoleCapture.install()`,
   and `consoleCapture.restore()` calls.

### Stage D: Documentation update

In `docs/developers-guide.md`, add a new subsection under "Unit tests (Bun)"
after the existing 9.3.6 section and before "End-to-end (E2E) tests":

```markdown
For roadmap item 9.3.7 and similar timer/logger-dependent module work, use
injected seams instead of process-global mutations:

- Pass timer implementations (`setTimeout`, `clearTimeout`, `setInterval`,
  `clearInterval`) through component props or function options rather than
  replacing `globalThis` methods.
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
```

## Validation and acceptance

### Quality criteria (what "done" means)

- Tests: Both notification and updater unit test suites pass.
- Concurrent safety: Both suites pass with `bun test --concurrent`.
- No global mutations: Neither suite replaces `globalThis.setTimeout`,
  `globalThis.clearTimeout`, `globalThis.setInterval`,
  `globalThis.clearInterval`, or `console.error`.
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
   grep -E 'globalThis\.(setTimeout|clearTimeout|setInterval|clearInterval)' \
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

// Extended NotificationProps
interface NotificationProps {
  // ... existing props
  timer?: TimerSeam;
}
```

In `app/updater.ts`:

```typescript
interface SchedulerSeam {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}

interface LoggerSeam {
  error: (...args: unknown[]) => void;
}

interface UpdaterOptions {
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
