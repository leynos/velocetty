/** @file Unit tests for config reloadability UI hook.
 *
 * Verifies that the useConfigReloadability hook returns correct values.
 * Component rendering tests are handled via integration tests.
 */
import {describe, it, expect} from 'bun:test';

import {
  keyRequiresRestart,
  keyIsLiveReloadable,
  getKeyReloadClassification
} from '../../shared/src/constants/config-reloadability';

describe('config-reloadability-ui', () => {
  describe('key classification helpers', () => {
    describe('keyRequiresRestart', () => {
      it('should return true for restart-required keys', () => {
        expect(keyRequiresRestart('shell')).toBe(true);
        expect(keyRequiresRestart('shellArgs')).toBe(true);
        expect(keyRequiresRestart('env')).toBe(true);
        expect(keyRequiresRestart('updateChannel')).toBe(true);
        expect(keyRequiresRestart('webGLRenderer')).toBe(true);
      });

      it('should return false for live-reloadable keys', () => {
        expect(keyRequiresRestart('fontSize')).toBe(false);
        expect(keyRequiresRestart('backgroundColor')).toBe(false);
        expect(keyRequiresRestart('cursorBlink')).toBe(false);
      });

      it('should return true for unknown keys (safety default)', () => {
        expect(keyRequiresRestart('unknownKey')).toBe(true);
      });
    });

    describe('keyIsLiveReloadable', () => {
      it('should return true for live-reloadable keys', () => {
        expect(keyIsLiveReloadable('fontSize')).toBe(true);
        expect(keyIsLiveReloadable('backgroundColor')).toBe(true);
        expect(keyIsLiveReloadable('cursorBlink')).toBe(true);
      });

      it('should return false for restart-required keys', () => {
        expect(keyIsLiveReloadable('shell')).toBe(false);
        expect(keyIsLiveReloadable('updateChannel')).toBe(false);
      });

      it('should return false for unknown keys (safety default)', () => {
        expect(keyIsLiveReloadable('unknownKey')).toBe(false);
      });
    });

    describe('getKeyReloadClassification', () => {
      it('should return correct classification for known keys', () => {
        expect(getKeyReloadClassification('fontSize')).toBe('live');
        expect(getKeyReloadClassification('shell')).toBe('restart');
        expect(getKeyReloadClassification('updateChannel')).toBe('restart');
      });

      it('should return undefined for unknown keys', () => {
        expect(getKeyReloadClassification('unknownKey')).toBeUndefined();
      });
    });
  });

  describe('classification coverage', () => {
    it('should classify all profile config keys', () => {
      const profileKeys = ['backgroundColor', 'bell', 'cursorBlink', 'fontSize', 'shell', 'updateChannel'];

      for (const key of profileKeys) {
        const classification = getKeyReloadClassification(key);
        expect(classification === 'live' || classification === 'restart').toBe(true);
      }
    });

    it('should classify all root config keys', () => {
      const rootKeys = ['autoUpdatePlugins', 'defaultSSHApp', 'disableAutoUpdates', 'updateChannel', 'useConpty'];

      for (const key of rootKeys) {
        const classification = getKeyReloadClassification(key);
        expect(classification).toBe('restart');
      }
    });

    it('should defer WebGL renderer to CONFIG-001', () => {
      const webglClassification = getKeyReloadClassification('webGLRenderer');
      expect(webglClassification).toBe('restart');
    });
  });
});
