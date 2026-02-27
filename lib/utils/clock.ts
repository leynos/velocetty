/** @file Shared wall-clock adapter for renderer and app timing logic. */

/** Shared clock adapter for runtime code that needs current epoch milliseconds. */
export const clock = {
  now: () => Date.now()
};
