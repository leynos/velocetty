/** @file Small async delay helper for unit tests. */

/** Waits for a given number of milliseconds before resolving. */
export const waitFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
