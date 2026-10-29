/** @file Enumerates the configuration-tree domain shared by the KB-PATH-1 and KB-PATH-2 suites. */
import path from 'node:path';

import {resolveLegacyHyperConfigPath} from './legacy-hyper-paths-oracle';

/** The three `XDG_CONFIG_HOME` shapes KB-PATH-1 enumerates. */
export type XdgState = 'absolute' | 'empty' | 'relative' | 'unset';

/** Which candidate files exist on the simulated filesystem. */
export type ExistenceFlags = {
  readonly velocettyConfig: boolean;
  readonly hyperConfig: boolean;
  readonly hyperLegacy: boolean;
  readonly developmentConfig: boolean;
  readonly developmentLegacy: boolean;
};

/** Input shape accepted by both copies of `resolveConfigLocations`. */
export type ConfigLocationInput = {
  readonly platform: NodeJS.Platform;
  readonly xdgConfigHome: string | undefined;
  readonly homeDirectory: string;
  readonly appDataDirectory: string;
  readonly hyperUserDataDirectory: string;
  readonly development: {readonly enabled: boolean; readonly directory: string};
  readonly probe: (candidate: string) => 'present' | 'broken-link' | 'absent';
  readonly sameFile: (left: string, right: string) => boolean;
};

/** One enumerated case, with the facts the invariants are stated against. */
export type ConfigTreeCase = {
  readonly label: string;
  readonly input: ConfigLocationInput;
  readonly flags: ExistenceFlags;
  readonly developmentEnabled: boolean;
  readonly platform: NodeJS.Platform;
  readonly xdgState: XdgState;
  readonly velocettyDirectory: string;
  readonly hyperDirectory: string;
  readonly developmentDirectory: string;
  readonly presentPaths: ReadonlySet<string>;
  readonly oraclePath: string;
  readonly oracleExists: boolean;
};

type PlatformFixture = {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly appDataDirectory: string;
  readonly hyperUserDataDirectory: string;
  readonly developmentDirectory: string;
  readonly absoluteXdg: string;
};

const platformFixtures: readonly PlatformFixture[] = [
  {
    platform: 'linux',
    homeDirectory: '/home/ada',
    appDataDirectory: '/home/ada/.config',
    hyperUserDataDirectory: '/home/ada/.config/Hyper',
    developmentDirectory: '/repo',
    absoluteXdg: '/xdg'
  },
  {
    platform: 'darwin',
    homeDirectory: '/Users/ada',
    appDataDirectory: '/Users/ada/Library/Application Support',
    hyperUserDataDirectory: '/Users/ada/Library/Application Support/Hyper',
    developmentDirectory: '/repo',
    absoluteXdg: '/xdg'
  },
  {
    platform: 'win32',
    homeDirectory: 'C:\\Users\\ada',
    appDataDirectory: 'C:\\Users\\ada\\AppData\\Roaming',
    hyperUserDataDirectory: 'C:\\Users\\ada\\AppData\\Roaming\\Hyper',
    developmentDirectory: 'C:\\repo',
    absoluteXdg: 'C:\\xdg'
  }
];

const xdgStates: readonly XdgState[] = ['unset', 'empty', 'relative', 'absolute'];

/** Returns the platform-correct path implementation, as both resolvers do. */
export const platformPath = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/** Resolves the `XDG_CONFIG_HOME` value for a state. */
export const xdgValue = (state: XdgState, fixture: PlatformFixture): string | undefined => {
  switch (state) {
    case 'unset': {
      return undefined;
    }
    case 'empty': {
      return '';
    }
    case 'relative': {
      return 'rel';
    }
    default: {
      return fixture.absoluteXdg;
    }
  }
};

/**
 * Computes the Velocetty directory independently of the implementation.
 *
 * This is the XDG Base Directory rule from ADR-008: an absolute, non-empty
 * `XDG_CONFIG_HOME` wins on every platform; otherwise Linux and macOS use
 * `~/.config`, and Windows uses Electron's `appData`.
 */
export const expectedVelocettyDirectory = (fixture: PlatformFixture, xdgConfigHome: string | undefined): string => {
  const paths = platformPath(fixture.platform);
  if (xdgConfigHome && paths.isAbsolute(xdgConfigHome)) {
    return paths.join(xdgConfigHome, 'Velocetty');
  }

  if (fixture.platform === 'win32') {
    return paths.join(fixture.appDataDirectory, 'Velocetty');
  }

  return paths.join(fixture.homeDirectory, '.config', 'Velocetty');
};

/** Computes the Hyper tree exactly as the legacy oracle does. */
const hyperDirectoryFor = (fixture: PlatformFixture, xdgConfigHome: string | undefined): string => {
  const paths = platformPath(fixture.platform);
  if (xdgConfigHome) {
    return paths.join(xdgConfigHome, 'Hyper');
  }

  if (fixture.platform === 'win32') {
    return fixture.hyperUserDataDirectory;
  }

  return paths.join(fixture.homeDirectory, '.config', 'Hyper');
};

const flagsForMask = (mask: number): ExistenceFlags => ({
  velocettyConfig: (mask & 1) !== 0,
  hyperConfig: (mask & 2) !== 0,
  hyperLegacy: (mask & 4) !== 0,
  developmentConfig: (mask & 8) !== 0,
  developmentLegacy: (mask & 16) !== 0
});

const describeFlags = (flags: ExistenceFlags): string =>
  [
    `vel=${Number(flags.velocettyConfig)}`,
    `hyper=${Number(flags.hyperConfig)}`,
    `legacy=${Number(flags.hyperLegacy)}`,
    `dev=${Number(flags.developmentConfig)}`,
    `devLegacy=${Number(flags.developmentLegacy)}`
  ].join(' ');

/**
 * Builds one case from its coordinates.
 *
 * `presentPaths` drives the injected probe, so the same case can be handed to
 * either resolver copy without touching the filesystem.
 */
export const buildConfigTreeCase = (
  fixture: PlatformFixture,
  xdgState: XdgState,
  developmentEnabled: boolean,
  flags: ExistenceFlags
): ConfigTreeCase => {
  const paths = platformPath(fixture.platform);
  const xdgConfigHome = xdgValue(xdgState, fixture);
  const velocettyDirectory = expectedVelocettyDirectory(fixture, xdgConfigHome);
  const hyperDirectory = hyperDirectoryFor(fixture, xdgConfigHome);
  const developmentDirectory = fixture.developmentDirectory;
  const presentPaths = new Set<string>();

  if (flags.velocettyConfig) {
    presentPaths.add(paths.join(velocettyDirectory, 'config.json5'));
  }
  if (flags.hyperConfig) {
    presentPaths.add(paths.join(hyperDirectory, 'config.json5'));
  }
  if (flags.hyperLegacy) {
    presentPaths.add(paths.join(hyperDirectory, 'hyper.json'));
  }
  if (flags.developmentConfig) {
    presentPaths.add(paths.join(developmentDirectory, 'config.json5'));
  }
  if (flags.developmentLegacy) {
    presentPaths.add(paths.join(developmentDirectory, 'hyper.json'));
  }

  const input: ConfigLocationInput = {
    platform: fixture.platform,
    xdgConfigHome,
    homeDirectory: fixture.homeDirectory,
    appDataDirectory: fixture.appDataDirectory,
    hyperUserDataDirectory: fixture.hyperUserDataDirectory,
    development: {enabled: developmentEnabled, directory: developmentDirectory},
    probe: (candidate) => (presentPaths.has(candidate) ? 'present' : 'absent'),
    sameFile: (left, right) => left === right
  };

  const oraclePath = resolveLegacyHyperConfigPath({
    platform: fixture.platform,
    xdgConfigHome,
    homeDirectory: fixture.homeDirectory,
    hyperUserDataDirectory: fixture.hyperUserDataDirectory,
    development: {enabled: developmentEnabled, directory: developmentDirectory},
    exists: (candidate) => presentPaths.has(candidate)
  });

  return {
    label: `${fixture.platform} xdg=${xdgState} development=${developmentEnabled ? 'on' : 'off'} ${describeFlags(flags)}`,
    input,
    flags,
    developmentEnabled,
    platform: fixture.platform,
    xdgState,
    velocettyDirectory,
    hyperDirectory,
    developmentDirectory,
    presentPaths,
    oraclePath,
    oracleExists: presentPaths.has(oraclePath)
  };
};

/** Returns the full 768-case enumeration: 32 flag masks × 3 platforms × 4 XDG states × 2 development flags. */
export const buildConfigTreeCases = (): ConfigTreeCase[] => {
  const cases: ConfigTreeCase[] = [];
  for (const fixture of platformFixtures) {
    for (const xdgState of xdgStates) {
      for (const developmentEnabled of [false, true]) {
        for (let mask = 0; mask < 32; mask += 1) {
          cases.push(buildConfigTreeCase(fixture, xdgState, developmentEnabled, flagsForMask(mask)));
        }
      }
    }
  }

  return cases;
};

/** Exposes the platform fixtures to the named examples in both suites. */
export const platformFixture = (platform: NodeJS.Platform): PlatformFixture => {
  const fixture = platformFixtures.find((candidate) => candidate.platform === platform);
  if (!fixture) {
    throw new Error(`No platform fixture for ${platform}`);
  }
  return fixture;
};
