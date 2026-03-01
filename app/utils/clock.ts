/**
 * @file Central wall-clock adapter for app-side telemetry and scheduling.
 *
 * Responsibilities:
 * - Provide a single time source for modules that need epoch-millisecond reads.
 * - Keep time access replaceable in tests via dependency injection or module
 *   mocks.
 *
 * Invariants:
 * - `now()` returns epoch milliseconds.
 * - `now()` is side-effect free.
 *
 * @remarks
 * Cross-links:
 * - `lib/components/term.tsx` consumes this adapter for runtime telemetry
 *   sampling.
 * - `app/ui/window.ts` consumes this adapter for main-process write timing.
 */
/**
 * Semantic contract for wall-clock providers used by runtime telemetry.
 *
 * @export
 * @remarks
 * Implementations must return epoch milliseconds, remain deterministic under
 * test doubles, and avoid side effects.
 * @example
 * ```ts
 * const fixedClock: Clock = {now: () => 1_700_000_000_000};
 * ```
 */
export interface Clock {
  /**
   * Return the current UNIX epoch timestamp in milliseconds.
   *
   * @returns Epoch timestamp in milliseconds.
   */
  now(): number;
}

/**
 * Default wall-clock implementation backed by `Date.now()`.
 *
 * @export
 * @remarks
 * This default is intentionally simple and can be replaced in tests by mocking
 * the module or injecting an alternative `Clock`.
 * @example
 * ```ts
 * const timestampMs = clock.now();
 * ```
 */
export const clock: Clock = {
  now: (): number => Date.now()
};
