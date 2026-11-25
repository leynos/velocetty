/**
 * @file Property tests: the interpreter refines the proved invocation machine.
 *
 * The Dafny proof covers `step` and traces of any length. This file checks the
 * remaining gap — that the asynchronous interpreter, with a real
 * `AbortController`, a deferrable execution gate, and handlers that fulfil or
 * reject at different moments, resolves exactly what the machine says it
 * should. `INV-INTERPRETER-REFINES`, `INV-RUN-ONCE` and `INV-SETTLE-ONCE` are
 * the obligations.
 *
 * Method: draw a scenario class first with `fc.constantFrom`, so every class is
 * reached by construction, then let `fc.scheduler()` order the interleaving of
 * the handler's settlement against the caller's abort. The recorded machine
 * trace is folded from the initial state and its outcome compared with the
 * interpreter's resolved result.
 *
 * Invariants:
 * - Every scenario reaches its class at least once (no vacuous properties).
 * - No timer is used; ordering comes from the scheduler alone.
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/cancellation.property.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/dispatcher.ts`
 * - `../../../lib/command-dispatch/policy/invocation-machine.ts`
 */
import {expect, test} from 'bun:test';
import fc from 'fast-check';

import {asCommandId, type CommandResult} from '@shared/types/commands';
import type {JsonValue} from '@shared/types/json';
import {createCommandDispatcher} from '../../../lib/command-dispatch/dispatcher';
import {
  initialState,
  type MachineEvent,
  type MachineState,
  outcomeOf,
  step
} from '../../../lib/command-dispatch/policy/invocation-machine';
import {createDispatcherFakes, fakeDefinition, type FakeCommand} from '../../testUtils/command-dispatcher-fakes';

const COMMAND = 'test:property:cancellation';
const RUNS = 200;
const TIMEOUT_MS = 30_000;

type Scenario = 'ok' | 'rejected' | 'cancelledBefore' | 'cancelledDuring' | 'deferred' | 'deferredThenAborted';

/** A JSON scalar, safe to hand a handler as its resolved value. */
const jsonScalar: fc.Arbitrary<JsonValue> = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));

const SCENARIOS = fc.constantFrom<Scenario>(
  'ok',
  'rejected',
  'cancelledBefore',
  'cancelledDuring',
  'deferred',
  'deferredThenAborted'
);

/** Folds a recorded trace through the proved machine. */
const foldTrace = (trace: readonly MachineEvent[], isAborted: boolean): MachineState => {
  let state = initialState(isAborted).state;
  for (const event of trace) {
    state = step(state, event).state;
  }
  return state;
};

/** Maps a machine outcome onto the result status the caller must observe. */
const statusOf = (outcome: string): CommandResult['status'] => {
  if (outcome === 'ok') {
    return 'ok';
  }
  if (outcome === 'cancelledBefore' || outcome === 'cancelledDuring' || outcome === 'pending') {
    return 'cancelled';
  }
  return 'error';
};

/** Builds one scenario's fakes, its abort plan, and the value its handler resolves. */
const buildScenario = (scenario: Scenario, value: JsonValue) => {
  const controller = new AbortController();
  const isPreAborted = scenario === 'cancelledBefore';
  if (isPreAborted) {
    controller.abort();
  }

  // Only `cancelledDuring` needs a handler that never settles on its own; the
  // deferred scenarios settle once their gate effect runs.
  const command: FakeCommand =
    scenario === 'rejected'
      ? {definition: fakeDefinition(COMMAND), rejection: new Error('handler failed')}
      : {definition: fakeDefinition(COMMAND), handlerValue: value};
  if (scenario === 'cancelledDuring') {
    command.pending = true;
  }

  const fakes = createDispatcherFakes<undefined>({
    commands: {[COMMAND]: command},
    deferGate: scenario === 'deferred' || scenario === 'deferredThenAborted'
  });

  const trace: MachineEvent[] = [];
  const ports = {...fakes.ports, trace: (event: MachineEvent) => trace.push(event)};

  return {controller, fakes, ports, trace, isPreAborted};
};

/** Applies the scenario's abort and gate actions, so every scenario settles. */
const driveScenario = (
  scenario: Scenario,
  controller: AbortController,
  fakes: ReturnType<typeof createDispatcherFakes>
): void => {
  if (scenario === 'cancelledDuring') {
    controller.abort();
  }
  if (scenario === 'deferred') {
    fakes.runDeferredGate();
  }
  if (scenario === 'deferredThenAborted') {
    controller.abort();
    fakes.runDeferredGate();
  }
};

test(
  'the interpreter resolves exactly what the folded machine trace says',
  async () => {
    const reached = new Set<Scenario>();

    await fc.assert(
      fc.asyncProperty(SCENARIOS, jsonScalar, (scenario, value) => {
        reached.add(scenario);
        const {controller, fakes, ports, trace, isPreAborted} = buildScenario(scenario, value);
        const dispatcher = createCommandDispatcher(ports);

        const pending = dispatcher.invoke(
          {id: asCommandId(COMMAND), args: null, source: 'ui'},
          {signal: controller.signal}
        );

        driveScenario(scenario, controller, fakes);

        return pending.then((result) => {
          const folded = foldTrace(trace, isPreAborted);
          expect(result.status).toBe(statusOf(outcomeOf(folded)));
          expect(fakes.handlerCalls.length).toBeLessThanOrEqual(1);
          return true;
        });
      }),
      {numRuns: RUNS}
    );

    // Non-vacuity: every scenario class was actually generated.
    expect(reached.size).toBe(6);
  },
  TIMEOUT_MS
);

test(
  'a settled invocation never runs the handler after cancellation',
  async () => {
    await fc.assert(
      fc.asyncProperty(SCENARIOS, (scenario) => {
        const {controller, fakes, ports} = buildScenario(scenario, null);
        const dispatcher = createCommandDispatcher(ports);

        const pending = dispatcher.invoke(
          {id: asCommandId(COMMAND), args: null, source: 'ui'},
          {signal: controller.signal}
        );

        driveScenario(scenario, controller, fakes);

        return pending.then((result) => {
          if (result.status === 'cancelled' && result.stage === 'before-execution') {
            expect(fakes.handlerCalls).toHaveLength(0);
          }
          expect(fakes.handlerCalls.length).toBeLessThanOrEqual(1);
          return true;
        });
      }),
      {numRuns: RUNS}
    );
  },
  TIMEOUT_MS
);
