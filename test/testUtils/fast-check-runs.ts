/**
 * @file Run-count selection for `fast-check` property suites.
 *
 * Property suites run in the shared `make test` gate on four operating
 * systems, so the default run count stays modest. Milestone acceptance runs
 * raise it with `FAST_CHECK_NUM_RUNS=1000` without editing a test.
 */

const DEFAULT_RUN_COUNT = 200;

/**
 * Parses a raw `FAST_CHECK_NUM_RUNS` value.
 *
 * @param raw - The raw environment value, if any.
 * @returns A positive integer, falling back to the default when the value is
 * absent or malformed.
 *
 * @example
 * parseFastCheckRunCount('1000'); // 1000
 * parseFastCheckRunCount('nope'); // 200
 */
export const parseFastCheckRunCount = (raw?: string): number => {
  if (raw === undefined) {
    return DEFAULT_RUN_COUNT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_RUN_COUNT;
  }
  return parsed;
};

/**
 * Reports the configured number of property-test runs.
 *
 * The environment is read on every call so a suite can vary the count
 * without depending on module-initialization order. The optional parameter
 * exists only so tests can exercise the parsing without mutating the
 * process environment that other concurrent suites share.
 *
 * @param raw - The raw value; defaults to `FAST_CHECK_NUM_RUNS`.
 * @returns The configured run count.
 *
 * @example
 * fc.assert(property, {numRuns: fastCheckRunCount()});
 */
export const fastCheckRunCount = (raw: string | undefined = process.env.FAST_CHECK_NUM_RUNS): number =>
  parseFastCheckRunCount(raw);
