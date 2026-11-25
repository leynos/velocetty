/**
 * @file Transition table for the per-field state machine.
 *
 * Each case is one row of the product specification: the phase, the draft,
 * the pending request, and the effect the caller must run.
 */
import {describe, expect, test} from 'bun:test';

import {initialFieldState, stepField, wellFormed, type FieldEvent, type FieldState} from '@shared/settings/field-state';

type State = FieldState<number, string>;
type Event = FieldEvent<number, string>;

const NO_VALUE: number | undefined = undefined;

const fresh = (): State => initialFieldState<number, string>(NO_VALUE, '');
const committed = (value: number): State => initialFieldState<number, string>(value, String(value));

const COERCED: Event = {kind: 'submit', submission: {kind: 'coerced', value: 16}, fallbackError: 'unknown'};
const UNCOERCED: Event = {
  kind: 'submit',
  submission: {kind: 'uncoerced', errors: ['not-a-number']},
  fallbackError: 'unknown'
};
const APPLIED = (requestId: number): Event => ({
  kind: 'outcome',
  requestId,
  result: 'applied',
  errors: [],
  fallbackError: 'unknown'
});
const DENIED = (requestId: number, errors: readonly string[] = ['above-maximum']): Event => ({
  kind: 'outcome',
  requestId,
  result: 'denied',
  errors,
  fallbackError: 'unknown'
});

describe('initialFieldState', () => {
  test('starts idle, clean, and well formed', () => {
    const state = fresh();
    expect(state.phase).toBe('idle');
    expect(state.isDirty).toBe(false);
    expect(state.pendingRequestId).toBe(-1);
    expect(wellFormed(state)).toBe(true);
  });
});

describe('editing', () => {
  test('an edit updates the draft and marks it dirty without an effect', () => {
    const {state, effect} = stepField(fresh(), {kind: 'edit', draft: '16'});
    expect(state.draft).toBe('16');
    expect(state.isDirty).toBe(true);
    expect(state.phase).toBe('idle');
    expect(effect.kind).toBe('none');
    expect(wellFormed(state)).toBe(true);
  });

  test('a revert restores the supplied text and clears dirty', () => {
    const edited = stepField(fresh(), {kind: 'edit', draft: '16'}).state;
    const {state} = stepField(edited, {kind: 'revert', draft: ''});
    expect(state.draft).toBe('');
    expect(state.isDirty).toBe(false);
    expect(state.phase).toBe('idle');
  });

  test('an edit while saving keeps the saving phase and the pending request', () => {
    const saving = stepField(fresh(), COERCED).state;
    const {state} = stepField(saving, {kind: 'edit', draft: '18'});
    expect(state.phase).toBe('saving');
    expect(state.pendingRequestId).toBe(saving.pendingRequestId);
    expect(wellFormed(state)).toBe(true);
  });
});

describe('submitting', () => {
  test('a coerced submission starts saving and emits a write of that value', () => {
    const {state, effect} = stepField(committed(14), COERCED);
    expect(state.phase).toBe('saving');
    expect(state.pendingRequestId).toBe(1);
    expect(state.nextRequestId).toBe(2);
    expect(effect).toEqual({kind: 'write', requestId: 1, value: 16});
    expect(wellFormed(state)).toBe(true);
  });

  test('an uncoerced submission shows the errors and requests nothing', () => {
    const {state, effect} = stepField(committed(14), UNCOERCED);
    expect(state.phase).toBe('invalid');
    expect(state.errors).toEqual(['not-a-number']);
    expect(state.pendingRequestId).toBe(-1);
    expect(effect.kind).toBe('none');
  });

  test('an uncoerced submission with no reasons uses the fallback', () => {
    const event: Event = {kind: 'submit', submission: {kind: 'uncoerced', errors: []}, fallbackError: 'unknown'};
    const {state} = stepField(fresh(), event);
    expect(state.errors).toEqual(['unknown']);
  });

  test('a second submission supersedes the first request id', () => {
    const saving = stepField(fresh(), COERCED).state;
    const second: Event = {kind: 'submit', submission: {kind: 'coerced', value: 18}, fallbackError: 'unknown'};
    const {state, effect} = stepField(saving, second);
    expect(state.pendingRequestId).toBe(2);
    expect(effect).toEqual({kind: 'write', requestId: 2, value: 18});
  });

  test('a locally invalid submission while saving abandons outcome tracking', () => {
    const saving = stepField(fresh(), COERCED).state;
    const {state} = stepField(saving, UNCOERCED);
    expect(state.phase).toBe('invalid');
    expect(state.pendingRequestId).toBe(-1);
    expect(wellFormed(state)).toBe(true);
  });
});

describe('resetting', () => {
  test('a reset starts saving and emits a reset with the new request id', () => {
    const {state, effect} = stepField(committed(14), {kind: 'reset'});
    expect(state.phase).toBe('saving');
    expect(effect).toEqual({kind: 'reset', requestId: 1});
    expect(wellFormed(state)).toBe(true);
  });
});

describe('outcomes', () => {
  test('a stale outcome leaves the state untouched and emits nothing', () => {
    const saving = stepField(fresh(), COERCED).state;
    const {state, effect} = stepField(saving, APPLIED(99));
    expect(state).toEqual(saving);
    expect(effect.kind).toBe('none');
  });

  test('an applied outcome returns the field to idle and clean', () => {
    const saving = stepField(fresh(), COERCED).state;
    const {state} = stepField(saving, APPLIED(1));
    expect(state.phase).toBe('idle');
    expect(state.isDirty).toBe(false);
    expect(state.pendingRequestId).toBe(-1);
    expect(state.errors).toEqual([]);
  });

  test('a denied outcome shows the supplied errors', () => {
    const saving = stepField(fresh(), COERCED).state;
    const {state} = stepField(saving, DENIED(1));
    expect(state.phase).toBe('rejected');
    expect(state.errors).toEqual(['above-maximum']);
    expect(state.pendingRequestId).toBe(-1);
  });

  test('a failure with no reasons uses the fallback', () => {
    const saving = stepField(fresh(), COERCED).state;
    const event: Event = {
      kind: 'outcome',
      requestId: 1,
      result: 'errored',
      errors: [],
      fallbackError: 'io-error'
    };
    const {state} = stepField(saving, event);
    expect(state.phase).toBe('failed');
    expect(state.errors).toEqual(['io-error']);
  });

  test('no saving state survives its own outcome', () => {
    const saving = stepField(fresh(), COERCED).state;
    const results = [APPLIED(1), DENIED(1), {...DENIED(1), result: 'errored' as const}] as const;
    const phases = results.map((event) => stepField(saving, event).state.phase);
    expect(phases).toEqual(['idle', 'rejected', 'failed']);
  });
});

const refresh = (value: number | undefined, draft: string): Event => ({kind: 'refresh', committed: value, draft});

describe('refreshing', () => {
  test('a clean field takes the new committed value and its draft', () => {
    const {state} = stepField(committed(14), refresh(16, '16'));
    expect(state.committed).toBe(16);
    expect(state.draft).toBe('16');
    expect(state.isDirty).toBe(false);
  });

  test('a dirty field keeps its draft but takes the committed value', () => {
    const edited = stepField(committed(14), {kind: 'edit', draft: '22'}).state;
    const {state} = stepField(edited, refresh(16, '16'));
    expect(state.committed).toBe(16);
    expect(state.draft).toBe('22');
  });

  test('a saving field keeps its draft', () => {
    const saving = stepField(committed(14), COERCED).state;
    const {state} = stepField(saving, refresh(16, '16'));
    expect(state.committed).toBe(16);
    expect(state.draft).toBe('14');
    expect(state.phase).toBe('saving');
  });

  test('a refresh can clear a stale error phase', () => {
    const invalid = stepField(committed(14), UNCOERCED).state;
    const {state} = stepField(invalid, refresh(14, '14'));
    expect(state.phase).toBe('idle');
    expect(state.errors).toEqual([]);
  });
});
