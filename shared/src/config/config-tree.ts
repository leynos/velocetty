/** @file Mirror of `app/config/config-tree.ts` for the CLI; parity is enforced by KB-PATH-2. */
import path from 'node:path';

/** The tree that supplied the active configuration file. */
export type ConfigTree = 'velocetty' | 'hyper' | 'development';

/**
 * Inputs of {@link resolveConfigLocations}.
 *
 * Everything that could touch the machine is injected, so the resolver stays
 * pure: the caller supplies the platform, the relevant environment paths, and
 * two filesystem predicates. `probe` is three-state so a broken symlink can be
 * told apart from an absent file. `sameFile` compares real paths, so a
 * symlinked Velocetty directory pointing at the Hyper tree does not produce a
 * spurious "ignored copy" notice.
 */
export type ConfigLocationInput = {
  readonly platform: NodeJS.Platform;
  readonly xdgConfigHome: string | undefined;
  readonly homeDirectory: string;
  /** Electron's `appData`; the CLI supplies `APPDATA` or its home-based default. */
  readonly appDataDirectory: string;
  /** Electron's `userData`, which is the Hyper tree on Windows only. */
  readonly hyperUserDataDirectory: string;
  readonly development: {readonly enabled: boolean; readonly directory: string};
  readonly probe: (candidate: string) => 'present' | 'broken-link' | 'absent';
  readonly sameFile: (left: string, right: string) => boolean;
};

/** Locations the application and the CLI agree on. */
export type ConfigLocations = {
  readonly velocettyDirectory: string;
  readonly config: {readonly path: string; readonly tree: ConfigTree; readonly exists: boolean};
  readonly keybindingsPath: string;
  /** Lower-priority `config.json5` files the active one hides. */
  readonly shadowed: readonly string[];
};

type Candidate = {
  readonly path: string;
  readonly tree: ConfigTree;
  readonly isConfigFile: boolean;
};

const configFileName = 'config.json5';
const legacyConfigFileName = 'hyper.json';
const keybindingsFileName = 'keybindings.json5';

const platformPath = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/**
 * Resolves the Velocetty tree.
 *
 * An absolute, non-empty `XDG_CONFIG_HOME` wins on every platform, as the XDG
 * Base Directory specification requires. A relative or empty value falls back
 * to `~/.config` on Linux and macOS and to Electron's `appData` on Windows.
 */
const resolveVelocettyDirectory = (input: ConfigLocationInput, paths: typeof path.posix): string => {
  const xdgConfigHome = input.xdgConfigHome;
  if (xdgConfigHome && paths.isAbsolute(xdgConfigHome)) {
    return paths.join(xdgConfigHome, 'Velocetty');
  }

  if (input.platform === 'win32') {
    return paths.join(input.appDataDirectory, 'Velocetty');
  }

  return paths.join(input.homeDirectory, '.config', 'Velocetty');
};

/**
 * Resolves the Hyper tree with its historical rules.
 *
 * This is deliberately laxer than the Velocetty rule: any non-empty
 * `XDG_CONFIG_HOME` counts, even a relative one, because existing users
 * configured it that way.
 */
const resolveHyperDirectory = (input: ConfigLocationInput, paths: typeof path.posix): string => {
  const xdgConfigHome = input.xdgConfigHome;
  if (xdgConfigHome) {
    return paths.join(xdgConfigHome, 'Hyper');
  }

  if (input.platform === 'win32') {
    return input.hyperUserDataDirectory;
  }

  return paths.join(input.homeDirectory, '.config', 'Hyper');
};

const listCandidates = (
  input: ConfigLocationInput,
  paths: typeof path.posix,
  velocettyDirectory: string,
  hyperDirectory: string
): Candidate[] => {
  const candidates: Candidate[] = [];

  if (input.development.enabled) {
    candidates.push(
      {path: paths.join(input.development.directory, configFileName), tree: 'development', isConfigFile: true},
      {path: paths.join(input.development.directory, legacyConfigFileName), tree: 'development', isConfigFile: false}
    );
  }

  candidates.push(
    {path: paths.join(velocettyDirectory, configFileName), tree: 'velocetty', isConfigFile: true},
    {path: paths.join(hyperDirectory, configFileName), tree: 'hyper', isConfigFile: true},
    {path: paths.join(hyperDirectory, legacyConfigFileName), tree: 'hyper', isConfigFile: false}
  );

  return candidates;
};

/**
 * Resolves the active configuration file and the paths around it.
 *
 * Priority is development mode, then the Velocetty tree, then the Hyper tree's
 * existing rules. When nothing exists, the Velocetty creation path is returned
 * with `exists: false`, so a fresh install never writes under the old name.
 *
 * @param input - Injected environment, platform, and filesystem predicates.
 * @returns The Velocetty directory, active config, keybindings path, and
 * shadowed copies.
 *
 * @example
 * ```ts
 * resolveConfigLocations({
 *   platform: 'linux',
 *   xdgConfigHome: undefined,
 *   homeDirectory: '/home/ada',
 *   appDataDirectory: '/home/ada/.config',
 *   hyperUserDataDirectory: '/home/ada/.config/Hyper',
 *   development: {enabled: false, directory: '/repo'},
 *   probe: () => 'absent',
 *   sameFile: (left, right) => left === right
 * }).config; // {path: '/home/ada/.config/Velocetty/config.json5', tree: 'velocetty', exists: false}
 * ```
 */
export const resolveConfigLocations = (input: ConfigLocationInput): ConfigLocations => {
  const paths = platformPath(input.platform);
  const velocettyDirectory = resolveVelocettyDirectory(input, paths);
  const hyperDirectory = resolveHyperDirectory(input, paths);
  const candidates = listCandidates(input, paths, velocettyDirectory, hyperDirectory);
  const isPresent = (candidate: Candidate) => input.probe(candidate.path) !== 'absent';
  const activeIndex = candidates.findIndex((candidate) => isPresent(candidate));
  const activeCandidate = activeIndex === -1 ? undefined : candidates[activeIndex];

  const creationPath = paths.join(velocettyDirectory, configFileName);
  const active: ConfigLocations['config'] = activeCandidate
    ? {path: activeCandidate.path, tree: activeCandidate.tree, exists: true}
    : {path: creationPath, tree: 'velocetty', exists: false};

  const shadowed = (activeCandidate ? candidates.slice(activeIndex + 1) : [])
    .filter((candidate) => candidate.isConfigFile && isPresent(candidate))
    .filter((candidate) => candidate.path !== active.path && !input.sameFile(candidate.path, active.path))
    .map((candidate) => candidate.path);

  const keybindingsPath =
    active.tree === 'development'
      ? paths.join(input.development.directory, keybindingsFileName)
      : paths.join(velocettyDirectory, keybindingsFileName);

  return {velocettyDirectory, config: active, keybindingsPath, shadowed};
};
