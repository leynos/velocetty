/** @file Provides a testable wall-clock adapter for app-side timing reads. */
export interface Clock {
  now(): number;
}

export const clock: Clock = {
  now: (): number => Date.now()
};
