/** @file Keymap arbitraries shared by the KB-COD codec and coverage suites. */
import fc from 'fast-check';

import type {UserKeymaps} from '../../app/config/keybindings-policy';

/**
 * The seed every keybindings property suite reports.
 *
 * A fixed seed keeps failures reproducible while the numeric value is still
 * visible in the transcript, so a shrunk counterexample can be replayed.
 */
export const KEYBINDINGS_PROPERTY_SEED = 20_261_030;

/** Keys that also name members of `Object.prototype`. */
const prototypeNamedCommandId = fc.constantFrom('__proto__', 'constructor', 'toString', 'valueOf');

/** Command ids that JavaScript enumerates before other string keys. */
const integerLikeCommandId = fc.integer({min: 0, max: 99_999}).map((value) => `${value}`);

/**
 * Builds a binary string with non-whitespace bookends.
 *
 * Filtering binary strings for a trimmed value would discard most samples and
 * fail fast-check's density heuristics; adding the bookends is a construction
 * that always yields an admissible id, whatever the generated middle contains.
 */
const bracket = (prefix: string, suffix: string) =>
  fc.string({unit: 'binary'}).map((value) => `${prefix}${value}${suffix}`);

/** A command id with no leading or trailing whitespace. */
export const commandIdArb = fc.oneof(
  {weight: 1, arbitrary: prototypeNamedCommandId},
  {weight: 1, arbitrary: integerLikeCommandId},
  {weight: 4, arbitrary: bracket('command-', '-end')}
);

/** A shortcut that is non-empty and not only whitespace. */
export const shortcutArb = bracket('ctrl+', '+key');

/** A binding: one shortcut string, or an array whose empty form unbinds. */
export const bindingArb = fc.oneof(
  {weight: 2, arbitrary: shortcutArb},
  {weight: 1, arbitrary: fc.constant<string[]>([])},
  {weight: 2, arbitrary: fc.array(shortcutArb, {minLength: 1, maxLength: 3})}
);

/**
 * An admissible keymap.
 *
 * `Object.fromEntries` gives the result its own data properties, including an
 * own `__proto__` when the dictionary draws one, which is the shape the codec
 * has to round-trip without touching the prototype.
 */
export const keymapsArb: fc.Arbitrary<UserKeymaps> = fc
  .dictionary(commandIdArb, bindingArb, {noNullPrototype: true, maxKeys: 5})
  .map((entries) => Object.fromEntries(Object.entries(entries)));

/** A valid document with a random internal corruption. */
export const corruptedValidDocArb = fc.tuple(keymapsArb, fc.nat({max: 4})).map(([keymaps, strategy]) => {
  const entries = Object.entries(keymaps);
  switch (strategy) {
    case 0: {
      return JSON.stringify({...keymaps, corrupted: 42});
    }
    case 1: {
      return JSON.stringify({...keymaps, ' padded ': 'ctrl+n'});
    }
    case 2: {
      return JSON.stringify({...keymaps, corrupted: ['ctrl+n', false]});
    }
    case 3: {
      return JSON.stringify({...keymaps, corrupted: {nested: true}});
    }
    default: {
      return JSON.stringify(Object.fromEntries([...entries, ['', 'ctrl+n']]));
    }
  }
});

/** JSON text for an arbitrary JSON value, including non-object roots. */
const jsonValueDocArb = fc.jsonValue().map((value) => JSON.stringify(value));

/**
 * Documents for KB-COD-2's totality property.
 *
 * Valid documents keep the accepted outcome well represented, corrupted and
 * arbitrary documents supply the rejection classes, and binary strings reach
 * the parser's syntax-error path.
 */
export const textDocArb = fc.oneof(
  {weight: 2, arbitrary: keymapsArb.map((keymaps) => JSON.stringify(keymaps))},
  {weight: 2, arbitrary: corruptedValidDocArb},
  {weight: 1, arbitrary: fc.string({unit: 'binary'})},
  {weight: 1, arbitrary: jsonValueDocArb}
);

/** Whether an object carries an own key drawn from `Object.prototype`. */
export const hasPrototypeNamedKey = (keymaps: UserKeymaps): boolean =>
  Object.hasOwn(keymaps, '__proto__') ||
  Object.hasOwn(keymaps, 'constructor') ||
  Object.hasOwn(keymaps, 'toString') ||
  Object.hasOwn(keymaps, 'valueOf');

/** Whether an object carries an integer-like command id. */
export const hasIntegerLikeKey = (keymaps: UserKeymaps): boolean =>
  Object.keys(keymaps).some((key) => /^\d+$/.test(key));
