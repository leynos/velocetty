/**
 * @file Model-based properties for the per-field state machine.
 *
 * The proof covers single transitions. This walks generated event sequences
 * through the real `stepField` and checks the invariants that span several
 * transitions: a fresh field never wedges, a stale outcome never moves it,
 * and a dirty draft is never overwritten by a snapshot refresh.
 */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {
  effectCarriesSubmitted,
  hasResetEffect,
  hasWriteEffect,
  initialFieldState,
  isCurrentOutcome,
  isRefreshEvent,
  isStaleOutcome,
  stepField,
  wellFormed,
  type FieldEvent,
  type FieldState
} from '@shared/settings/field-state';
import {fastCheckRunCount} from '../testUtils/fast-check-runs';

type V = number;
type E = string;
type State = FieldState<V, E>;
type Event = FieldEvent<V, E>;

const NO_VALUE: V | undefined = undefined;

const draftArb = fc.string({maxLength: 8});
const coercedArb = fc.record({kind: fc.constant('coerced' as const), value: fc.integer({min: -50, max: 50})});
const uncoercedArb = fc.record({
  kind: fc.constant('uncoerced' as const),
  errors: fc.array(fc.string(), {maxLength: 2})
});
const submissionArb = fc.oneof(coercedArb, uncoercedArb);
const integerArb = fc.integer({min: -50, max: 50});
const optionalIntegerArb = fc.option(integerArb, {nil: undefined});
const outcomeErrorsArb = fc.array(fc.string(), {maxLength: 2});

const eventArb: fc.Arbitrary<Event> = fc.oneof(
  fc.record({kind: fc.constant('edit' as const), draft: draftArb}),
  fc.record({kind: fc.constant('revert' as const), draft: draftArb}),
  fc.record({kind: fc.constant('submit' as const), submission: submissionArb, fallbackError: fc.constant('unknown')}),
  fc.record({kind: fc.constant('reset' as const)}),
  fc.record({
    kind: fc.constant('outcome' as const),
    requestId: fc.integer({min: -1, max: 6}),
    result: fc.constantFrom('applied' as const, 'denied' as const, 'errored' as const),
    errors: outcomeErrorsArb,
    fallbackError: fc.constant('unknown')
  }),
  fc.record({
    kind: fc.constant('refresh' as const),
    committed: optionalIntegerArb,
    draft: draftArb
  })
);

describe('settings field-state properties', () => {
  test('generated event sequences preserve every machine invariant', () => {
    let runs = 0;
    let runsWithStale = 0;
    let runsWithDirtyRefresh = 0;
    let runsWithError = 0;

    fc.assert(
      fc.property(fc.array(eventArb, {minLength: 1, maxLength: 30}), (events) => {
        runs += 1;
        let hadStale = false;
        let hadDirtyRefresh = false;
        let hadError = false;
        let state: State = initialFieldState<V, E>(NO_VALUE, '');
        for (const event of events) {
          const {state: next, effect} = stepField(state, event);
          expect(wellFormed(next)).toBe(true);
          expect(next.nextRequestId).toBeGreaterThanOrEqual(state.nextRequestId);

          if (isStaleOutcome(event, state.pendingRequestId)) {
            hadStale = true;
            expect(next).toEqual(state);
            expect(effect.kind).toBe('none');
          }
          if (state.phase === 'saving' && isCurrentOutcome(event, state.pendingRequestId)) {
            expect(next.phase).not.toBe('saving');
          }
          if (isRefreshEvent(event) && (state.isDirty || state.pendingRequestId >= 0)) {
            hadDirtyRefresh = true;
            expect(next.draft).toBe(state.draft);
          }
          if (hasWriteEffect(effect)) {
            expect(event.kind).toBe('submit');
            expect(effectCarriesSubmitted(effect, event)).toBe(true);
            expect(effect.requestId).toBe(next.pendingRequestId);
          }
          if (hasResetEffect(effect)) {
            expect(event.kind).toBe('reset');
            expect(effect.requestId).toBe(next.pendingRequestId);
          }
          if (next.phase === 'rejected' || next.phase === 'failed' || next.phase === 'invalid') {
            hadError = true;
          }
          state = next;
        }
        if (hadStale) {
          runsWithStale += 1;
        }
        if (hadDirtyRefresh) {
          runsWithDirtyRefresh += 1;
        }
        if (hadError) {
          runsWithError += 1;
        }
      }),
      {numRuns: fastCheckRunCount()}
    );

    expect(runsWithStale / runs).toBeGreaterThan(0.1);
    expect(runsWithDirtyRefresh / runs).toBeGreaterThan(0.1);
    expect(runsWithError / runs).toBeGreaterThan(0.1);
  });

  test('request ids are never reused after an outcome is delivered', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: 5}), (attempts) => {
        let state: State = initialFieldState<V, E>(NO_VALUE, '');
        const seen = new Set<number>();
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const submitted = stepField(state, {
            kind: 'submit',
            submission: {kind: 'coerced', value: attempt},
            fallbackError: 'unknown'
          });
          expect(hasWriteEffect(submitted.effect)).toBe(true);
          const requestId = submitted.effect.requestId;
          expect(seen.has(requestId)).toBe(false);
          seen.add(requestId);
          state = stepField(submitted.state, {
            kind: 'outcome',
            requestId,
            result: 'applied',
            errors: [],
            fallbackError: 'unknown'
          }).state;
          expect(state.phase).toBe('idle');
        }
      }),
      {numRuns: fastCheckRunCount()}
    );
  });
});
