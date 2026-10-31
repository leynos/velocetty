/** @file Bounded, fixed-shape counters for configuration and keybindings health. */
/*
 * The counter names are a closed set and carry no free-form labels, so neither
 * a log record nor an exported snapshot can embed a path, a command identifier,
 * or any other user data. The composition root owns the only instance; the
 * modules below it only report events they already recognise.
 */

/** The fixed counter vocabulary. */
export type ConfigCounter = 'attempts' | 'applies' | 'parseFailures' | 'readFailures' | 'fallbacks' | 'retries';

/**
 * Every counter, in the order a record renders them.
 *
 * The order is fixed rather than insertion-dependent, so two records with the
 * same counts are byte-identical and can be compared in a test.
 */
export const CONFIG_COUNTERS: readonly ConfigCounter[] = [
  'attempts',
  'applies',
  'parseFailures',
  'readFailures',
  'fallbacks',
  'retries'
];

/** A point-in-time copy of every counter. */
export type ConfigCounters = Readonly<Record<ConfigCounter, number>>;

/** The counter sink the composition root hands to modules that emit events. */
export type ConfigMetrics = {
  readonly increment: (counter: ConfigCounter) => void;
  /** Returns a copy, so a caller cannot mutate the running tally. */
  readonly snapshot: () => ConfigCounters;
};

/**
 * Renders a snapshot as one bounded, fixed-shape field list.
 *
 * @example
 * ```ts
 * describeConfigCounters(createConfigMetrics().snapshot());
 * // 'attempts:0,applies:0,parseFailures:0,readFailures:0,fallbacks:0,retries:0'
 * ```
 */
export const describeConfigCounters = (counters: ConfigCounters): string =>
  CONFIG_COUNTERS.map((counter) => `${counter}:${counters[counter]}`).join(',');

/**
 * Creates one in-memory tally for the process.
 *
 * Counters are cumulative for the process lifetime: they answer "how often has
 * this happened since start-up", which is what a session log can be read for
 * without a metrics backend.
 *
 * @example
 * ```ts
 * const metrics = createConfigMetrics();
 * metrics.increment('attempts');
 * metrics.snapshot().attempts; // 1
 * ```
 */
export const createConfigMetrics = (): ConfigMetrics => {
  const counts: Record<ConfigCounter, number> = {
    applies: 0,
    attempts: 0,
    fallbacks: 0,
    parseFailures: 0,
    readFailures: 0,
    retries: 0
  };

  return {
    increment: (counter) => {
      counts[counter] += 1;
    },
    snapshot: () => ({...counts})
  };
};
