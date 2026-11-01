/** @file In-memory `KeybindingsStore` for the KB-SVC service tests. */
/*
 * The double records every write attempt and can be switched to fail exactly
 * one write. Reads return whatever file state the test last set, so service
 * tests observe the same interface the file adapter provides.
 */
import type {
  KeybindingsReadOutcome,
  KeybindingsStorageFailure,
  KeybindingsStore,
  KeybindingsWriteOutcome
} from '../../app/config/keybindings-ports';

export type MemoryKeybindingsStore = KeybindingsStore & {
  /** How many writes were attempted, successful or not. */
  readonly writeAttempts: () => number;
  /** The text of each successful write, in order. */
  readonly writtenTexts: () => readonly string[];
  readonly setText: (text: string) => void;
  readonly setMissing: () => void;
  readonly setUnreadable: (failure?: KeybindingsStorageFailure) => void;
  /** Makes the next write fail, then clears the fault. */
  readonly failNextWrite: (failure?: KeybindingsStorageFailure) => void;
};

export const createMemoryKeybindingsStore = (label = 'memory-keybindings.json5'): MemoryKeybindingsStore => {
  let file: KeybindingsReadOutcome = {kind: 'missing'};
  let attempts = 0;
  let pendingFailure: KeybindingsStorageFailure | undefined;
  const written: string[] = [];

  const write = (text: string): KeybindingsWriteOutcome => {
    attempts += 1;
    if (pendingFailure !== undefined) {
      const failure = pendingFailure;
      pendingFailure = undefined;
      return {failure, kind: 'failed'};
    }
    written.push(text);
    file = {kind: 'present', text};
    return {kind: 'written'};
  };

  return {
    failNextWrite: (failure = 'other') => {
      pendingFailure = failure;
    },
    label,
    read: () => file,
    setMissing: () => {
      file = {kind: 'missing'};
    },
    setText: (text) => {
      file = {kind: 'present', text};
    },
    setUnreadable: (failure = 'other') => {
      file = {failure, kind: 'unreadable'};
    },
    write,
    writeAttempts: () => attempts,
    writtenTexts: () => written
  };
};
