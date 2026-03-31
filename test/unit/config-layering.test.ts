/** @file Unit tests for configuration layering and merge semantics.
 *
 * Verifies that:
 * - Deep merge correctly merges nested objects
 * - Arrays are replaced, not merged
 * - Layer resolution follows correct precedence order
 * - Runtime overrides take precedence over user and defaults
 */
import {describe, it, expect} from 'bun:test';
import type {configOptions} from '@shared/types/config';
import {
  deepMerge,
  mergeLayers,
  resolveConfigLayers,
  extractConfigOptions,
  isConfigLayer,
  createRuntimeOverrideLayer,
  configValueDiffers,
  getChangedKeys,
  type ConfigLayer
} from '../../app/config/layering';

describe('config-layering', () => {
  describe('deepMerge', () => {
    it('should merge simple objects with source taking precedence', () => {
      const target = {a: 1, b: 2};
      const source = {b: 3, c: 4};
      const result = deepMerge(target, source);

      expect(result).toEqual({a: 1, b: 3, c: 4});
    });

    it('should deeply merge nested objects', () => {
      const target = {
        colors: {
          red: '#ff0000',
          blue: '#0000ff'
        },
        fontSize: 12
      };
      const source = {
        colors: {
          green: '#00ff00'
        }
      };
      const result = deepMerge(target, source);

      expect(result).toEqual({
        colors: {
          red: '#ff0000',
          blue: '#0000ff',
          green: '#00ff00'
        },
        fontSize: 12
      });
    });

    it('should replace arrays instead of merging', () => {
      const target = {shellArgs: ['--login', '-i']};
      const source = {shellArgs: ['-l']};
      const result = deepMerge(target, source);

      expect(result.shellArgs).toEqual(['-l']);
      expect(result.shellArgs).not.toEqual(['--login', '-i', '-l']);
    });

    it('should not mutate the target object', () => {
      const target = {a: 1, nested: {b: 2}};
      const source = {nested: {c: 3}};
      const result = deepMerge(target, source);

      expect(target).toEqual({a: 1, nested: {b: 2}});
      expect(result).toEqual({a: 1, nested: {b: 2, c: 3}});
    });

    it('should skip undefined values in source', () => {
      const target = {a: 1, b: 2};
      const source = {b: undefined, c: 3};
      const result = deepMerge(target, source);

      expect(result).toEqual({a: 1, b: 2, c: 3});
    });

    it('should respect maxDepth option', () => {
      const target = {level1: {level2: {level3: {value: 1}}}};
      const source = {level1: {level2: {level3: {value: 2}}}};
      const result = deepMerge(target, source, {maxDepth: 1});

      // At max depth, shallow merge is performed
      expect(result.level1).toEqual({level2: {level3: {value: 2}}});
    });

    it('should handle null values in source', () => {
      const target = {a: 1, b: {c: 2}};
      const source = {b: null};
      const result = deepMerge(target, source as Record<string, unknown>);

      expect(result).toEqual({a: 1, b: null});
    });

    it('should handle deeply nested color palette merge', () => {
      const defaults = {
        colors: {
          black: '#000000',
          red: '#ff0000',
          lightBlue: '#0000ff'
        }
      };
      const userOverrides = {
        colors: {
          red: '#cc0000',
          green: '#00ff00'
        }
      };
      const result = deepMerge(defaults, userOverrides);

      expect(result.colors).toEqual({
        black: '#000000',
        red: '#cc0000', // overridden
        lightBlue: '#0000ff',
        green: '#00ff00' // added
      });
    });
  });

  describe('mergeLayers', () => {
    it('should merge layers in order', () => {
      const layers: ConfigLayer[] = [
        {type: 'defaults', config: {fontSize: 12, backgroundColor: '#000'}},
        {type: 'user', config: {fontSize: 14}}
      ];
      const result = mergeLayers(layers);

      expect(result.fontSize).toBe(14); // user overrides defaults
      expect(result.backgroundColor).toBe('#000'); // defaults preserved
    });

    it('should apply runtime overrides over user config', () => {
      const layers: ConfigLayer[] = [
        {type: 'defaults', config: {fontSize: 12, cursorBlink: false}},
        {type: 'user', config: {fontSize: 14}},
        {type: 'runtime', config: {cursorBlink: true}}
      ];
      const result = mergeLayers(layers);

      expect(result.fontSize).toBe(14); // from user
      expect(result.cursorBlink).toBe(true); // runtime overrides all
    });

    it('should handle empty layers array', () => {
      const result = mergeLayers([]);
      expect(result).toEqual({});
    });

    it('should deeply merge across multiple layers', () => {
      const layers: ConfigLayer[] = [
        {type: 'defaults', config: {colors: {red: '#ff0000', blue: '#0000ff'}}},
        {type: 'user', config: {colors: {green: '#00ff00'}}},
        {type: 'runtime', config: {colors: {blue: '#000099'}}} // override blue
      ];
      const result = mergeLayers(layers);

      expect(result.colors).toEqual({
        red: '#ff0000',
        blue: '#000099', // runtime override
        green: '#00ff00' // user addition
      });
    });
  });

  describe('resolveConfigLayers', () => {
    it('should resolve defaults → user → runtime in correct order', () => {
      const defaults = {fontSize: 12, backgroundColor: '#000'} as configOptions;
      const userConfig = {fontSize: 14};
      const runtimeOverrides = {backgroundColor: '#fff'};

      const result = resolveConfigLayers(defaults, userConfig, runtimeOverrides);

      expect(result.fontSize).toBe(14); // user overrides defaults
      expect(result.backgroundColor).toBe('#fff'); // runtime overrides all
    });

    it('should work without runtime overrides', () => {
      const defaults = {fontSize: 12} as configOptions;
      const userConfig = {fontSize: 14};

      const result = resolveConfigLayers(defaults, userConfig);

      expect(result.fontSize).toBe(14);
    });

    it('should handle empty user config', () => {
      const defaults = {fontSize: 12, backgroundColor: '#000'} as configOptions;
      const userConfig = {};

      const result = resolveConfigLayers(defaults, userConfig);

      expect(result.fontSize).toBe(12);
      expect(result.backgroundColor).toBe('#000');
    });
  });

  describe('extractConfigOptions', () => {
    it('should extract config from rawConfig', () => {
      const raw = {
        config: {fontSize: 14, backgroundColor: '#000'},
        plugins: ['hyper-some-plugin'],
        localPlugins: [],
        keymaps: {}
      };
      const result = extractConfigOptions(raw);

      expect(result).toEqual({fontSize: 14, backgroundColor: '#000'});
    });

    it('should return null when config is missing', () => {
      const raw = {
        plugins: [],
        localPlugins: [],
        keymaps: {}
      };
      const result = extractConfigOptions(raw);

      expect(result).toBeNull();
    });

    it('should return null for undefined config', () => {
      const raw = {
        plugins: [],
        localPlugins: [],
        keymaps: {},
        config: undefined
      };
      const result = extractConfigOptions(raw);

      expect(result).toBeNull();
    });
  });

  describe('isConfigLayer', () => {
    it('should return true for valid ConfigLayer', () => {
      const layer = {type: 'user', config: {fontSize: 14}};
      expect(isConfigLayer(layer)).toBe(true);
    });

    it('should return true for all valid layer types', () => {
      expect(isConfigLayer({type: 'defaults', config: {}})).toBe(true);
      expect(isConfigLayer({type: 'user', config: {}})).toBe(true);
      expect(isConfigLayer({type: 'workspace', config: {}})).toBe(true);
      expect(isConfigLayer({type: 'runtime', config: {}})).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isConfigLayer(null)).toBe(false);
      expect(isConfigLayer(undefined)).toBe(false);
      expect(isConfigLayer('string')).toBe(false);
      expect(isConfigLayer(123)).toBe(false);
    });

    it('should return false for invalid type', () => {
      expect(isConfigLayer({type: 'invalid', config: {}})).toBe(false);
    });

    it('should return false for non-object config', () => {
      expect(isConfigLayer({type: 'user', config: 'not-an-object'})).toBe(false);
    });

    it('should return false for missing properties', () => {
      expect(isConfigLayer({type: 'user'})).toBe(false);
      expect(isConfigLayer({config: {}})).toBe(false);
    });
  });

  describe('createRuntimeOverrideLayer', () => {
    it('should create a runtime layer with the given overrides', () => {
      const overrides = {fontSize: 16, cursorBlink: true};
      const layer = createRuntimeOverrideLayer(overrides as Partial<configOptions>);

      expect(layer.type).toBe('runtime');
      expect(layer.config).toEqual(overrides);
    });

    it('should create independent layer objects', () => {
      const overrides = {fontSize: 16};
      const layer = createRuntimeOverrideLayer(overrides as Partial<configOptions>);

      // Modify original
      overrides.fontSize = 20;

      // Layer should still have original value
      expect(layer.config.fontSize).toBe(16);
    });
  });

  describe('configValueDiffers', () => {
    it('should return false for identical values', () => {
      const obj = {a: 1, b: 'test'};
      expect(configValueDiffers(obj, obj, 'a')).toBe(false);
      expect(configValueDiffers({a: 1}, {a: 1}, 'a')).toBe(false);
    });

    it('should return true for different primitive values', () => {
      expect(configValueDiffers({a: 1}, {a: 2}, 'a')).toBe(true);
      expect(configValueDiffers({a: 'foo'}, {a: 'bar'}, 'a')).toBe(true);
    });

    it('should return true when key is missing in one object', () => {
      expect(configValueDiffers({a: 1}, {b: 2}, 'a')).toBe(true);
      expect(configValueDiffers({a: 1}, {b: 2}, 'b')).toBe(true);
    });

    it('should return false when both values are undefined', () => {
      expect(configValueDiffers({}, {}, 'a')).toBe(false);
    });

    it('should deeply compare objects', () => {
      const left = {colors: {red: '#ff0000'}};
      const right = {colors: {red: '#ff0000'}};
      const different = {colors: {red: '#cc0000'}};

      expect(configValueDiffers(left, right, 'colors')).toBe(false);
      expect(configValueDiffers(left, different, 'colors')).toBe(true);
    });

    it('should detect nested object differences', () => {
      const left = {nested: {a: 1, b: 2}};
      const right = {nested: {a: 1, b: 3}};

      expect(configValueDiffers(left, right, 'nested')).toBe(true);
    });

    it('should detect different key counts in nested objects', () => {
      const left = {nested: {a: 1}};
      const right = {nested: {a: 1, b: 2}};

      expect(configValueDiffers(left, right, 'nested')).toBe(true);
    });

    it('should compare arrays by value, not reference', () => {
      const left = {arr: [1, 2, 3]};
      const right = {arr: [1, 2, 3]};

      // Arrays with same values should be equal (compared by value)
      expect(configValueDiffers(left, right, 'arr')).toBe(false);
      expect(configValueDiffers(left, left, 'arr')).toBe(false);

      // Different array values should be detected
      const different = {arr: [1, 2, 4]};
      expect(configValueDiffers(left, different, 'arr')).toBe(true);

      // Different lengths should be detected
      const shorter = {arr: [1, 2]};
      expect(configValueDiffers(left, shorter, 'arr')).toBe(true);
    });

    it('should handle nested arrays in objects', () => {
      const left = {config: {shellArgs: ['--login', '-i']}};
      const right = {config: {shellArgs: ['--login', '-i']}};

      // Nested arrays with same values should be equal
      expect(configValueDiffers(left, right, 'config')).toBe(false);

      // Different nested array values should be detected
      const different = {config: {shellArgs: ['--login']}};
      expect(configValueDiffers(left, different, 'config')).toBe(true);
    });
  });

  describe('getChangedKeys', () => {
    it('should return empty array for identical objects', () => {
      const obj = {a: 1, b: 2};
      expect(getChangedKeys(obj, obj)).toEqual([]);
      expect(getChangedKeys({a: 1}, {a: 1})).toEqual([]);
    });

    it('should detect changed keys', () => {
      const oldConfig = {fontSize: 12, backgroundColor: '#000'};
      const newConfig = {fontSize: 14, backgroundColor: '#000'};

      const changed = getChangedKeys(oldConfig, newConfig);
      expect(changed).toContain('fontSize');
      expect(changed).not.toContain('backgroundColor');
    });

    it('should detect added keys', () => {
      const oldConfig = {fontSize: 12};
      const newConfig = {fontSize: 12, backgroundColor: '#000'};

      const changed = getChangedKeys(oldConfig, newConfig);
      expect(changed).toContain('backgroundColor');
    });

    it('should detect removed keys', () => {
      const oldConfig = {fontSize: 12, backgroundColor: '#000'};
      const newConfig = {fontSize: 12};

      const changed = getChangedKeys(oldConfig, newConfig);
      expect(changed).toContain('backgroundColor');
    });

    it('should detect multiple changes', () => {
      const oldConfig = {a: 1, b: 2, c: 3};
      const newConfig = {a: 10, b: 2, c: 30};

      const changed = getChangedKeys(oldConfig, newConfig);
      expect(changed).toContain('a');
      expect(changed).not.toContain('b');
      expect(changed).toContain('c');
      expect(changed.length).toBe(2);
    });

    it('should handle empty objects', () => {
      expect(getChangedKeys({}, {})).toEqual([]);
      expect(getChangedKeys({}, {a: 1})).toContain('a');
      expect(getChangedKeys({a: 1}, {})).toContain('a');
    });
  });
});
