/** @file KB-PATH-1: exhaustive invariants for Velocetty configuration-tree resolution. */
import {describe, expect, test} from 'bun:test';
import path from 'node:path';

import {resolveConfigLocations} from '../../app/config/config-tree';
import {
  buildConfigTreeCase,
  buildConfigTreeCases,
  type ConfigLocationInput,
  type ConfigTreeCase,
  platformFixture,
  platformPath
} from '../testUtils/config-tree-domain';

type ExpectedConfig = {
  readonly exists: boolean;
  readonly path: string;
  readonly tree: 'development' | 'hyper' | 'velocetty';
};

const configFileName = 'config.json5';
const legacyConfigFileName = 'hyper.json';
const keybindingsFileName = 'keybindings.json5';

/** States the expected active config independently of the implementation. */
const expectedActiveConfig = (testCase: ConfigTreeCase): ExpectedConfig => {
  const paths = platformPath(testCase.platform);
  const development = testCase.developmentEnabled;
  const developmentDirectory = testCase.developmentDirectory;

  if (development && testCase.flags.developmentConfig) {
    return {
      path: paths.join(developmentDirectory, configFileName),
      tree: 'development',
      exists: true
    };
  }

  if (development && testCase.flags.developmentLegacy) {
    return {
      path: paths.join(developmentDirectory, legacyConfigFileName),
      tree: 'development',
      exists: true
    };
  }

  if (testCase.flags.velocettyConfig) {
    return {
      path: paths.join(testCase.velocettyDirectory, configFileName),
      tree: 'velocetty',
      exists: true
    };
  }

  if (testCase.flags.hyperConfig) {
    return {
      path: paths.join(testCase.hyperDirectory, configFileName),
      tree: 'hyper',
      exists: true
    };
  }

  if (testCase.flags.hyperLegacy) {
    return {
      path: paths.join(testCase.hyperDirectory, legacyConfigFileName),
      tree: 'hyper',
      exists: true
    };
  }

  return {
    path: paths.join(testCase.velocettyDirectory, configFileName),
    tree: 'velocetty',
    exists: false
  };
};

/** States the expected keybindings path independently of the implementation. */
const expectedKeybindingsPath = (testCase: ConfigTreeCase, active: ExpectedConfig): string => {
  const paths = platformPath(testCase.platform);
  return active.tree === 'development'
    ? paths.join(testCase.developmentDirectory, keybindingsFileName)
    : paths.join(testCase.velocettyDirectory, keybindingsFileName);
};

/**
 * States the lower-priority `config.json5` files the active one hides.
 *
 * Legacy `hyper.json` files are excluded: the notice names configuration files
 * shadowed by the new tree, and Hyper-to-`hyper.json` fallback is unchanged.
 */
const expectedShadowed = (testCase: ConfigTreeCase, active: ExpectedConfig): string[] => {
  const paths = platformPath(testCase.platform);
  const candidates: string[] = [];

  if (testCase.developmentEnabled && testCase.flags.velocettyConfig) {
    candidates.push(paths.join(testCase.velocettyDirectory, configFileName));
  }

  if (testCase.flags.hyperConfig) {
    candidates.push(paths.join(testCase.hyperDirectory, configFileName));
  }

  return candidates.filter(
    (candidate) => candidate !== active.path && !testCase.input.sameFile(candidate, active.path)
  );
};

const isInside = (platform: NodeJS.Platform, candidate: string, directory: string): boolean => {
  const paths = platformPath(platform);
  const relative = paths.relative(directory, candidate);
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative);
};

const cases = buildConfigTreeCases();

/** Resolves only the Velocetty directory for one platform and XDG state. */
const resolveXdgDirectory = (platform: NodeJS.Platform, xdgState: 'absolute' | 'empty' | 'relative' | 'unset') => {
  const testCase = buildConfigTreeCase(platformFixture(platform), xdgState, false, {
    velocettyConfig: false,
    hyperConfig: false,
    hyperLegacy: false,
    developmentConfig: false,
    developmentLegacy: false
  });
  return resolveConfigLocations(testCase.input).velocettyDirectory;
};

describe('KB-PATH-1 configuration tree resolution', () => {
  test('enumerates exactly 768 cases', () => {
    expect(cases).toHaveLength(768);
  });

  test('holds every invariant over the whole domain', () => {
    const violations: string[] = [];
    const invariantCounts = {
      creation: 0,
      developmentActive: 0,
      hyperCompatibility: 0,
      shadowed: 0
    };

    for (const testCase of cases) {
      const result = resolveConfigLocations(testCase.input);
      const active = expectedActiveConfig(testCase);
      const keybindingsPath = expectedKeybindingsPath(testCase, active);
      const shadowed = expectedShadowed(testCase, active);

      if (result.velocettyDirectory !== testCase.velocettyDirectory) {
        violations.push(`${testCase.label}: velocettyDirectory ${result.velocettyDirectory}`);
      }

      if (
        result.config.path !== active.path ||
        result.config.tree !== active.tree ||
        result.config.exists !== active.exists
      ) {
        violations.push(
          `${testCase.label}: active ${result.config.path} (${result.config.tree}, exists=${result.config.exists}); ` +
            `expected ${active.path} (${active.tree}, exists=${active.exists})`
        );
      }

      if (result.keybindingsPath !== keybindingsPath) {
        violations.push(`${testCase.label}: keybindings ${result.keybindingsPath}; expected ${keybindingsPath}`);
      }

      if (JSON.stringify(result.shadowed) !== JSON.stringify(shadowed)) {
        violations.push(
          `${testCase.label}: shadowed ${JSON.stringify(result.shadowed)}; expected ${JSON.stringify(shadowed)}`
        );
      }

      // Creation: an active path that does not exist is always the Velocetty
      // creation path, so a fresh install never writes under the Hyper name.
      if (!active.exists) {
        invariantCounts.creation += 1;
        if (!isInside(testCase.platform, active.path, testCase.velocettyDirectory)) {
          violations.push(`${testCase.label}: creation path ${active.path} lies outside the Velocetty tree`);
        }
      }

      // Legacy safety: nothing the caller may create lies in the Hyper tree.
      if (isInside(testCase.platform, result.keybindingsPath, testCase.hyperDirectory)) {
        violations.push(`${testCase.label}: keybindings path ${result.keybindingsPath} lies in the Hyper tree`);
      }

      if (active.tree === 'development') {
        invariantCounts.developmentActive += 1;
      }

      // Hyper compatibility: with no Velocetty copy, the legacy oracle decides.
      if (!testCase.flags.velocettyConfig && testCase.oracleExists) {
        invariantCounts.hyperCompatibility += 1;
        if (result.config.path !== testCase.oraclePath || !result.config.exists) {
          violations.push(
            `${testCase.label}: oracle ${testCase.oraclePath}; got ${result.config.path} (exists=${result.config.exists})`
          );
        }
        if (result.config.tree !== 'hyper' && result.config.tree !== 'development') {
          violations.push(`${testCase.label}: oracle case reported tree ${result.config.tree}`);
        }
      }

      if (shadowed.length > 0) {
        invariantCounts.shadowed += 1;
      }
    }

    expect(violations).toEqual([]);

    // Non-vacuity: every antecedent above must hold somewhere, or the
    // corresponding assertion could never fail.
    expect(invariantCounts.creation).toBeGreaterThan(0);
    expect(invariantCounts.developmentActive).toBeGreaterThan(0);
    expect(invariantCounts.shadowed).toBeGreaterThan(0);
    expect(invariantCounts.hyperCompatibility).toBeGreaterThan(0);
  });

  test('holds the Hyper-compatibility antecedent on every platform', () => {
    const platformsWithOracleCases = new Set(
      cases
        .filter((testCase) => !testCase.flags.velocettyConfig && testCase.oracleExists)
        .map((testCase) => testCase.platform)
    );

    expect([...platformsWithOracleCases].toSorted()).toEqual(['darwin', 'linux', 'win32']);
  });

  test('applies the XDG rule to each state on each platform', () => {
    expect(resolveXdgDirectory('linux', 'unset')).toBe('/home/ada/.config/Velocetty');
    expect(resolveXdgDirectory('linux', 'empty')).toBe('/home/ada/.config/Velocetty');
    expect(resolveXdgDirectory('linux', 'relative')).toBe('/home/ada/.config/Velocetty');
    expect(resolveXdgDirectory('linux', 'absolute')).toBe('/xdg/Velocetty');
    expect(resolveXdgDirectory('darwin', 'unset')).toBe('/Users/ada/.config/Velocetty');
    expect(resolveXdgDirectory('darwin', 'absolute')).toBe('/xdg/Velocetty');
    expect(resolveXdgDirectory('win32', 'unset')).toBe(String.raw`C:\Users\ada\AppData\Roaming\Velocetty`);
    expect(resolveXdgDirectory('win32', 'empty')).toBe(String.raw`C:\Users\ada\AppData\Roaming\Velocetty`);
    expect(resolveXdgDirectory('win32', 'relative')).toBe(String.raw`C:\Users\ada\AppData\Roaming\Velocetty`);
    expect(resolveXdgDirectory('win32', 'absolute')).toBe(String.raw`C:\xdg\Velocetty`);
  });

  test('ignores a win32 drive-relative XDG_CONFIG_HOME', () => {
    const fixture = platformFixture('win32');
    const result = resolveConfigLocations({
      platform: 'win32',
      xdgConfigHome: 'C:xdg',
      homeDirectory: fixture.homeDirectory,
      appDataDirectory: fixture.appDataDirectory,
      hyperUserDataDirectory: fixture.hyperUserDataDirectory,
      development: {enabled: false, directory: fixture.developmentDirectory},
      probe: () => 'absent',
      sameFile: () => false
    });

    expect(result.velocettyDirectory).toBe(path.win32.join(fixture.appDataDirectory, 'Velocetty'));
    expect(result.config.exists).toBe(false);
  });

  test('accepts an MSYS-style root-relative XDG_CONFIG_HOME on win32', () => {
    const fixture = platformFixture('win32');
    const result = resolveConfigLocations({
      platform: 'win32',
      xdgConfigHome: '/c/Users/x/.config',
      homeDirectory: fixture.homeDirectory,
      appDataDirectory: fixture.appDataDirectory,
      hyperUserDataDirectory: fixture.hyperUserDataDirectory,
      development: {enabled: false, directory: fixture.developmentDirectory},
      probe: () => 'absent',
      sameFile: () => false
    });

    expect(result.velocettyDirectory).toBe(path.win32.join('/c/Users/x/.config', 'Velocetty'));
  });

  test('does not report a shadowed copy when the Velocetty tree is a symlink to the Hyper tree', () => {
    const fixture = platformFixture('linux');
    const testCase = buildConfigTreeCase(fixture, 'unset', false, {
      velocettyConfig: true,
      hyperConfig: true,
      hyperLegacy: false,
      developmentConfig: false,
      developmentLegacy: false
    });
    const symlinked: ConfigLocationInput = {...testCase.input, sameFile: () => true};

    const result = resolveConfigLocations(symlinked);

    expect(result.config.tree).toBe('velocetty');
    expect(result.shadowed).toEqual([]);
  });

  test('treats a broken Hyper symlink as present and creates nothing', () => {
    const fixture = platformFixture('linux');
    const testCase = buildConfigTreeCase(fixture, 'unset', false, {
      velocettyConfig: false,
      hyperConfig: true,
      hyperLegacy: false,
      developmentConfig: false,
      developmentLegacy: false
    });
    const brokenLink = platformPath('linux').join(testCase.hyperDirectory, configFileName);

    const result = resolveConfigLocations({
      ...testCase.input,
      probe: (candidate) => (candidate === brokenLink ? 'broken-link' : 'absent')
    });

    expect(result.config).toMatchObject({path: brokenLink, tree: 'hyper', exists: true});
    expect(isInside('linux', result.keybindingsPath, testCase.hyperDirectory)).toBe(false);
  });
});
