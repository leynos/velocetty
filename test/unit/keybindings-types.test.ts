/** @file Compile-time contracts for the keybindings types, checked by `bun check:types`. */
import {expect, test} from 'bun:test';

import type {ConfigImportNotify, KeybindingsLoadOutcome, KeybindingsStore} from '../../app/config/keybindings';
import type {UserKeymaps} from '../../app/config/keybindings-policy';
import type {ConfigImportPaths} from '../../app/config/import-sources';

/** A notification sink of the shape the importer and service accept. */
const notify: ConfigImportNotify = (title, body, details) => {
  void title;
  void body;
  void details;
};

/**
 * Statements the runtime never executes; `tsgo` checks them during the build.
 *
 * The `@ts-expect-error` comments fail the type check if the mismatch they
 * describe stops being an error, so a loosened contract is caught here rather
 * than at a call site.
 */
const assertTypeContracts = (): void => {
  const keymaps: UserKeymaps = {'pane:split': ['ctrl+shift+d', 'cmd+d'], 'window:new': 'ctrl+n'};
  void keymaps;
  const applied: KeybindingsLoadOutcome = {keymaps, kind: 'applied', origin: 'seeded-unsaved'};
  void applied;
  // @ts-expect-error a keymap value must be a shortcut string or an array of them
  const numberValue: UserKeymaps = {'window:new': 42};
  void numberValue;
  // @ts-expect-error an applied outcome reports where its keymaps came from
  const withoutOrigin: KeybindingsLoadOutcome = {keymaps, kind: 'applied'};
  void withoutOrigin;
  // @ts-expect-error the importer cannot resolve the keybindings file without its path
  const missingPath: Pick<ConfigImportPaths, 'keybindingsPath'> = {};
  void missingPath;
  void notify;
  const store: KeybindingsStore = {
    location: '/home/ada/.config/Velocetty/keybindings.json5',
    read: () => ({kind: 'missing'}),
    removeStaleTemporaryFiles: () => {},
    write: () => ({kind: 'written'})
  };
  void store;
};

test('the keybindings contracts compile', () => {
  expect(assertTypeContracts).toBeFunction();
});
