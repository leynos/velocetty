/**
 * @file Convergence property: after a sequence of edits, the file holds the
 * last value the user submitted, whatever order the outcomes arrive in.
 *
 * The real settings service and the real config writer run over an in-memory
 * file. The gateway issues writes in submission order — the order Electron's
 * IPC preserves — but delivers their outcomes in a generated order. The store
 * must ignore every stale outcome and settle on the file's final value.
 */
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';

import {fastCheckRunCount} from '../testUtils/fast-check-runs';
import {
  applyActions,
  createHarness,
  expectSettled,
  flushInOrder,
  FONT_SIZE,
  SHELL,
  type Action,
  type ExternalOp,
  type FlushOp
} from '../testUtils/settings-convergence-model';

const fieldArbitrary = fc.constantFrom(FONT_SIZE, SHELL);
const validDraftArbitrary = fc.integer({min: 6, max: 100}).map(String);
const draftArbitrary = fc.oneof(validDraftArbitrary, fc.constantFrom('abc', '', '-3'));
const submitArbitrary = fc.record({
  kind: fc.constant('submit' as const),
  field: fieldArbitrary,
  draft: draftArbitrary
});
const resetArbitrary = fc.record({kind: fc.constant('reset' as const), field: fieldArbitrary});
const externalArbitrary: fc.Arbitrary<ExternalOp> = fc.record({
  kind: fc.constant('external' as const),
  field: fieldArbitrary,
  draft: validDraftArbitrary
});
const flushArbitrary: fc.Arbitrary<FlushOp> = fc.record({kind: fc.constant('flush' as const)});
const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  submitArbitrary,
  resetArbitrary,
  externalArbitrary,
  flushArbitrary
);

const actionsArbitrary = fc.array(actionArbitrary, {maxLength: 10});
const keysArbitrary = fc.array(fc.integer(), {maxLength: 8});

describe('settings convergence', () => {
  test('the file settles on the last submission after out-of-order outcomes', async () => {
    let runs = 0;
    let reordered = 0;
    let resets = 0;
    let externalRuns = 0;
    let invalidRuns = 0;
    let refusedRuns = 0;
    let resetRuns = 0;
    let serviceFailureRuns = 0;

    await fc.assert(
      fc.asyncProperty(actionsArbitrary, keysArbitrary, async (actions, keys) => {
        runs += 1;
        const harness = createHarness();
        harness.store.refresh(harness.service.getSnapshot());
        const applied = await applyActions(harness, actions);
        resets += applied.resets;
        if (applied.externals > 0) {
          externalRuns += 1;
        }
        if (applied.invalidActions > 0) {
          invalidRuns += 1;
        }
        if (applied.refusedResets > 0) {
          refusedRuns += 1;
        }
        if (applied.resets > 0) {
          resetRuns += 1;
        }
        const wasReordered = await flushInOrder(harness, keys);
        await harness.store.whenIdle();
        if (harness.outcomes.some((outcome) => outcome.kind !== 'applied')) {
          serviceFailureRuns += 1;
        }
        expectSettled(harness, applied);
        if (wasReordered) {
          reordered += 1;
        }
      }),
      {numRuns: fastCheckRunCount()}
    );

    expect(reordered / runs).toBeGreaterThanOrEqual(0.1);
    expect(resets / runs).toBeGreaterThan(0.1);
    expect(externalRuns / runs).toBeGreaterThan(0.1);
    expect(invalidRuns / runs).toBeGreaterThanOrEqual(0.1);
    expect(refusedRuns / runs).toBeGreaterThanOrEqual(0.1);
    expect(resetRuns / runs).toBeGreaterThanOrEqual(0.1);
    expect(serviceFailureRuns / runs).toBeGreaterThanOrEqual(0.1);
  });
});
