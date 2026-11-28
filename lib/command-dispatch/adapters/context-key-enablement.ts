/**
 * @file Enablement adapter over the context-key service.
 *
 * Responsibilities:
 * - Turn a boolean `when` evaluation into an `EnablementVerdict`.
 * - Map an unparsable expression to `invalid`, so the invocation fails closed
 *   with `INVALID_WHEN_EXPRESSION` rather than being treated as enabled.
 *
 * Invariants:
 * - Only a thrown parse error yields `invalid`. A false evaluation is
 *   `disabled`, which reports `COMMAND_DISABLED`, and the two must not be
 *   conflated: one is a definition bug, the other is a working gate.
 *
 * Usage:
 * - `compose.ts` builds one over the renderer's context-key service.
 *
 * Related modules:
 * - `../ports.ts` declares `EnablementEvaluator`.
 * - `../../context-key-service.ts` implements the evaluator this adapts.
 */
import type {EnablementEvaluator, EnablementVerdict} from '../ports';

/** The slice of the context-key service this adapter needs. */
export interface ContextKeyEvaluatorSource {
  /** Throws when the expression cannot be parsed. */
  evaluate(expression: string): boolean;
}

const describeThrown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'The when expression could not be evaluated';

/** Builds the enablement evaluator over a context-key service. */
export const createContextKeyEnablement = (source: ContextKeyEvaluatorSource): EnablementEvaluator => ({
  evaluate: (expression: string): EnablementVerdict => {
    let enabled: boolean;
    try {
      enabled = source.evaluate(expression);
    } catch (error) {
      return {kind: 'invalid', message: describeThrown(error)};
    }
    return enabled ? {kind: 'enabled'} : {kind: 'disabled'};
  }
});
