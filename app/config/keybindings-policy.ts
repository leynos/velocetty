/** @file Verified keybindings policy: last-known-good replay and start-up seeding. */
/*
 * This module is LemmaScript-verified. Keep it pure: it must not import
 * Electron, touch the filesystem, or read the clock. The contracts below are
 * the specification, and `LemmaScript-files.txt` makes `make prove` verify them.
 */

/** User keybindings, opaque to the proof. */
export interface UserKeymaps {
  readonly [command: string]: string | string[];
}

/** The empty keymap set. */
//@ extern
export function emptyUserKeymaps(): UserKeymaps {
  return {};
}

/** One observation of the keybindings file, or of the start-up decision. */
export type KeybindingsObservation =
  | {readonly kind: 'valid'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'missing'}
  | {readonly kind: 'invalid'}
  | {readonly kind: 'unreadable'};

/** The policy state: the payload of the latest accepted observation. */
export type KeybindingsState = {readonly lastAccepted: UserKeymaps | null};

/** No observation has been accepted yet. */
export const initialKeybindingsState: KeybindingsState = {lastAccepted: null};

/** What applying one observation did. */
export type ObservationResult = {
  readonly state: KeybindingsState;
  readonly status: 'applied' | 'kept';
  readonly usedLastKnownGood: boolean;
};

/**
 * Applies one observation to the policy state.
 *
 * A `valid` or `missing` observation replaces the accepted payload. An
 * `invalid` or `unreadable` observation keeps the prior state and reports
 * whether a last-known-good payload backed the fallback.
 *
 * @param state - The current policy state.
 * @param observation - The observation to apply.
 * @returns The new state and how the observation was handled.
 *
 * @example
 * ```ts
 * observeKeybindings({lastAccepted: null}, {kind: 'valid', keymaps: {'window:new': 'ctrl+n'}});
 * // {state: {lastAccepted: {'window:new': 'ctrl+n'}}, status: 'applied', usedLastKnownGood: false}
 * ```
 */
//@ ensures observation.kind === 'invalid' ==> \result.state.lastAccepted === state.lastAccepted
//@ ensures observation.kind === 'invalid' ==> \result.status === 'kept'
//@ ensures observation.kind === 'unreadable' ==> \result.state.lastAccepted === state.lastAccepted
//@ ensures observation.kind === 'unreadable' ==> \result.status === 'kept'
//@ ensures observation.kind === 'valid' ==> \result.state.lastAccepted === observation.keymaps
//@ ensures observation.kind === 'valid' ==> \result.status === 'applied'
//@ ensures observation.kind === 'missing' ==> \result.state.lastAccepted === emptyUserKeymaps()
//@ ensures observation.kind === 'missing' ==> \result.status === 'applied'
//@ ensures observeKeybindings(\result.state, observation).state.lastAccepted === \result.state.lastAccepted
export function observeKeybindings(state: KeybindingsState, observation: KeybindingsObservation): ObservationResult {
  switch (observation.kind) {
    case 'valid': {
      return {state: {lastAccepted: observation.keymaps}, status: 'applied', usedLastKnownGood: false};
    }
    case 'missing': {
      return {state: {lastAccepted: emptyUserKeymaps()}, status: 'applied', usedLastKnownGood: false};
    }
    default: {
      // `invalid` and `unreadable` both keep the prior state. The flag records
      // whether a last-known-good payload backed that fallback.
      return {state, status: 'kept', usedLastKnownGood: state.lastAccepted !== null};
    }
  }
}

/**
 * Returns the keymaps an application should install.
 *
 * @param state - The current policy state.
 * @returns The accepted payload, or the empty map when nothing is accepted.
 *
 * @example
 * ```ts
 * activeKeymaps({lastAccepted: null}); // {}
 * ```
 */
//@ ensures state.lastAccepted !== null ==> \result === state.lastAccepted
//@ ensures state.lastAccepted === null ==> \result === emptyUserKeymaps()
export function activeKeymaps(state: KeybindingsState): UserKeymaps {
  if (state.lastAccepted !== null) {
    return state.lastAccepted;
  }
  return emptyUserKeymaps();
}

/**
 * The specification: the payload of the latest accepted observation.
 *
 * This is deliberately a separate backward recursion, so the replay theorem
 * relates two independent definitions rather than restating one of them.
 *
 * @param history - The observations to search.
 * @returns The latest accepted payload, or `null` when none was accepted.
 *
 * @example
 * ```ts
 * specLatestAccepted([{kind: 'invalid'}, {kind: 'missing'}]); // {}
 * ```
 */
//@ decreases history.length
export function specLatestAccepted(history: KeybindingsObservation[]): UserKeymaps | null {
  if (history.length === 0) {
    return null;
  }
  const lastIndex = history.length - 1;
  const last = history[lastIndex];
  // oxlint does not model `noUncheckedIndexedAccess`, so it reads this indexed
  // value as always defined. tsgo needs the guard, and LemmaScript needs its
  // truthiness form to emit the branch as unreachable in Dafny.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (!last) {
    return null;
  }
  switch (last.kind) {
    case 'valid': {
      return last.keymaps;
    }
    case 'missing': {
      return emptyUserKeymaps();
    }
    default: {
      return specLatestAccepted(history.slice(0, lastIndex));
    }
  }
}

/**
 * Replays an observation history from the initial state.
 *
 * A forward indexed fold, kept structurally distinct from the backward
 * `specLatestAccepted` search that the contract relates it to.
 *
 * @param history - The observations to replay.
 * @returns The state after the last observation.
 *
 * @example
 * ```ts
 * replayKeybindingObservations([{kind: 'valid', keymaps: {'window:new': 'ctrl+n'}}]).lastAccepted;
 * // {'window:new': 'ctrl+n'}
 * ```
 */
//@ ensures \result.lastAccepted === specLatestAccepted(history)
export function replayKeybindingObservations(history: KeybindingsObservation[]): KeybindingsState {
  let state: KeybindingsState = initialKeybindingsState;
  for (let i = 0; i < history.length; i += 1) {
    //@ invariant 0 <= i
    //@ invariant i <= history.length
    //@ invariant state.lastAccepted === specLatestAccepted(history.slice(0, i))
    const observation = history[i];
    // As above, oxlint cannot see the `noUncheckedIndexedAccess` optionality;
    // the loop condition bounds `i`, so tsgo needs the guard only nominally.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!observation) {
      break;
    }
    state = observeKeybindings(state, observation).state;
  }
  return state;
}

/** Whether the keybindings file exists at start-up. */
export type BootstrapFileState = 'present' | 'missing' | 'unreadable';

/** What start-up learned from the legacy keybindings source. */
export type LegacyKeymapsSource =
  | {readonly kind: 'parsed-keymaps'; readonly keymaps: UserKeymaps}
  | {readonly kind: 'parsed-empty'}
  | {readonly kind: 'parsed-invalid'}
  | {readonly kind: 'freshly-created'}
  | {readonly kind: 'fell-back'};

/** What start-up may do to the keybindings file. */
export type BootstrapDecision =
  | {readonly kind: 'write-nothing'}
  | {readonly kind: 'defer'}
  | {readonly kind: 'seed'; readonly keymaps: UserKeymaps};

/** Start-up inputs for {@link decideBootstrap}. */
export interface BootstrapInput {
  readonly file: BootstrapFileState;
  readonly legacy: LegacyKeymapsSource;
}

/** Whether a bootstrap decision seeds the file. */
export function isSeed(decision: BootstrapDecision): boolean {
  return decision.kind === 'seed';
}

/** Whether a bootstrap decision defers until the next reload. */
export function isDefer(decision: BootstrapDecision): boolean {
  return decision.kind === 'defer';
}

/** The keymaps a decision seeds, or the empty map when it seeds nothing. */
export function specSeedKeymaps(decision: BootstrapDecision): UserKeymaps {
  if (decision.kind === 'seed') {
    return decision.keymaps;
  }
  return emptyUserKeymaps();
}

/** The keymaps a legacy source carries, or the empty map when it carries none. */
export function specLegacyKeymaps(legacy: LegacyKeymapsSource): UserKeymaps {
  if (legacy.kind === 'parsed-keymaps') {
    return legacy.keymaps;
  }
  return emptyUserKeymaps();
}

/**
 * Decides what start-up may write.
 *
 * Only a missing file may be seeded. An unreadable file is never overwritten,
 * and a legacy source that failed to parse defers migration to a later run.
 *
 * @param input - The file state and the legacy source.
 * @returns The decision start-up must follow.
 *
 * @example
 * ```ts
 * decideBootstrap({file: 'missing', legacy: {kind: 'parsed-empty'}});
 * // {kind: 'seed', keymaps: {}}
 * ```
 */
//@ ensures input.file !== 'missing' ==> !isSeed(\result)
//@ ensures input.file !== 'missing' ==> !isDefer(\result)
//@ ensures input.file === 'missing' && input.legacy.kind === 'parsed-keymaps' ==> isSeed(\result)
//@ ensures input.file === 'missing' && input.legacy.kind === 'parsed-keymaps' ==> specSeedKeymaps(\result) === specLegacyKeymaps(input.legacy)
//@ ensures input.file === 'missing' && input.legacy.kind === 'parsed-empty' ==> specSeedKeymaps(\result) === emptyUserKeymaps()
//@ ensures input.file === 'missing' && input.legacy.kind === 'freshly-created' ==> specSeedKeymaps(\result) === emptyUserKeymaps()
//@ ensures input.file === 'missing' && input.legacy.kind === 'parsed-invalid' ==> isDefer(\result)
//@ ensures input.file === 'missing' && input.legacy.kind === 'fell-back' ==> isDefer(\result)
export function decideBootstrap(input: BootstrapInput): BootstrapDecision {
  const legacy = input.legacy;
  if (input.file !== 'missing') {
    return {kind: 'write-nothing'};
  }
  switch (legacy.kind) {
    case 'parsed-keymaps': {
      return {kind: 'seed', keymaps: legacy.keymaps};
    }
    case 'parsed-empty': {
      return {kind: 'seed', keymaps: emptyUserKeymaps()};
    }
    case 'freshly-created': {
      return {kind: 'seed', keymaps: emptyUserKeymaps()};
    }
    default: {
      // `parsed-invalid` and `fell-back` defer: a transient legacy parse
      // failure must not seed an empty file that blocks a later migration.
      return {kind: 'defer'};
    }
  }
}

/** Whether a bootstrap observation is `null`, meaning nothing is applied. */
export function isDeferredObservation(observation: KeybindingsObservation | null): boolean {
  return observation === null;
}

/** The keymaps a bootstrap observation carries, or the empty map for `null`. */
export function specObservationKeymaps(observation: KeybindingsObservation | null): UserKeymaps {
  if (observation === null) {
    return emptyUserKeymaps();
  }
  switch (observation.kind) {
    case 'valid': {
      return observation.keymaps;
    }
    default: {
      return emptyUserKeymaps();
    }
  }
}

/**
 * Maps a bootstrap decision and its write result to the observation to apply.
 *
 * `null` means "apply nothing": either the file was not written (so the next
 * load reads it) or the decision deferred.
 *
 * @param decision - The decision taken at start-up.
 * @param write - The outcome of the seed write.
 * @returns The observation to apply, or `null`.
 *
 * @example
 * ```ts
 * bootstrapObservation({kind: 'defer'}, 'not-attempted'); // null
 * ```
 */
//@ ensures decision.kind === 'defer' ==> isDeferredObservation(\result)
//@ ensures decision.kind === 'write-nothing' ==> isDeferredObservation(\result)
//@ ensures decision.kind === 'seed' && write === 'written' ==> !isDeferredObservation(\result)
//@ ensures decision.kind === 'seed' && write === 'written' ==> specObservationKeymaps(\result) === specSeedKeymaps(decision)
//@ ensures decision.kind === 'seed' && write === 'failed' ==> !isDeferredObservation(\result)
//@ ensures decision.kind === 'seed' && write === 'failed' ==> specObservationKeymaps(\result) === specSeedKeymaps(decision)
//@ ensures decision.kind === 'seed' && write === 'not-attempted' ==> isDeferredObservation(\result)
export function bootstrapObservation(
  decision: BootstrapDecision,
  write: 'written' | 'failed' | 'not-attempted'
): KeybindingsObservation | null {
  if (decision.kind === 'defer') {
    return null;
  }
  if (decision.kind === 'write-nothing') {
    return null;
  }
  if (write === 'not-attempted') {
    return null;
  }
  // A failed write still applies the seed in memory; the user is notified
  // separately, and the next reload reads whatever the file contains.
  return {kind: 'valid', keymaps: decision.keymaps};
}
