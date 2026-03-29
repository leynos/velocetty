/** @file Unit tests for configuration reloadability classification registry.
 *
 * Verifies that:
 * - All configOptions keys have a reloadability classification
 * - Classifications are consistent (no key in both categories)
 * - Classification helpers work correctly
 */
import {describe, it, expect} from 'bun:test';
import type {configOptions} from '@shared/types/config';
import {
  rootConfigReloadability,
  profileConfigReloadability,
  keymapReloadability,
  pluginReloadability,
  getReloadability,
  requiresRestart,
  isLiveReloadable,
  getConfigKeys
} from '@shared/constants/config-reloadability';

describe('config-reloadability', () => {
  describe('registry completeness', () => {
    it('should have reloadability entries for all rootConfigOptions keys', () => {
      // These are the keys defined in rootConfigOptions type
      const expectedRootKeys: Array<
        keyof Pick<
          configOptions,
          'autoUpdatePlugins' | 'defaultSSHApp' | 'disableAutoUpdates' | 'updateChannel' | 'useConpty'
        >
      > = ['autoUpdatePlugins', 'defaultSSHApp', 'disableAutoUpdates', 'updateChannel', 'useConpty'];

      for (const key of expectedRootKeys) {
        expect(rootConfigReloadability[key]).toBeDefined();
        expect(rootConfigReloadability[key].classification).toMatch(/^(live|restart)$/);
        expect(rootConfigReloadability[key].rationale.length).toBeGreaterThan(0);
      }
    });

    it('should have reloadability entries for all profileConfigOptions keys', () => {
      // Comprehensive list of profile config keys from the type definition
      const expectedProfileKeys = [
        'backgroundColor',
        'bell',
        'bellSound',
        'bellSoundURL',
        'borderColor',
        'colors',
        'copyOnSelect',
        'css',
        'cursorAccentColor',
        'cursorBlink',
        'cursorColor',
        'cursorShape',
        'disableLigatures',
        'env',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontWeightBold',
        'foregroundColor',
        'imageSupport',
        'letterSpacing',
        'lineHeight',
        'macOptionSelectionMode',
        'modifierKeys',
        'padding',
        'preserveCWD',
        'quickEdit',
        'screenReaderMode',
        'scrollback',
        'selectionColor',
        'shell',
        'shellArgs',
        'showHamburgerMenu',
        'showWindowControls',
        'termCSS',
        'uiFontFamily',
        'webGLRenderer',
        'webGLRendererMaxContexts',
        'webLinksActivationKey',
        'windowSize',
        'workingDirectory'
      ];

      for (const key of expectedProfileKeys) {
        expect(profileConfigReloadability[key]).toBeDefined();
        expect(profileConfigReloadability[key].classification).toMatch(/^(live|restart)$/);
        expect(profileConfigReloadability[key].rationale.length).toBeGreaterThan(0);
      }
    });

    it('should have reloadability entries for plugin configuration keys', () => {
      const expectedPluginKeys = ['plugins', 'localPlugins'];

      for (const key of expectedPluginKeys) {
        expect(pluginReloadability[key]).toBeDefined();
        expect(pluginReloadability[key].classification).toMatch(/^(live|restart)$/);
        expect(pluginReloadability[key].rationale.length).toBeGreaterThan(0);
      }
    });

    it('should have a wildcard entry for keymap configurations', () => {
      expect(keymapReloadability['*']).toBeDefined();
      expect(keymapReloadability['*'].classification).toBe('live');
    });
  });

  describe('classification consistency', () => {
    it('should not have overlapping keys between registries', () => {
      const rootKeys = new Set(Object.keys(rootConfigReloadability));
      const profileKeys = new Set(Object.keys(profileConfigReloadability));
      const pluginKeys = new Set(Object.keys(pluginReloadability));

      // Check for overlaps between root and profile
      for (const key of rootKeys) {
        expect(profileKeys.has(key)).toBe(false);
      }

      // Check for overlaps between root and plugin
      for (const key of rootKeys) {
        expect(pluginKeys.has(key)).toBe(false);
      }

      // Check for overlaps between profile and plugin
      for (const key of profileKeys) {
        expect(pluginKeys.has(key)).toBe(false);
      }
    });

    it('should have valid classification values only', () => {
      const allEntries = [
        ...Object.values(rootConfigReloadability),
        ...Object.values(profileConfigReloadability),
        ...Object.values(pluginReloadability),
        keymapReloadability['*']
      ];

      for (const entry of allEntries) {
        expect(entry.classification === 'live' || entry.classification === 'restart').toBe(true);
        expect(typeof entry.rationale).toBe('string');
        expect(entry.rationale.length).toBeGreaterThan(10); // Ensure meaningful rationale
      }
    });
  });

  describe('design document alignment', () => {
    it('should classify hot-reloadable settings as live per design document', () => {
      // Theme and UI appearance settings
      expect(profileConfigReloadability.backgroundColor.classification).toBe('live');
      expect(profileConfigReloadability.foregroundColor.classification).toBe('live');
      expect(profileConfigReloadability.borderColor.classification).toBe('live');
      expect(profileConfigReloadability.selectionColor.classification).toBe('live');
      expect(profileConfigReloadability.colors.classification).toBe('live');

      // Font settings
      expect(profileConfigReloadability.fontFamily.classification).toBe('live');
      expect(profileConfigReloadability.fontSize.classification).toBe('live');
      expect(profileConfigReloadability.fontWeight.classification).toBe('live');
      expect(profileConfigReloadability.fontWeightBold.classification).toBe('live');
      expect(profileConfigReloadability.letterSpacing.classification).toBe('live');
      expect(profileConfigReloadability.lineHeight.classification).toBe('live');

      // Keybindings (wildcard)
      expect(keymapReloadability['*'].classification).toBe('live');

      // Tab decoration preferences (mapped to relevant settings)
      expect(profileConfigReloadability.padding.classification).toBe('live');
      expect(profileConfigReloadability.cursorShape.classification).toBe('live');
      expect(profileConfigReloadability.cursorColor.classification).toBe('live');
      expect(profileConfigReloadability.cursorBlink.classification).toBe('live');
    });

    it('should classify restart-required settings as restart per design document', () => {
      // Backend transport settings (listening addresses) - mapped to shell/shellArgs
      expect(profileConfigReloadability.shell.classification).toBe('restart');
      expect(profileConfigReloadability.shellArgs.classification).toBe('restart');

      // Update channel settings
      expect(rootConfigReloadability.updateChannel.classification).toBe('restart');
      expect(rootConfigReloadability.disableAutoUpdates.classification).toBe('restart');
    });

    it('should defer WebGL renderer hot-reload to CONFIG-001', () => {
      expect(profileConfigReloadability.webGLRenderer.classification).toBe('restart');
      expect(profileConfigReloadability.webGLRenderer.rationale).toContain('CONFIG-001');
      expect(profileConfigReloadability.webGLRendererMaxContexts.classification).toBe('restart');
      expect(profileConfigReloadability.webGLRendererMaxContexts.rationale).toContain('CONFIG-001');
    });
  });

  describe('helper functions', () => {
    describe('getReloadability', () => {
      it('should return entry for existing root keys', () => {
        const entry = getReloadability('updateChannel', 'root');
        expect(entry).toBeDefined();
        expect(entry?.classification).toBe('restart');
      });

      it('should return entry for existing profile keys', () => {
        const entry = getReloadability('fontSize', 'profile');
        expect(entry).toBeDefined();
        expect(entry?.classification).toBe('live');
      });

      it('should return wildcard entry for keymap scope', () => {
        const entry = getReloadability('anyKeymap', 'keymap');
        expect(entry).toBeDefined();
        expect(entry?.classification).toBe('live');
      });

      it('should return undefined for unknown keys', () => {
        const entry = getReloadability('unknownKey', 'root');
        expect(entry).toBeUndefined();
      });
    });

    describe('requiresRestart', () => {
      it('should return true for restart-classified settings', () => {
        expect(requiresRestart('updateChannel', 'root')).toBe(true);
        expect(requiresRestart('shell', 'profile')).toBe(true);
        expect(requiresRestart('env', 'profile')).toBe(true);
      });

      it('should return false for live-classified settings', () => {
        expect(requiresRestart('fontSize', 'profile')).toBe(false);
        expect(requiresRestart('backgroundColor', 'profile')).toBe(false);
        expect(requiresRestart('keymapEntry', 'keymap')).toBe(false);
      });

      it('should return true for unknown keys (safe default)', () => {
        expect(requiresRestart('unknownKey', 'root')).toBe(true);
        expect(requiresRestart('unknownKey', 'profile')).toBe(true);
      });
    });

    describe('isLiveReloadable', () => {
      it('should return true for live-classified settings', () => {
        expect(isLiveReloadable('fontSize', 'profile')).toBe(true);
        expect(isLiveReloadable('backgroundColor', 'profile')).toBe(true);
        expect(isLiveReloadable('anyKeymap', 'keymap')).toBe(true);
      });

      it('should return false for restart-classified settings', () => {
        expect(isLiveReloadable('updateChannel', 'root')).toBe(false);
        expect(isLiveReloadable('shell', 'profile')).toBe(false);
        expect(isLiveReloadable('webGLRenderer', 'profile')).toBe(false);
      });

      it('should return false for unknown keys (safe default)', () => {
        expect(isLiveReloadable('unknownKey', 'root')).toBe(false);
        expect(isLiveReloadable('unknownKey', 'profile')).toBe(false);
      });
    });

    describe('getConfigKeys', () => {
      it('should return all root config keys', () => {
        const keys = getConfigKeys('root');
        expect(keys).toContain('updateChannel');
        expect(keys).toContain('autoUpdatePlugins');
        expect(keys.length).toBeGreaterThan(0);
      });

      it('should return all profile config keys', () => {
        const keys = getConfigKeys('profile');
        expect(keys).toContain('fontSize');
        expect(keys).toContain('backgroundColor');
        expect(keys.length).toBeGreaterThan(30); // Many profile settings
      });

      it('should return wildcard for keymap scope', () => {
        const keys = getConfigKeys('keymap');
        expect(keys).toEqual(['*']);
      });

      it('should return all plugin config keys', () => {
        const keys = getConfigKeys('plugin');
        expect(keys).toContain('plugins');
        expect(keys).toContain('localPlugins');
      });
    });
  });

  describe('rawConfig structure coverage', () => {
    it('should cover all top-level rawConfig keys', () => {
      // rawConfig has: config, plugins, localPlugins, keymaps
      // 'config' is handled via root/profile registries
      // plugins, localPlugins are in pluginReloadability
      // keymaps are in keymapReloadability

      expect(pluginReloadability.plugins).toBeDefined();
      expect(pluginReloadability.localPlugins).toBeDefined();
      expect(keymapReloadability['*']).toBeDefined();
    });
  });
});
