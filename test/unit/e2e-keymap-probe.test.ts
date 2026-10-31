/** @file Precondition for E2E-KB-1 to E2E-KB-4: the probe shortcut is unused. */
import {expect, test} from 'bun:test';

import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

import {E2E_KEYMAP_PROBE, E2E_PROBE_SHORTCUT, formatKeymapsMarker} from '../../app/config/e2e-keymap-probe';
import {isJsonObject, isString} from '../../app/utils/runtime-guards';

const keymapDirectory = path.resolve(import.meta.dir, '../../app/keymaps');

const readBindings = (filePath: string): string[] => {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!isJsonObject(parsed)) {
    throw new TypeError(`Expected ${filePath} to hold a JSON object`);
  }
  const bindings: string[] = [];
  for (const value of Object.values(parsed)) {
    if (isString(value)) {
      bindings.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      bindings.push(...value.filter((entry): entry is string => isString(entry)));
    }
  }
  return bindings;
};

test('the probe shortcut appears in no shipped keymap', () => {
  const keymapFiles = readdirSync(keymapDirectory).filter((name) => name.endsWith('.json'));
  expect(keymapFiles.length).toBeGreaterThan(0);

  for (const keymapFile of keymapFiles) {
    const bindings = readBindings(path.join(keymapDirectory, keymapFile));
    expect(bindings).not.toContain(E2E_PROBE_SHORTCUT);
  }
});

test('the marker names the probe command and its active shortcuts', () => {
  expect(formatKeymapsMarker('applied', {[E2E_KEYMAP_PROBE]: ['ctrl+alt+shift+n']})).toBe(
    '[e2e] keymaps-active status=applied window:new=ctrl+alt+shift+n'
  );
  expect(formatKeymapsMarker('kept', {})).toBe('[e2e] keymaps-active status=kept window:new=');
});
