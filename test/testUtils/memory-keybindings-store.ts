/** @file In-memory `KeybindingsStore` for the KB-SVC service tests. */
/*
 * The double records every write attempt and can be switched to fail exactly
 * one write. Reads return whatever file state the test last set, so service
 * tests observe the same interface the file adapter provides.
 */
import type {KeybindingsReadOutcome, KeybindingsStore, KeybindingsWriteOutcome} from '../../app/config/keybindings';

export type MemoryKeybindingsStore = KeybindingsStore & {
  /** How many writes were attempted, successful or not. */
  readonly writeAttempts: () => number;
  /** The text of each successful write, in order. */
  readonly writtenTexts: () => readonly string[];
  readonly setText: (text: string) => void;
  readonly setMissing: () => void;
  readonly setUnreadable: (error?: unknown) => void;
  /** Makes the next write fail, then clears the fault. */
  readonly failNextWrite: (error?: unknown) => void;
};

export const createMemoryKeybindingsStore = (location = 'memory-keybindings.json5'): MemoryKeybindingsStore => {
  let file: KeybindingsReadOutcome = {kind: 'missing'};
  let attempts = 0;
  let pendingFailure: {readonly error: unknown} | undefined;
  const written: string[] = [];

  const write = (text: string): KeybindingsWriteOutcome => {
    attempts += 1;
    if (pendingFailure !== undefined) {
      const {error} = pendingFailure;
      pendingFailure = undefined;
      return {kind: 'failed', error};
    }
    written.push(text);
    file = {kind: 'present', text};
    return {kind: 'written'};
  };

  return {
    failNextWrite: (error = new Error('injected write failure')) => {
      pendingFailure = {error};
    },
    location,
    read: () => file,
    setMissing: () => {
      file = {kind: 'missing'};
    },
    setText: (text) => {
      file = {kind: 'present', text};
    },
    setUnreadable: (error = new Error('injected read failure')) => {
      file = {kind: 'unreadable', error};
    },
    write,
    writeAttempts: () => attempts,
    writtenTexts: () => written
  };
};
