/** @file Parses the shortcut text the end-to-end lane asks the app to press. */
/*
 * Kept separate from the Electron adapter so the spelling rules can be unit
 * tested without a running Electron process: the adapter only knows how to
 * turn a parsed chord into input events.
 */

/** The modifier names Electron's input events accept. */
export type ModifierName = 'alt' | 'control' | 'meta' | 'shift';

/** One parsed chord: the final key plus the modifiers held with it. */
export type ShortcutChord = Readonly<{
  keyCode: string;
  modifiers: readonly ModifierName[];
}>;

/** Maps the chord spellings a user file may use onto Electron's names. */
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

/**
 * Parses a `ctrl+alt+shift+n` style chord into input-event parts.
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
