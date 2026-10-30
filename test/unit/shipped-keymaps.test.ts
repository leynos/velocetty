/** @file Every shipped keymap is a valid `keybindings.json5` document. */
import {expect, test} from 'bun:test';

import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

import {parseKeybindingsText} from '../../app/config/keybindings-codec';

const keymapDirectory = path.resolve(import.meta.dir, '../../app/keymaps');

test('every shipped keymap parses without diagnostics', () => {
  // The importer parses the platform keymap with the same strict codec as a
  // user file and discards the whole map on one diagnostic. A shipped `""`
  // unbind therefore removed every Windows default shortcut; only the E2E
  // deletion scenario on that platform noticed.
  const keymapFiles = readdirSync(keymapDirectory).filter((name) => name.endsWith('.json'));
  expect(keymapFiles.length).toBeGreaterThan(0);

  for (const keymapFile of keymapFiles) {
    const filePath = path.join(keymapDirectory, keymapFile);
    const outcome = parseKeybindingsText(readFileSync(filePath, 'utf8'), filePath);
    if (outcome.kind !== 'ok') {
      const messages = outcome.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`);
      throw new Error(`${keymapFile} is not valid keybindings JSON5: ${messages.join('; ')}`);
    }
  }
});
