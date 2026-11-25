/**
 * @file Pure invocation state machine for the frontend command dispatcher.
 *
 * This module is the dispatcher's proved core. The dispatcher
 * (`../dispatcher.ts`) is a thin interpreter: it holds one `MachineState`,
 * asks `step` what to do next, performs exactly that action, and feeds the
 * outcome back as the next `MachineEvent`. Nothing else decides anything.
 *
 * Invariants, each proved in `invocation-machine.dfy`:
 * - `INV-GATE-ORDER`: admission gates are evaluated in index order, and a
 *   refused invocation names the first gate that refused it.
 * - `INV-RUN-ONCE`: `runHandler` is emitted at most once, only from
 *   `awaitingGate` on `gateRan`, and never after an abort has settled the
 *   invocation.
 * - `INV-SETTLE-ONCE`: `settle` is emitted at most once; a settled state
 *   absorbs every later event with an `idle` action.
 * - `INV-CANCEL-OUTCOME`: an abort before `runHandler` settles as
 *   `cancelledBefore`, and an abort after it settles as `cancelledDuring`.
 *
 * The module imports nothing. It carries no timers and reads no clock, so it
 * is a total function from state and event to state and action. That is what
 * makes it provable, and the boundary script enforces it.
 *
 * Usage:
 * - `initialState(isAborted)` seeds an invocation. Callers who hold no signal
 *   pass `false`. Then `step` drives every transition.
 *
 * Related modules:
 * - `../dispatcher.ts` interprets this machine.
 * - `../ports.ts` defines the effects the interpreter performs.
 * - `../../../docs/adr-007-frontend-command-dispatcher-contract.md` records
 *   why the machine is a single pure function.
 */

/** The four admission gates, in the order the machine evaluates them. */
export type GateIndex = 0 | 1 | 2 | 3;

/** `resolve`, `routeArgs`, `validateArgs`, `enablement`. */
export const LAST_GATE_INDEX = 3;

/**
 * How an invocation finished.
 *
 * `rejected` means an admission gate refused it; `failedHandler` and
 * `failedResult` mean the handler or its result failed; the `cancelled`
 * outcomes record where cancellation took effect.
 */
export type MachineOutcome =
  | 'ok'
  | 'rejected'
  | 'failedHandler'
  | 'failedResult'
  | 'cancelledBefore'
  | 'cancelledDuring';

/**
 * The outcome as `outcomeOf` reports it, with `pending` for an invocation
 * that has not settled yet.
 *
 * Spelled out as flat literals rather than `MachineOutcome | 'pending'`,
 * because LemmaScript turns each named literal union into its own Dafny
 * datatype and cannot then unify the two.
 */
export type ReportedOutcome =
  | 'ok'
  | 'rejected'
  | 'failedHandler'
  | 'failedResult'
  | 'cancelledBefore'
  | 'cancelledDuring'
  | 'pending';

export type MachineState =
  | {readonly phase: 'admitting'; readonly gate: number}
  | {readonly phase: 'awaitingGate'}
  | {readonly phase: 'executing'}
  | {readonly phase: 'settled'; readonly outcome: MachineOutcome; readonly failedGate: number};

export type MachineEvent =
  | {readonly kind: 'gatePassed'}
  | {readonly kind: 'gateFailed'}
  | {readonly kind: 'aborted'}
  | {readonly kind: 'gateRan'}
  | {readonly kind: 'gatePending'}
  | {readonly kind: 'hostEmitted'}
  | {readonly kind: 'handlerFulfilled'; readonly resultValid: boolean}
  | {readonly kind: 'handlerRejected'; readonly isAbortReason: boolean};

/**
 * What the interpreter must do next.
 *
 * Named `idle` rather than `none`: Dafny reserves `None` as the empty
 * optional constructor, so a `none` action collides with it in the generated
 * proof artefact.
 */
export type MachineAction =
  | {readonly kind: 'evaluateGate'; readonly gate: number}
  | {readonly kind: 'openGate'}
  | {readonly kind: 'runHandler'}
  | {readonly kind: 'settle'}
  | {readonly kind: 'idle'};

export interface MachineStep {
  readonly state: MachineState;
  readonly action: MachineAction;
}

export function initialState(isAborted: boolean): MachineStep {
  //@ verify
  //@ ensures \result.state.phase === 'settled' <==> isAborted
  //@ ensures isAborted ==> (\result.state.phase === 'settled' && \result.state.outcome === 'cancelledBefore')
  //@ ensures !isAborted ==> (\result.state.phase === 'admitting' && \result.state.gate === 0)
  //@ ensures isAborted ==> \result.action.kind === 'settle'
  //@ ensures !isAborted ==> (\result.action.kind === 'evaluateGate' && \result.action.gate === 0)
  if (isAborted) {
    return {state: {phase: 'settled', outcome: 'cancelledBefore', failedGate: -1}, action: {kind: 'settle'}};
  }
  return {state: {phase: 'admitting', gate: 0}, action: {kind: 'evaluateGate', gate: 0}};
}

export function step(state: MachineState, event: MachineEvent): MachineStep {
  //@ verify
  //@ requires state.phase === 'admitting' ==> (state.gate >= 0 && state.gate <= 3)
  //@ ensures state.phase === 'settled' ==> (\result.state === state && \result.action.kind === 'idle')
  //@ ensures state.phase !== 'settled' && event.kind === 'aborted' ==> \result.state.phase === 'settled'
  //@ ensures (\result.action.kind === 'runHandler') <==> (state.phase === 'awaitingGate' && event.kind === 'gateRan')
  //@ ensures state.phase !== 'settled' && \result.state.phase === 'settled' && \result.state.outcome === 'rejected' ==> \result.state.failedGate >= 0
  //@ ensures state.phase == 'admitting' && event.kind === 'gateFailed' ==> \result.state.outcome === 'rejected'
  //@ ensures state.phase == 'admitting' && event.kind === 'gateFailed' ==> \result.state.failedGate === state.gate
  //@ ensures state.phase !== 'settled' && \result.state.phase === 'settled' && \result.state.outcome !== 'rejected' ==> \result.state.failedGate === -1
  if (state.phase === 'settled') {
    return {state, action: {kind: 'idle'}};
  }

  if (event.kind === 'aborted') {
    if (state.phase === 'executing') {
      return {state: {phase: 'settled', outcome: 'cancelledDuring', failedGate: -1}, action: {kind: 'settle'}};
    }
    return {state: {phase: 'settled', outcome: 'cancelledBefore', failedGate: -1}, action: {kind: 'settle'}};
  }

  if (state.phase === 'admitting') {
    if (event.kind === 'gateFailed') {
      return {state: {phase: 'settled', outcome: 'rejected', failedGate: state.gate}, action: {kind: 'settle'}};
    }
    if (event.kind === 'gatePassed') {
      if (state.gate === 3) {
        return {state: {phase: 'awaitingGate'}, action: {kind: 'openGate'}};
      }
      return {state: {phase: 'admitting', gate: state.gate + 1}, action: {kind: 'evaluateGate', gate: state.gate + 1}};
    }
    return {state, action: {kind: 'idle'}};
  }

  if (state.phase === 'awaitingGate') {
    if (event.kind === 'gateRan') {
      return {state: {phase: 'executing'}, action: {kind: 'runHandler'}};
    }
    return {state, action: {kind: 'idle'}};
  }

  if (event.kind === 'hostEmitted') {
    return {state: {phase: 'settled', outcome: 'ok', failedGate: -1}, action: {kind: 'settle'}};
  }
  if (event.kind === 'handlerFulfilled') {
    if (event.resultValid) {
      return {state: {phase: 'settled', outcome: 'ok', failedGate: -1}, action: {kind: 'settle'}};
    }
    return {state: {phase: 'settled', outcome: 'failedResult', failedGate: -1}, action: {kind: 'settle'}};
  }
  if (event.kind === 'handlerRejected') {
    if (event.isAbortReason) {
      return {state: {phase: 'settled', outcome: 'cancelledDuring', failedGate: -1}, action: {kind: 'settle'}};
    }
    return {state: {phase: 'settled', outcome: 'failedHandler', failedGate: -1}, action: {kind: 'settle'}};
  }
  return {state, action: {kind: 'idle'}};
}

/**
 * Reports how the invocation finished, or `pending` while it is still running.
 *
 * The settlement property in `invocation-machine.dfy` uses this as its oracle:
 * the interpreter's resolved result must agree with the folded trace.
 */
export function outcomeOf(state: MachineState): ReportedOutcome {
  //@ verify
  //@ ensures state.phase === 'settled' <==> \result !== 'pending'
  //@ ensures state.phase === 'settled' && state.outcome === 'ok' ==> \result === 'ok'
  //@ ensures state.phase === 'settled' && state.outcome === 'rejected' ==> \result === 'rejected'
  //@ ensures state.phase === 'settled' && state.outcome === 'failedHandler' ==> \result === 'failedHandler'
  //@ ensures state.phase === 'settled' && state.outcome === 'failedResult' ==> \result === 'failedResult'
  //@ ensures state.phase === 'settled' && state.outcome === 'cancelledBefore' ==> \result === 'cancelledBefore'
  //@ ensures state.phase === 'settled' && state.outcome === 'cancelledDuring' ==> \result === 'cancelledDuring'
  if (state.phase !== 'settled') {
    return 'pending';
  }
  if (state.outcome === 'ok') {
    return 'ok';
  }
  if (state.outcome === 'rejected') {
    return 'rejected';
  }
  if (state.outcome === 'failedHandler') {
    return 'failedHandler';
  }
  if (state.outcome === 'failedResult') {
    return 'failedResult';
  }
  if (state.outcome === 'cancelledBefore') {
    return 'cancelledBefore';
  }
  return 'cancelledDuring';
}
