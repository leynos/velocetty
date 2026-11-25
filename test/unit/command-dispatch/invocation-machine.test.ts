/**
 * @file Table and trace tests for the pure invocation state machine.
 *
 * The machine is *proved* in `policy/invocation-machine.dfy`; these tests are
 * the executable counterpart. They keep the proof honest by pinning the
 * concrete behaviour a reader needs to understand — the gate order, the
 * exactly-once settlement, and the cancellation outcomes — and they run in
 * milliseconds, so a spec regression is caught long before a prover run.
 *
 * Responsibilities:
 * - exhaust the 16 gate-verdict combinations and assert the first refusal wins
 * - walk the action trace for the four shapes that matter: all pass, a refusal,
 *   a deferred gate, and cancellation before and during execution
 * - assert absorption: no event moves a settled machine
 *
 * Invariants:
 * - every case runs against the real machine; no fakes are involved
 * - the tests never assert on `//@` annotations, only on observable behaviour
 *
 * Usage:
 * - `bun test --isolate test/unit/command-dispatch/invocation-machine.test.ts`
 *
 * Related modules:
 * - `../../../lib/command-dispatch/policy/invocation-machine.ts`
 * - `./invocation-machine.property.test.ts` folds random traces through the
 *   same machine
 */
import {describe, expect, test} from 'bun:test';

import {
  type MachineAction,
  type MachineEvent,
  type MachineState,
  type MachineStep,
  type MachineOutcome,
  initialState,
  outcomeOf,
  step
} from '../../../lib/command-dispatch/policy/invocation-machine';

const GATE_COUNT = 4;

const pass = {kind: 'gatePassed'} as const satisfies MachineEvent;
const fail = {kind: 'gateFailed'} as const satisfies MachineEvent;
const aborted = {kind: 'aborted'} as const satisfies MachineEvent;
const gateRan = {kind: 'gateRan'} as const satisfies MachineEvent;
const gatePending = {kind: 'gatePending'} as const satisfies MachineEvent;
const hostEmitted = {kind: 'hostEmitted'} as const satisfies MachineEvent;

/** Feeds events through the machine, returning the final step and the actions. */
const run = (events: readonly MachineEvent[], isAborted = false) => {
  let current: MachineStep = initialState(isAborted);
  const actions: MachineAction[] = [current.action];
  for (const event of events) {
    current = step(current.state, event);
    actions.push(current.action);
  }
  return {state: current.state, actions};
};

/** Drives admission to the execution gate and opens it. */
const ADMIT_ALL: readonly MachineEvent[] = [pass, pass, pass, pass, gateRan];

describe('initialState', () => {
  test('starts admitting at gate 0 when the signal has not aborted', () => {
    const first = initialState(false);
    expect(first.state).toEqual({phase: 'admitting', gate: 0});
    expect(first.action).toEqual({kind: 'evaluateGate', gate: 0});
  });

  test('settles as cancelledBefore when the signal already aborted', () => {
    const first = initialState(true);
    expect(first.state).toEqual({phase: 'settled', outcome: 'cancelledBefore', failedGate: -1});
    expect(first.action).toEqual({kind: 'settle'});
  });
});

describe('INV-GATE-ORDER', () => {
  // Every combination of pass/fail over four gates. The mask bit for gate k is
  // set when that gate passes; the lowest clear bit is the first refusal.
  const gateIndices = Array.from({length: GATE_COUNT}, (_unused, gate) => gate);
  const verdicts: {mask: number; expectedGate: number}[] = [];
  for (let mask = 0; mask < 1 << GATE_COUNT; mask += 1) {
    const firstClear = gateIndices.find((gate) => (mask & (1 << gate)) === 0);
    if (firstClear !== undefined) {
      verdicts.push({mask, expectedGate: firstClear});
    }
  }

  test.each(verdicts)('mask $mask refuses at gate $expectedGate', ({mask, expectedGate}) => {
    const events: MachineEvent[] = [];
    for (let gate = 0; gate < GATE_COUNT; gate += 1) {
      events.push((mask & (1 << gate)) === 0 ? fail : pass);
    }

    const {state} = run(events);

    expect(state.phase).toBe('settled');
    if (state.phase !== 'settled') {
      throw new Error('expected a settled machine');
    }
    expect(state.outcome).toBe('rejected');
    expect(state.failedGate).toBe(expectedGate);
  });

  test('evaluates gates in index order and opens the gate only after all four pass', () => {
    const {actions} = run([pass, pass, pass, pass]);

    expect(actions).toEqual([
      {kind: 'evaluateGate', gate: 0},
      {kind: 'evaluateGate', gate: 1},
      {kind: 'evaluateGate', gate: 2},
      {kind: 'evaluateGate', gate: 3},
      {kind: 'openGate'}
    ]);
  });

  test('never evaluates a later gate after an earlier refusal', () => {
    const {actions} = run([pass, fail, pass, pass]);

    expect(actions.filter((action) => action.kind === 'evaluateGate')).toEqual([
      {kind: 'evaluateGate', gate: 0},
      {kind: 'evaluateGate', gate: 1}
    ]);
    expect(actions).not.toContainEqual({kind: 'openGate'});
  });

  test('a refusal carries the index of the gate that refused it', () => {
    const {state} = run([pass, pass, fail]);

    expect(state).toEqual({phase: 'settled', outcome: 'rejected', failedGate: 2});
  });
});

describe('INV-RUN-ONCE', () => {
  test('runs the handler once on the all-pass trace', () => {
    const {actions, state} = run([...ADMIT_ALL, hostEmitted]);

    expect(actions.filter((action) => action.kind === 'runHandler')).toHaveLength(1);
    expect(outcomeOf(state)).toBe('ok');
  });

  test('does not run the handler when the signal aborted after the gate opened', () => {
    const {actions} = run([pass, pass, pass, pass, gatePending, aborted, gateRan]);

    expect(actions.filter((action) => action.kind === 'runHandler')).toHaveLength(0);
  });

  test('does not run the handler again when the gate re-reports', () => {
    const {actions} = run([...ADMIT_ALL, gateRan, gateRan, hostEmitted]);

    expect(actions.filter((action) => action.kind === 'runHandler')).toHaveLength(1);
  });

  test('a pending gate emits no action at all', () => {
    const {actions} = run([pass, pass, pass, pass, gatePending]);

    expect(actions.at(-1)).toEqual({kind: 'idle'});
  });
});

describe('INV-SETTLE-ONCE', () => {
  const settledEvents: readonly MachineEvent[] = [aborted, gateRan, pass, fail, gatePending, hostEmitted];

  test.each(settledEvents.map((event) => ({event})))('absorbs $event.kind once settled', ({event}) => {
    const settled = step(initialState(false).state, fail).state;
    expect(settled.phase).toBe('settled');

    const after = step(settled, event);

    expect(after.state).toBe(settled);
    expect(after.action).toEqual({kind: 'idle'});
  });

  test('settles exactly once on a successful trace', () => {
    const {actions} = run([...ADMIT_ALL, hostEmitted, aborted, hostEmitted]);

    expect(actions.filter((action) => action.kind === 'settle')).toHaveLength(1);
  });

  test('settles exactly once on a refused trace', () => {
    const {actions} = run([fail, pass, aborted]);

    expect(actions.filter((action) => action.kind === 'settle')).toHaveLength(1);
  });
});

describe('INV-CANCEL-OUTCOME', () => {
  const WRITE = 'cancelledBefore';
  const DURING = 'cancelledDuring';

  const cases: {description: string; events: readonly MachineEvent[]; expected: MachineOutcome}[] = [
    {description: 'an already-aborted signal', events: [], expected: WRITE},
    {description: 'an abort while admitting', events: [pass, aborted], expected: WRITE},
    {
      description: 'an abort while awaiting the execution gate',
      events: [pass, pass, pass, pass, gatePending, aborted],
      expected: WRITE
    },
    {description: 'an abort while executing', events: [...ADMIT_ALL, aborted], expected: DURING},
    {
      description: 'a fulfilment after an abort during execution',
      events: [...ADMIT_ALL, aborted, {kind: 'handlerFulfilled', resultValid: true}],
      expected: DURING
    },
    {
      description: 'a handler rejection carrying the abort reason',
      events: [...ADMIT_ALL, {kind: 'handlerRejected', isAbortReason: true}],
      expected: DURING
    }
  ];

  test.each(cases)('$description settles $expected', ({events, expected}) => {
    const {state} = run(events, events.length === 0);

    expect(outcomeOf(state)).toBe(expected);
  });
});

describe('handler outcomes', () => {
  const cases: {description: string; events: readonly MachineEvent[]; expected: MachineOutcome}[] = [
    {
      description: 'a valid result',
      events: [...ADMIT_ALL, {kind: 'handlerFulfilled', resultValid: true}],
      expected: 'ok'
    },
    {
      description: 'an invalid result',
      events: [...ADMIT_ALL, {kind: 'handlerFulfilled', resultValid: false}],
      expected: 'failedResult'
    },
    {
      description: 'a rejection',
      events: [...ADMIT_ALL, {kind: 'handlerRejected', isAbortReason: false}],
      expected: 'failedHandler'
    },
    {description: 'a host emission', events: [...ADMIT_ALL, hostEmitted], expected: 'ok'}
  ];

  test.each(cases)('$description settles $expected', ({events, expected}) => {
    expect(outcomeOf(run(events).state)).toBe(expected);
  });
});

describe('outcomeOf', () => {
  test('reports pending while the invocation is running', () => {
    expect(outcomeOf({phase: 'admitting', gate: 1})).toBe('pending');
    expect(outcomeOf({phase: 'awaitingGate'})).toBe('pending');
    expect(outcomeOf({phase: 'executing'})).toBe('pending');
  });

  test('reports the settled outcome for every outcome value', () => {
    const outcomes: MachineOutcome[] = [
      'ok',
      'rejected',
      'failedHandler',
      'failedResult',
      'cancelledBefore',
      'cancelledDuring'
    ];

    for (const outcome of outcomes) {
      const state: MachineState = {phase: 'settled', outcome, failedGate: outcome === 'rejected' ? 2 : -1};
      expect(outcomeOf(state)).toBe(outcome);
    }
  });
});
