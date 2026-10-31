/** @file Frozen oracle for the Hyper-tree resolution rules that shipped before the Velocetty tree. */
import path from 'node:path';

/** Inputs the pre-Velocetty resolver consumed. */
export type LegacyHyperPathInput = {
  readonly platform: NodeJS.Platform;
  readonly xdgConfigHome: string | undefined;
  readonly homeDirectory: string;
  readonly hyperUserDataDirectory: string;
  readonly development: {readonly enabled: boolean; readonly directory: string};
  readonly exists: (candidate: string) => boolean;
};

const platformPath = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/**
 * Resolves the active Hyper-tree configuration path exactly as `app/config/paths.ts`
 * did before the Velocetty tree existed.
 *
 * The copy is deliberately literal. KB-PATH-1 uses it as an oracle, so it must
 * not be refactored alongside the implementation it checks: a change here would
 * move the baseline and hide a regression.
 *
 * The Hyper tree keeps its historical, laxer `XDG_CONFIG_HOME` rule: any
 * non-empty value counts, even a relative one.
 *
 * @param input - Environment, platform, and existence callback.
 * @returns The path the old resolver would have selected.
 *
 * @example
 * ```ts
 * resolveLegacyHyperConfigPath({
 *   platform: 'linux',
 *   xdgConfigHome: undefined,
 *   homeDirectory: '/home/ada',
 *   hyperUserDataDirectory: '/home/ada/.config/Hyper',
 *   development: {enabled: false, directory: '/repo'},
 *   exists: () => false
 * }); // '/home/ada/.config/Hyper/config.json5'
 * ```
 */
export const resolveLegacyHyperConfigPath = (input: LegacyHyperPathInput): string => {
  const paths = platformPath(input.platform);
  let hyperDirectory: string;

  if (input.xdgConfigHome) {
    hyperDirectory = paths.join(input.xdgConfigHome, 'Hyper');
  } else if (input.platform === 'win32') {
    hyperDirectory = input.hyperUserDataDirectory;
  } else {
    hyperDirectory = paths.join(input.homeDirectory, '.config', 'Hyper');
  }

  let configPath = paths.join(hyperDirectory, 'config.json5');
  if (!input.exists(configPath) && input.exists(paths.join(hyperDirectory, 'hyper.json'))) {
    configPath = paths.join(hyperDirectory, 'hyper.json');
  }

  if (input.development.enabled) {
    const developmentConfig = paths.join(input.development.directory, 'config.json5');
    const developmentLegacy = paths.join(input.development.directory, 'hyper.json');

    if (input.exists(developmentConfig)) {
      configPath = developmentConfig;
    } else if (input.exists(developmentLegacy)) {
      configPath = developmentLegacy;
    }
  }

  return configPath;
};
