/**
 * @file The per-field state machine for editing one setting.
 *
 * One field moves between `idle`, `invalid`, `saving`, `rejected`, and
 * `failed`. `stepField` is pure: it returns the next state plus at most one
 * effect and never performs the effect itself. The store that owns the field
 * runs the effect after applying the state, which is why a React reducer
 * cannot duplicate a write in development StrictMode.
 *
 * `stepField` carries a LemmaScript contract
 * (`shared/src/settings/field-state.dfy`). The transition is the part a
 * sampled test cannot cover: a lost pending id would wedge a field in
 * `saving`, and a stale outcome that overwrote a newer one would silently
 * discard a user's edit.
 *
 * Every union literal and phase literal in the verified core is bound to a
 * typed local first. LemmaScript's Dafny emitter only resolves a literal
 * against its declared type when the value has one; inline literals are
 * emitted as strings or tuples and do not typecheck.
 */

/** The phase one field is in. */
export type FieldPhase = 'idle' | 'invalid' | 'saving' | 'rejected' | 'failed';

/** The outcome the main process reported for a write. */
export type FieldOutcomeResult = 'applied' | 'denied' | 'errored';

/** A coercion result supplied by the caller at submit time. */
export type FieldSubmission<V, E> =
  | {readonly kind: 'coerced'; readonly value: V}
  | {readonly kind: 'uncoerced'; readonly errors: readonly E[]};

/** Everything known about one field. */
export type FieldState<V, E> = {
  readonly phase: FieldPhase;
  readonly committed: V | undefined;
  readonly draft: string;
  readonly isDirty: boolean;
  readonly errors: readonly E[];
  /** The request whose outcome this field still wants, or -1 for none. */
  readonly pendingRequestId: number;
  readonly nextRequestId: number;
};

/** Something the user or the main process did to the field. */
export type FieldEvent<V, E> =
  | {readonly kind: 'edit'; readonly draft: string}
  | {readonly kind: 'revert'; readonly draft: string}
  | {readonly kind: 'submit'; readonly submission: FieldSubmission<V, E>; readonly fallbackError: E}
  | {readonly kind: 'reset'}
  | {
      readonly kind: 'outcome';
      readonly requestId: number;
      readonly result: FieldOutcomeResult;
      readonly errors: readonly E[];
      readonly fallbackError: E;
    }
  | {readonly kind: 'refresh'; readonly committed: V | undefined; readonly draft: string};

/** Work the caller must perform after applying the returned state. */
export type FieldEffect<V> =
  | {readonly kind: 'none'; readonly requestId: number}
  | {readonly kind: 'write'; readonly requestId: number; readonly value: V}
  | {readonly kind: 'reset'; readonly requestId: number};

/** The next state and the single effect to run. */
export type StepResult<V, E> = {
  readonly state: FieldState<V, E>;
  readonly effect: FieldEffect<V>;
};

/**
 * Creates the state for a field that has never been edited.
 *
 * @param committed - The value currently stored, if any.
 * @param draft - The display text for the stored value.
 * @returns A well-formed idle state.
 *
 * @example
 * initialFieldState(14, '14').phase; // 'idle'
 */
export const initialFieldState = <V, E>(committed: V | undefined, draft: string): FieldState<V, E> => ({
  phase: 'idle',
  committed,
  draft,
  isDirty: false,
  errors: [],
  pendingRequestId: -1,
  nextRequestId: 1
});

/**
 * Reports whether a field state satisfies the machine's invariants.
 *
 * A state is well formed when it is saving exactly while a request is
 * pending, the pending request is older than the next one, request ids start
 * at one, and errors are non-empty exactly in an error phase.
 *
 * @param state - The state to check.
 * @returns True when the state satisfies every invariant.
 *
 * @example
 * wellFormed(initialFieldState(14, '14')); // true
 */
export function wellFormed<V, E>(state: FieldState<V, E>): boolean {
  //@ verify
  //@ pure
  const isSaving = state.phase === 'saving';
  const hasPending = state.pendingRequestId >= 0;
  const isErrorPhase = state.phase === 'invalid' || state.phase === 'rejected' || state.phase === 'failed';
  return (
    isSaving === hasPending &&
    state.pendingRequestId < state.nextRequestId &&
    state.nextRequestId >= 1 &&
    state.errors.length > 0 === isErrorPhase
  );
}

/**
 * Maps a write outcome to the phase it leaves the field in.
 *
 * @param result - The outcome reported by the main process.
 * @returns `rejected` for a refusal and `failed` for a transport failure.
 *
 * @example
 * failurePhaseOf('denied'); // 'rejected'
 */
export function failurePhaseOf(result: FieldOutcomeResult): FieldPhase {
  //@ verify
  //@ pure
  if (result === 'denied') {
    const rejectedPhase: FieldPhase = 'rejected';
    return rejectedPhase;
  }
  const failedPhase: FieldPhase = 'failed';
  return failedPhase;
}

/**
 * Maps the current phase to the phase an edit or revert leaves behind.
 *
 * A field that is saving keeps saving: the pending write still owns the
 * committed value until its outcome arrives.
 *
 * @param phase - The current phase.
 * @returns `saving` when the field is saving, otherwise `idle`.
 *
 * @example
 * settledPhase('saving'); // 'saving'
 * settledPhase('rejected'); // 'idle'
 */
export function settledPhase(phase: FieldPhase): FieldPhase {
  //@ verify
  //@ pure
  if (phase === 'saving') {
    const savingPhase: FieldPhase = 'saving';
    return savingPhase;
  }
  const idlePhase: FieldPhase = 'idle';
  return idlePhase;
}

/**
 * Reports whether an event is a refresh.
 *
 * @param event - The event to classify.
 * @returns True for a refresh event.
 *
 * @example
 * isRefreshEvent({kind: 'reset'}); // false
 */
export function isRefreshEvent<V, E>(event: FieldEvent<V, E>): boolean {
  //@ verify
  //@ pure
  return event.kind === 'refresh';
}

/**
 * Reports whether an event is a submit.
 *
 * @param event - The event to classify.
 * @returns True for a submit event.
 *
 * @example
 * isSubmitEvent({kind: 'edit', draft: 'x'}); // false
 */
export function isSubmitEvent<V, E>(event: FieldEvent<V, E>): boolean {
  //@ verify
  //@ pure
  return event.kind === 'submit';
}

/**
 * Reports whether an outcome carries the field's pending request id.
 *
 * @param event - The event to classify.
 * @param pendingRequestId - The id the field is waiting for.
 * @returns True when the event is the outcome for that request.
 *
 * @example
 * isCurrentOutcome({kind: 'reset'}, 1); // false
 */
export function isCurrentOutcome<V, E>(event: FieldEvent<V, E>, pendingRequestId: number): boolean {
  //@ verify
  //@ pure
  if (event.kind === 'outcome') {
    return event.requestId === pendingRequestId;
  }
  return false;
}

/**
 * Reports whether an outcome belongs to an older, abandoned request.
 *
 * @param event - The event to classify.
 * @param pendingRequestId - The id the field is waiting for.
 * @returns True when the event is an outcome for a different request.
 *
 * @example
 * isStaleOutcome({kind: 'reset'}, 1); // false
 */
export function isStaleOutcome<V, E>(event: FieldEvent<V, E>, pendingRequestId: number): boolean {
  //@ verify
  //@ pure
  if (event.kind === 'outcome') {
    return event.requestId !== pendingRequestId;
  }
  return false;
}

/**
 * Reports whether an effect asks for a write.
 *
 * @param effect - The effect to classify.
 * @returns True for a write effect.
 *
 * @example
 * hasWriteEffect({kind: 'none', requestId: -1}); // false
 */
export function hasWriteEffect<V>(effect: FieldEffect<V>): boolean {
  //@ verify
  //@ pure
  return effect.kind === 'write';
}

/**
 * Reports whether an effect asks for a reset.
 *
 * @param effect - The effect to classify.
 * @returns True for a reset effect.
 *
 * @example
 * hasResetEffect({kind: 'none', requestId: -1}); // false
 */
export function hasResetEffect<V>(effect: FieldEffect<V>): boolean {
  //@ verify
  //@ pure
  return effect.kind === 'reset';
}

/**
 * Reads the request id an effect belongs to.
 *
 * @param effect - The effect to inspect.
 * @returns The request id the effect was allocated for.
 *
 * @example
 * effectRequestId({kind: 'none', requestId: -1}); // -1
 */
export function effectRequestId<V>(effect: FieldEffect<V>): number {
  //@ verify
  //@ pure
  return effect.requestId;
}

/**
 * Reports whether an effect writes the value a submit event carried.
 *
 * @param effect - The effect the machine emitted.
 * @param event - The event the machine handled.
 * @returns True when the effect is a write of that submission's value.
 *
 * @example
 * effectCarriesSubmitted({kind: 'none', requestId: -1}, {kind: 'reset'}); // false
 */
export function effectCarriesSubmitted<V, E>(effect: FieldEffect<V>, event: FieldEvent<V, E>): boolean {
  //@ verify
  //@ pure
  //@ type V (==)
  //@ type E (==)
  if (effect.kind !== 'write') {
    return false;
  }
  if (event.kind !== 'submit') {
    return false;
  }
  if (event.submission.kind !== 'coerced') {
    return false;
  }
  return effect.value === event.submission.value;
}

/**
 * Advances one field by one event.
 *
 * A locally invalid submission abandons outcome tracking: the field shows the
 * error, and the pending id is cleared so the machine's saving invariant
 * holds. The write the main process already started still lands; the next
 * snapshot refresh reconciles the committed value.
 *
 * @param state - The current well-formed state.
 * @param event - The event to apply.
 * @returns The next state and the effect to run, if any.
 *
 * @example
 * const state = initialFieldState<number, string>(undefined, '');
 * stepField(state, {kind: 'edit', draft: '16'}).state.draft; // '16'
 *
 * @codescene(disable:"Complex Method", disable:"Large Method") Verified
 * transition: the Dafny contract proves this function as one machine, and
 * splitting its cases would fragment the model the proof names (2026-11-26).
 */
export function stepField<V, E>(state: FieldState<V, E>, event: FieldEvent<V, E>): StepResult<V, E> {
  //@ verify
  //@ type V (==)
  //@ type E (==)
  //@ requires wellFormed(state)
  //@ ensures wellFormed(\result.state)
  //@ ensures \result.state.nextRequestId >= state.nextRequestId
  //@ ensures isStaleOutcome(event, state.pendingRequestId) ==> \result.state === state && \result.effect.kind === 'none'
  //@ ensures state.phase === 'saving' && isCurrentOutcome(event, state.pendingRequestId) ==> \result.state.phase !== 'saving'
  //@ ensures isRefreshEvent(event) && (state.isDirty || state.pendingRequestId >= 0) ==> \result.state.draft === state.draft
  //@ ensures \result.effect.kind === 'write' ==> isSubmitEvent(event)
  //@ ensures \result.effect.kind === 'reset' ==> event.kind === 'reset'
  //@ ensures effectCarriesSubmitted(\result.effect, event) || !hasWriteEffect(\result.effect)
  //@ ensures \result.effect.kind !== 'none' ==> effectRequestId(\result.effect) === \result.state.pendingRequestId
  const noEffect: FieldEffect<V> = {kind: 'none', requestId: -1};
  switch (event.kind) {
    case 'edit': {
      const phase: FieldPhase = settledPhase(state.phase);
      const next: FieldState<V, E> = {...state, phase, draft: event.draft, isDirty: true, errors: []};
      return {state: next, effect: noEffect};
    }
    case 'revert': {
      const phase: FieldPhase = settledPhase(state.phase);
      const next: FieldState<V, E> = {...state, phase, draft: event.draft, isDirty: false, errors: []};
      return {state: next, effect: noEffect};
    }
    case 'submit': {
      const requestId = state.nextRequestId;
      if (event.submission.kind === 'coerced') {
        const phase: FieldPhase = 'saving';
        const next: FieldState<V, E> = {
          ...state,
          phase,
          errors: [],
          isDirty: true,
          pendingRequestId: requestId,
          nextRequestId: requestId + 1
        };
        const effect: FieldEffect<V> = {kind: 'write', requestId, value: event.submission.value};
        return {state: next, effect};
      }
      const phase: FieldPhase = 'invalid';
      const errors: readonly E[] = event.submission.errors.length > 0 ? event.submission.errors : [event.fallbackError];
      const next: FieldState<V, E> = {...state, phase, errors, pendingRequestId: -1};
      return {state: next, effect: noEffect};
    }
    case 'reset': {
      const requestId = state.nextRequestId;
      const phase: FieldPhase = 'saving';
      const next: FieldState<V, E> = {
        ...state,
        phase,
        errors: [],
        pendingRequestId: requestId,
        nextRequestId: requestId + 1
      };
      const effect: FieldEffect<V> = {kind: 'reset', requestId};
      return {state: next, effect};
    }
    case 'outcome': {
      if (event.requestId !== state.pendingRequestId) {
        return {state, effect: noEffect};
      }
      if (event.result === 'applied') {
        const phase: FieldPhase = 'idle';
        const next: FieldState<V, E> = {...state, phase, errors: [], isDirty: false, pendingRequestId: -1};
        return {state: next, effect: noEffect};
      }
      const phase: FieldPhase = failurePhaseOf(event.result);
      const errors: readonly E[] = event.errors.length > 0 ? event.errors : [event.fallbackError];
      const next: FieldState<V, E> = {...state, phase, errors, pendingRequestId: -1};
      return {state: next, effect: noEffect};
    }
    case 'refresh': {
      if (state.isDirty || state.pendingRequestId >= 0) {
        const next: FieldState<V, E> = {...state, committed: event.committed};
        return {state: next, effect: noEffect};
      }
      const phase: FieldPhase = 'idle';
      const next: FieldState<V, E> = {
        ...state,
        committed: event.committed,
        draft: event.draft,
        phase,
        errors: []
      };
      return {state: next, effect: noEffect};
    }
  }
}
