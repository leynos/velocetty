/** @file Parity between the app-local reloadability registry and the shared one. */
import {describe, expect, test} from 'bun:test';

import {
  getKeyScope as appGetKeyScope,
  getReloadability as appGetReloadability,
  keymapReloadability as appKeymapReloadability,
  pluginReloadability as appPluginReloadability,
  profileConfigReloadability as appProfileConfigReloadability,
  rootConfigReloadability as appRootConfigReloadability
} from '../../app/config/reloadability-registry';
import {
  getKeyScope,
  getReloadability,
  keymapReloadability,
  pluginReloadability,
  profileConfigReloadability,
  rootConfigReloadability
} from '../../shared/src/constants/config-reloadability';
import {CURSOR_STYLE_CONFIG_KEY} from '../../shared/src/types/config';

const registries = [
  ['rootConfigReloadability', appRootConfigReloadability, rootConfigReloadability],
  ['profileConfigReloadability', appProfileConfigReloadability, profileConfigReloadability],
  ['keymapReloadability', appKeymapReloadability, keymapReloadability],
  ['pluginReloadability', appPluginReloadability, pluginReloadability]
] as const;

describe('app reloadability registry parity', () => {
  for (const [name, appRegistry, sharedRegistry] of registries) {
    test(`keeps ${name} identical to the shared registry`, () => {
      // Whole-object comparison catches a key added to one copy, a
      // classification changed in one copy, and a rationale reworded in one
      // copy — the three ways these registries drift.
      expect(appRegistry).toEqual(sharedRegistry);
    });
  }

  test('spells the cursor-style key out as the shared constant', () => {
    // The app-local registry cannot import `CURSOR_STYLE_CONFIG_KEY`: it is a
    // runtime value and `dist/app` has no `@shared/*` resolution, so the key is
    // written literally. This is what fails if the constant ever moves.
    expect(Object.keys(profileConfigReloadability)).toContain('cursorShape');
    expect(CURSOR_STYLE_CONFIG_KEY).toBe('cursorShape');
  });

  test('classifies every key the same way through the lookup helpers', () => {
    const scopes = ['root', 'profile', 'keymap', 'plugin'] as const;
    const keys = [
      ...Object.keys(rootConfigReloadability),
      ...Object.keys(profileConfigReloadability),
      ...Object.keys(keymapReloadability),
      ...Object.keys(pluginReloadability),
      // Not present in any registry, so both copies must fall back identically.
      'no-such-config-key'
    ];

    for (const key of keys) {
      for (const scope of scopes) {
        expect(appGetReloadability(key, scope)).toEqual(getReloadability(key, scope));
      }
    }
  });

  test('detects the same scope for every key', () => {
    for (const key of [...Object.keys(rootConfigReloadability), 'plugins', 'localPlugins', 'keymap', 'fontSize']) {
      expect(appGetKeyScope(key)).toBe(getKeyScope(key));
    }
  });
});
