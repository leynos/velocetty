/** @file KB-COD-2 named examples: parser totality, diagnostics, and canonical text. */
import {describe, expect, test} from 'bun:test';

import type {configValidationDiagnostic} from '@shared/types/config';
import {
  type KeybindingsParseOutcome,
  parseKeybindingsText,
  serializeKeybindings,
  toRawKeymaps
} from '../../app/config/keybindings-codec';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import {isKeymapConfig} from '../../app/config/json5-config';

const SOURCE = '/tmp/keybindings.json5';

const expectOk = (outcome: KeybindingsParseOutcome): UserKeymaps => {
  expect(outcome.kind).toBe('ok');
  if (outcome.kind !== 'ok') {
    throw new Error('Expected an ok outcome.');
  }
  return outcome.keymaps;
};

const expectInvalid = (outcome: KeybindingsParseOutcome): readonly configValidationDiagnostic[] => {
  expect(outcome.kind).toBe('invalid');
  if (outcome.kind !== 'invalid') {
    throw new Error('Expected an invalid outcome.');
  }
  return outcome.diagnostics;
};

const expectActionable = (diagnostics: readonly configValidationDiagnostic[]): void => {
  expect(diagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of diagnostics) {
    expect(diagnostic.path.trim()).not.toBe('');
    expect(diagnostic.message.trim()).not.toBe('');
    expect(diagnostic.suggestedFix.trim()).not.toBe('');
  }
};

const sortedEntries = (keymaps: UserKeymaps) =>
  Object.entries(keymaps).toSorted(([left], [right]) => left.localeCompare(right));

const withEntriesInReverse = (keymaps: UserKeymaps): UserKeymaps =>
  Object.fromEntries(Object.entries(keymaps).toReversed());

describe('parseKeybindingsText accepted documents', () => {
  test('reads JSON5 comments, trailing commas, and quoted ids', () => {
    const keymaps = expectOk(
      parseKeybindingsText(
        `{
          // user overrides
          'window:new': ['ctrl+n',],
          'window:close': 'ctrl+w',
        }`,
        SOURCE
      )
    );

    expect(keymaps).toEqual({'window:new': ['ctrl+n'], 'window:close': 'ctrl+w'});
    expect(isKeymapConfig(keymaps)).toBe(true);
  });

  test('ignores a top-level $schema key', () => {
    const keymaps = expectOk(
      parseKeybindingsText(`{$schema: 'https://velocetty.example/keybindings.schema.json', 'a': 'ctrl+a'}`, SOURCE)
    );

    expect(keymaps).toEqual({a: 'ctrl+a'});
    expect(Object.hasOwn(keymaps, '$schema')).toBe(false);
  });

  test('keeps an empty array, which unbinds the command', () => {
    const keymaps = expectOk(parseKeybindingsText(`{'window:new': []}`, SOURCE));

    expect(keymaps).toEqual({'window:new': []});
  });

  test('treats prototype-named command ids as ordinary own keys', () => {
    const keymaps = expectOk(parseKeybindingsText(`{'__proto__': 'ctrl+p', constructor: 'ctrl+c'}`, SOURCE));

    expect(Object.hasOwn(keymaps, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(keymaps)).toBe(Object.prototype);
    expect(sortedEntries(keymaps)).toEqual([
      ['__proto__', 'ctrl+p'],
      ['constructor', 'ctrl+c']
    ]);
  });
});

describe('parseKeybindingsText rejected documents', () => {
  test.each([
    {label: 'an array root', text: '[]'},
    {label: 'a string root', text: `'text'`},
    {label: 'a number root', text: '42'},
    {label: 'a null root', text: 'null'}
  ])('rejects $label', ({text}) => {
    expectActionable(expectInvalid(parseKeybindingsText(text, SOURCE)));
  });

  test.each([
    {label: 'a number value', text: `{'a': 1}`},
    {label: 'a boolean value', text: `{'a': true}`},
    {label: 'a nested object', text: `{'a': {'b': 'ctrl+b'}}`},
    {label: 'an empty command identifier', text: `{'': 'ctrl+n'}`},
    {label: 'a padded command identifier', text: `{'  ': 'ctrl+n'}`},
    {label: 'a whitespace-only shortcut', text: `{'a': '   '}`},
    {label: 'a whitespace-only array member', text: `{'a': ['ctrl+n', ' ']}`},
    {label: 'a non-string array member', text: `{'a': ['ctrl+n', 1]}`},
    {label: 'an invalid prototype-named entry', text: `{'__proto__': 123}`}
  ])('rejects $label with an actionable diagnostic', ({text}) => {
    expectActionable(expectInvalid(parseKeybindingsText(text, SOURCE)));
  });

  test('reports a syntax error with its source position', () => {
    const [diagnostic] = expectInvalid(parseKeybindingsText(`{'a': 'ctrl+n'`, SOURCE));

    expect(diagnostic?.path).toBe(`${SOURCE}:1:15`);
    expect(diagnostic?.message).toContain('JSON5');
    expect(diagnostic?.suggestedFix).not.toBe('');
  });

  test('returns without throwing for pathologically nested input', () => {
    const outcome = parseKeybindingsText('['.repeat(100_000), SOURCE);

    expectActionable(expectInvalid(outcome));
  });

  test('returns invalid for a balanced deeply nested document', () => {
    // A rooted recursive validation walk exhausted the stack on this input
    // after `JSON5.parse` had already produced the value, escaping as a
    // RangeError instead of an invalid outcome.
    const depth = 20_000;
    const text = `{'a': ${'['.repeat(depth)}${']'.repeat(depth)}}`;

    expectActionable(expectInvalid(parseKeybindingsText(text, SOURCE)));
  });
});

describe('serializeKeybindings canonical text', () => {
  const keymaps: UserKeymaps = {'window:new': ['ctrl+n', 'ctrl+shift+n'], 'window:close': 'ctrl+w', 'pane:split': []};

  test('writes a header comment followed by sorted, two-space JSON5', () => {
    const text = serializeKeybindings(keymaps);

    expect(text.startsWith('//')).toBe(true);
    expect(text).toContain('\n\n{');
    expect(text.indexOf("'pane:split'")).toBeLessThan(text.indexOf("'window:close'"));
    expect(text.indexOf("'window:close'")).toBeLessThan(text.indexOf("'window:new'"));
    expect(text.endsWith('\n')).toBe(true);
    expect(expectOk(parseKeybindingsText(text, SOURCE))).toEqual(keymaps);
  });

  test('does not depend on insertion order', () => {
    expect(serializeKeybindings(withEntriesInReverse(keymaps))).toBe(serializeKeybindings(keymaps));
  });

  test('round-trips prototype-named keys', () => {
    const prototypeKeymaps: UserKeymaps = {['__proto__']: 'ctrl+p', toString: ['ctrl+t']};
    const text = serializeKeybindings(prototypeKeymaps);
    const parsed = expectOk(parseKeybindingsText(text, SOURCE));

    expect(parsed).toEqual(prototypeKeymaps);
  });
});

describe('toRawKeymaps copying conversion', () => {
  test('copies the map and each binding array', () => {
    const binding = ['ctrl+n', 'ctrl+shift+n'];
    const keymaps: UserKeymaps = {'window:new': binding};
    const raw = toRawKeymaps(keymaps);

    expect(raw).toEqual(keymaps);
    const copied = raw['window:new'];
    expect(Array.isArray(copied)).toBe(true);
    if (Array.isArray(copied)) {
      copied.push('ctrl+m');
    }
    expect(binding).toEqual(['ctrl+n', 'ctrl+shift+n']);
    binding.push('ctrl+alt+n');
    expect(raw['window:new']).toEqual(['ctrl+n', 'ctrl+shift+n', 'ctrl+m']);
  });

  test('copies a prototype-named own key', () => {
    // A computed key is an ordinary property; `__proto__: value` would set the
    // prototype instead.
    const raw = toRawKeymaps({['__proto__']: 'ctrl+p'});

    expect(Object.hasOwn(raw, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
  });
});
