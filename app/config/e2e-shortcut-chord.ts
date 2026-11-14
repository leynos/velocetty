/** @file Parses the shortcut text the end-to-end lane asks the app to press. */
/*
 * Kept separate from the Electron adapter so the spelling rules can be unit
 * tested without a running Electron process: the adapter only knows how to
 * turn a parsed chord into a key press in the page.
 */

/** The modifier names a user file may spell. */
export type ModifierName = 'alt' | 'control' | 'meta' | 'shift';

/** One parsed chord: the final key plus the modifiers held with it. */
export type ShortcutChord = Readonly<{
  keyCode: string;
  modifiers: readonly ModifierName[];
}>;

/** Maps the chord spellings a user file may use onto the canonical names. */
const modifierNames = new Map<string, ModifierName>([
  ['alt', 'alt'],
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['ctrl', 'control'],
  ['control', 'control'],
  ['meta', 'meta'],
  ['shift', 'shift'],
  ['super', 'meta']
]);

/** One key press in the shape the page's `KeyboardEvent` constructor wants. */
export type KeyPress = Readonly<{
  /** Whether the alt key is held. */
  altKey: boolean;
  /** The physical key, such as `KeyM`. */
  code: string;
  /** Whether the control key is held. */
  ctrlKey: boolean;
  /** The printable key value, such as `m`. */
  key: string;
  /** The legacy key number the page's keyboard library matches on. */
  keyCode: number;
  /** Whether the meta (command or super) key is held. */
  metaKey: boolean;
  /** Whether the shift key is held. */
  shiftKey: boolean;
}>;

const letterKeys = /^[a-z]$/;
const digitKeys = /^[0-9]$/;

/** The numeric code of one key character; every caller passes a single ASCII one. */
const keyNumber = (character: string): number => character.codePointAt(0) ?? 0;

/** The fields that do not depend on the modifiers, for one key. */
const keyFields = (keyName: string): Omit<KeyPress, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> | undefined => {
  if (letterKeys.test(keyName)) {
    const upper = keyName.toUpperCase();
    return {code: `Key${upper}`, key: keyName, keyCode: keyNumber(upper)};
  }
  if (digitKeys.test(keyName)) {
    return {code: `Digit${keyName}`, key: keyName, keyCode: keyNumber(keyName)};
  }
  return undefined;
};

/**
 * Converts a parsed chord into the `KeyboardEvent` fields that press it.
 *
 * Only letter and digit keys are supported: those are what the lane presses,
 * and anything else is reported as unsupported rather than guessed at.
 *
 * @returns The press, or `undefined` when the key has no mapping.
 *
 * @example
 * ```ts
 * toKeyPress({keyCode: 'm', modifiers: ['control', 'alt', 'shift']});
 * // {altKey: true, code: 'KeyM', ctrlKey: true, key: 'm', keyCode: 77,
 * //  metaKey: false, shiftKey: true}
 * ```
 */
export const toKeyPress = (chord: ShortcutChord): KeyPress | undefined => {
  const fields = keyFields(chord.keyCode);
  if (fields === undefined) {
    return undefined;
  }

  const held = new Set(chord.modifiers);
  return {
    ...fields,
    altKey: held.has('alt'),
    ctrlKey: held.has('control'),
    metaKey: held.has('meta'),
    shiftKey: held.has('shift')
  };
};

/**
 * Parses a `ctrl+alt+shift+n` style chord into its parts.
 *
 * A chord needs at least one modifier and a final key. Anything else is
 * rejected rather than guessed at, so a typo cannot silently press a different
 * shortcut than the one the test asked for.
 *
 * @returns The chord, or `undefined` when the text is not a usable chord.
 *
 * @example
 * ```ts
 * parseShortcut('ctrl+alt+shift+n');
 * // {keyCode: 'n', modifiers: ['control', 'alt', 'shift']}
 * parseShortcut('n'); // undefined: no modifier
 * ```
 */
export const parseShortcut = (text: string): ShortcutChord | undefined => {
  const parts = text
    .trim()
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const keyCode = parts.at(-1);
  if (keyCode === undefined || parts.length < 2) {
    return undefined;
  }

  const modifiers: ModifierName[] = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierNames.get(part);
    if (modifier === undefined) {
      return undefined;
    }
    modifiers.push(modifier);
  }

  return {keyCode, modifiers};
};
