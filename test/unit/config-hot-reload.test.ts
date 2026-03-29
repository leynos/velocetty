/** @file Unit tests for hot-reload detection and warning system.
 *
 * Verifies that:
 * - Live-reloadable changes are detected and applied immediately
 * - Restart-required changes trigger warning diagnostics
 * - Mixed changes apply live subset and warn on remainder
 * - Classification helpers work correctly
 */
import {describe, it, expect, beforeEach} from 'bun:test';
import type {configOptions, ConfigReloadDiagnostic} from '@shared/types/config';
import {
  classifyConfigChange,
  detectConfigChanges,
  partitionChanges,
  extractLiveConfigChanges,
  createReloadHandler,
  formatRestartWarning,
  keyRequiresRestart,
  keyIsLiveReloadable,
  getKeyReloadClassification
} from '../../app/config/reload-handler';

function makeLiveDiagnostic(path: string): ConfigReloadDiagnostic {
  return {path, message: '', classification: 'live', rationale: ''};
}

describe('config-hot-reload', () => {
  describe('classifyConfigChange', () => {
    it('should classify live-reloadable settings correctly', () => {
      const result = classifyConfigChange('fontSize', 12, 14);

      expect(result.classification).toBe('live');
      expect(result.path).toBe('fontSize');
      expect(result.message).toContain('fontSize');
      expect(result.message).toContain('applied live');
    });

    it('should classify restart-required settings correctly', () => {
      const result = classifyConfigChange('shell', '/bin/bash', '/bin/zsh');

      expect(result.classification).toBe('restart');
      expect(result.path).toBe('shell');
      expect(result.message).toContain('shell');
      expect(result.message).toContain('requires restart');
    });

    it('should classify unknown keys as restart-required for safety', () => {
      const result = classifyConfigChange('unknownKey', 'old', 'new');

      expect(result.classification).toBe('restart');
      expect(result.path).toBe('unknownKey');
      expect(result.rationale).toContain('safety');
    });

    it('should include old and new values in the message', () => {
      const result = classifyConfigChange('backgroundColor', '#000', '#fff');

      expect(result.message).toContain('#000');
      expect(result.message).toContain('#fff');
    });
  });

  describe('detectConfigChanges', () => {
    it('should detect no changes for identical configs', () => {
      const config = {fontSize: 12, backgroundColor: '#000'} as configOptions;
      const result = detectConfigChanges(config, config);

      expect(result).toEqual([]);
    });

    it('should detect single changes', () => {
      const oldConfig = {fontSize: 12, backgroundColor: '#000'} as configOptions;
      const newConfig = {fontSize: 14, backgroundColor: '#000'} as configOptions;

      const result = detectConfigChanges(oldConfig, newConfig);

      expect(result.length).toBe(1);
      expect(result[0].path).toBe('fontSize');
    });

    it('should detect multiple changes', () => {
      const oldConfig = {fontSize: 12, backgroundColor: '#000'} as configOptions;
      const newConfig = {fontSize: 14, backgroundColor: '#fff'} as configOptions;

      const result = detectConfigChanges(oldConfig, newConfig);
      const paths = result.map((r) => r.path);

      expect(result.length).toBe(2);
      expect(paths).toContain('fontSize');
      expect(paths).toContain('backgroundColor');
    });

    it('should correctly classify each detected change', () => {
      const oldConfig = {fontSize: 12, shell: '/bin/bash'} as configOptions;
      const newConfig = {fontSize: 14, shell: '/bin/zsh'} as configOptions;

      const result = detectConfigChanges(oldConfig, newConfig);
      const fontResult = result.find((r) => r.path === 'fontSize');
      const shellResult = result.find((r) => r.path === 'shell');

      expect(fontResult?.classification).toBe('live');
      expect(shellResult?.classification).toBe('restart');
    });

    it('should handle added keys', () => {
      const oldConfig = {fontSize: 12} as configOptions;
      const newConfig = {fontSize: 12, cursorBlink: true} as configOptions;

      const result = detectConfigChanges(oldConfig, newConfig);

      expect(result.length).toBe(1);
      expect(result[0].path).toBe('cursorBlink');
    });

    it('should handle removed keys', () => {
      const oldConfig = {fontSize: 12, cursorBlink: true} as configOptions;
      const newConfig = {fontSize: 12} as configOptions;

      const result = detectConfigChanges(oldConfig, newConfig);

      expect(result.length).toBe(1);
      expect(result[0].path).toBe('cursorBlink');
    });
  });

  describe('partitionChanges', () => {
    it('should partition empty array', () => {
      const result = partitionChanges([]);

      expect(result.liveChanges).toEqual([]);
      expect(result.restartChanges).toEqual([]);
    });

    it('should partition all live changes', () => {
      const diagnostics: ConfigReloadDiagnostic[] = [
        {path: 'fontSize', message: '', classification: 'live', rationale: ''},
        {path: 'backgroundColor', message: '', classification: 'live', rationale: ''}
      ];

      const result = partitionChanges(diagnostics);

      expect(result.liveChanges.length).toBe(2);
      expect(result.restartChanges.length).toBe(0);
    });

    it('should partition all restart changes', () => {
      const diagnostics: ConfigReloadDiagnostic[] = [
        {path: 'shell', message: '', classification: 'restart', rationale: ''},
        {path: 'env', message: '', classification: 'restart', rationale: ''}
      ];

      const result = partitionChanges(diagnostics);

      expect(result.liveChanges.length).toBe(0);
      expect(result.restartChanges.length).toBe(2);
    });

    it('should partition mixed changes correctly', () => {
      const diagnostics: ConfigReloadDiagnostic[] = [
        {path: 'fontSize', message: '', classification: 'live', rationale: ''},
        {path: 'shell', message: '', classification: 'restart', rationale: ''},
        {path: 'backgroundColor', message: '', classification: 'live', rationale: ''}
      ];

      const result = partitionChanges(diagnostics);

      expect(result.liveChanges.length).toBe(2);
      expect(result.restartChanges.length).toBe(1);
      expect(result.liveChanges.map((d) => d.path)).toContain('fontSize');
      expect(result.liveChanges.map((d) => d.path)).toContain('backgroundColor');
      expect(result.restartChanges[0].path).toBe('shell');
    });
  });

  describe('extractLiveConfigChanges', () => {
    it('should extract only live-reloadable changes', () => {
      const oldConfig = {fontSize: 12, shell: '/bin/bash'} as configOptions;
      const newConfig = {fontSize: 14, shell: '/bin/zsh'} as configOptions;

      const result = extractLiveConfigChanges(oldConfig, newConfig, [makeLiveDiagnostic('fontSize')]);

      expect(result.fontSize).toBe(14);
      expect(result.shell).toBeUndefined();
    });

    it('should return empty object when no live changes', () => {
      const oldConfig = {shell: '/bin/bash'} as configOptions;
      const newConfig = {shell: '/bin/zsh'} as configOptions;
      const liveDiagnostics: ConfigReloadDiagnostic[] = [];

      const result = extractLiveConfigChanges(oldConfig, newConfig, liveDiagnostics);

      expect(Object.keys(result).length).toBe(0);
    });

    it('should handle nested config objects', () => {
      const oldConfig = {colors: {red: '#ff0000'}, fontSize: 12} as configOptions;
      const newConfig = {colors: {red: '#cc0000'}, fontSize: 14} as configOptions;

      const result = extractLiveConfigChanges(oldConfig, newConfig, [makeLiveDiagnostic('colors')]);

      expect(result.colors).toEqual({red: '#cc0000'});
      expect(result.fontSize).toBeUndefined();
    });
  });

  describe('createReloadHandler', () => {
    const createMockDependencies = () => ({
      getCurrentConfig: () => ({fontSize: 12, backgroundColor: '#000'}) as configOptions,
      applyLiveConfig: () => {},
      emitRestartWarning: () => {},
      warn: () => {}
    });

    function createShellChangeDeps() {
      const warnings: ConfigReloadDiagnostic[][] = [];
      const deps = {
        ...createMockDependencies(),
        getCurrentConfig: () => ({shell: '/bin/bash'}) as configOptions,
        emitRestartWarning: (diagnostics: ConfigReloadDiagnostic[]) => warnings.push(diagnostics)
      };
      return {deps, warnings};
    }

    it('should return handler functions', () => {
      const handler = createReloadHandler(createMockDependencies());

      expect(typeof handler.processReload).toBe('function');
      expect(typeof handler.clearPendingChanges).toBe('function');
      expect(typeof handler.getState).toBe('function');
      expect(typeof handler.isRestartRequired).toBe('function');
      expect(typeof handler.getPendingRestartDiagnostics).toBe('function');
    });

    it('should apply live changes and return success result', () => {
      const applied: Partial<configOptions>[] = [];
      const deps = {
        ...createMockDependencies(),
        applyLiveConfig: (config: Partial<configOptions>) => applied.push(config)
      };
      const handler = createReloadHandler(deps);

      const newConfig = {fontSize: 14, backgroundColor: '#000'} as configOptions;
      const result = handler.processReload(newConfig);

      expect(result.success).toBe(true);
      expect(result.appliedLive).toContain('fontSize');
      expect(applied.length).toBe(1);
      expect(applied[0].fontSize).toBe(14);
    });

    it('should queue restart-required changes', () => {
      const {deps, warnings} = createShellChangeDeps();
      const handler = createReloadHandler(deps);

      const result = handler.processReload({shell: '/bin/zsh'} as configOptions);

      expect(result.restartRequired.length).toBe(1);
      expect(result.restartRequired[0].path).toBe('shell');
      expect(handler.isRestartRequired()).toBe(true);
      expect(warnings.length).toBe(1);
    });

    it('should handle mixed live and restart changes', () => {
      const deps = {
        ...createMockDependencies(),
        getCurrentConfig: () => ({fontSize: 12, shell: '/bin/bash', backgroundColor: '#000'}) as configOptions
      };
      const handler = createReloadHandler(deps);

      const newConfig = {
        fontSize: 14,
        shell: '/bin/zsh',
        backgroundColor: '#fff'
      } as configOptions;
      const result = handler.processReload(newConfig);

      // Live changes applied
      expect(result.appliedLive).toContain('fontSize');
      expect(result.appliedLive).toContain('backgroundColor');

      // Restart changes queued
      expect(result.restartRequired.length).toBe(1);
      expect(result.restartRequired[0].path).toBe('shell');
    });

    it('should not apply live changes when autoApplyLive is false', () => {
      const applied: Partial<configOptions>[] = [];
      const deps = {
        ...createMockDependencies(),
        applyLiveConfig: (config: Partial<configOptions>) => applied.push(config)
      };
      const handler = createReloadHandler(deps);

      const newConfig = {fontSize: 14, backgroundColor: '#000'} as configOptions;
      handler.processReload(newConfig, {autoApplyLive: false});

      expect(applied.length).toBe(0);
    });

    it('should not emit warnings when emitWarnings is false', () => {
      const {deps, warnings} = createShellChangeDeps();
      const handler = createReloadHandler(deps);

      handler.processReload({shell: '/bin/zsh'} as configOptions, {emitWarnings: false});

      expect(warnings.length).toBe(0);
      expect(handler.isRestartRequired()).toBe(false);
    });

    it('should clear pending changes on clearPendingChanges call', () => {
      const deps = {
        ...createMockDependencies(),
        getCurrentConfig: () => ({shell: '/bin/bash'}) as configOptions
      };
      const handler = createReloadHandler(deps);

      handler.processReload({shell: '/bin/zsh'} as configOptions);
      expect(handler.isRestartRequired()).toBe(true);

      handler.clearPendingChanges();
      expect(handler.isRestartRequired()).toBe(false);
      expect(handler.getPendingRestartDiagnostics().length).toBe(0);
    });

    it('should accumulate pending restart changes across multiple reloads', () => {
      const deps = {
        ...createMockDependencies(),
        getCurrentConfig: () => ({shell: '/bin/bash', updateChannel: 'stable'}) as configOptions
      };
      const handler = createReloadHandler(deps);

      // First reload - change shell
      handler.processReload({shell: '/bin/zsh', updateChannel: 'stable'} as configOptions);
      expect(handler.getPendingRestartDiagnostics().length).toBe(1);
      expect(handler.getPendingRestartDiagnostics()[0].path).toBe('shell');

      // Second reload - change updateChannel (shell change still pending)
      // Note: updateChannel will be detected as changed from original baseline
      handler.processReload({shell: '/bin/zsh', updateChannel: 'canary'} as configOptions);

      // Both changes should be pending
      const pending = handler.getPendingRestartDiagnostics();
      expect(pending.map((d) => d.path)).toContain('shell');
      expect(pending.map((d) => d.path)).toContain('updateChannel');
    });

    it('should return immutable state', () => {
      const handler = createReloadHandler(createMockDependencies());
      const state1 = handler.getState();
      const state2 = handler.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2); // Different object references
    });
  });

  describe('formatRestartWarning', () => {
    it('should return empty string for empty diagnostics', () => {
      const result = formatRestartWarning([]);
      expect(result).toBe('');
    });

    it('should format single diagnostic', () => {
      const diagnostics: ConfigReloadDiagnostic[] = [
        {path: 'shell', message: '', classification: 'restart', rationale: 'Requires new session'}
      ];

      const result = formatRestartWarning(diagnostics);

      expect(result).toContain('Configuration changes require restart');
      expect(result).toContain('shell');
      expect(result).toContain('Requires new session');
      expect(result).toContain('Please restart');
    });

    it('should format multiple diagnostics', () => {
      const diagnostics: ConfigReloadDiagnostic[] = [
        {path: 'shell', message: '', classification: 'restart', rationale: 'Requires new session'},
        {path: 'updateChannel', message: '', classification: 'restart', rationale: 'Affects updates'}
      ];

      const result = formatRestartWarning(diagnostics);

      expect(result).toContain('shell');
      expect(result).toContain('updateChannel');
      expect(result).toContain('Requires new session');
      expect(result).toContain('Affects updates');
    });
  });

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
});
