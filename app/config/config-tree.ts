/**
 * @file Pure Velocetty/Hyper configuration-tree resolution (KB-PATH-1).
 *
 * Decides which `config.json5` is active, where `keybindings.json5` lives, and
 * which lower-priority copies the active file hides. The Velocetty tree wins
 * over the legacy Hyper tree, and a development build reads the repository's
 * own tree instead. `shared/src/config/config-tree.ts` mirrors this module for
 * the CLI; KB-PATH-2 fails if the two disagree.
 *
 * Every machine-dependent input is injected, so the resolver is pure and the
 * same rules can be exercised for every platform.
 */
import path from 'node:path';

import {isObject, isString} from '../utils/runtime-guards';

/** The tree that supplied the active configuration file. */
export type ConfigTree = 'velocetty' | 'hyper' | 'development';

/**
 * What a filesystem probe could establish about a candidate path.
 *
 * `inaccessible` is distinct from `absent`: a permission or I/O fault means the
 * file may well exist, so treating it as missing would let Velocetty create a
 * file that shadows a configuration it simply could not read.
 */
export type ProbeState = 'present' | 'broken-link' | 'absent' | 'inaccessible';

/**
 * A configuration path the resolver reached through its own priority order.
 *
 * The resolver owns how paths are built: platform-flavoured joins of known
 * segments. The probe is only ever asked about such a path, and `configPath` is
 * the sole constructor, so an unrelated string cannot be probed by accident.
 */
export type ConfigPath = string & {readonly __brand: 'ConfigPath'};

/** Brands a path this resolver built; the only constructor of {@link ConfigPath}. */
const configPath = (value: string): ConfigPath => {
  // SAFETY: This constructor is the only source of configuration-path brands.
  return value as ConfigPath;
};

/**
 * Whether a configuration path could be inspected at all.
 *
 * `inaccessible` propagates from the active probe to the start-up decision:
 * the resolver reports it, and the importer must keep the defaults rather than
 * create a file whose contents it could not compare against.
 */
export type ConfigInspection = 'ok' | 'inaccessible';

/**
 * What a successful `stat` or `lstat` proves.
 *
 * The probe reads nothing from the answer: the call returning at all is the
 * evidence, so the type names that fact rather than exposing `unknown` or
 * requiring every double to reproduce Node's `Stats`.
 */
export type PathProbeEntry = object;

/** The filesystem surface a probe needs; both callers pass their own slice. */
export type PathProbeFileSystem = {
  readonly statSync: (candidate: string) => PathProbeEntry;
  readonly lstatSync: (candidate: string) => PathProbeEntry;
};

/** Filesystem error codes that mean "could not inspect", not "absent". */
const inspectionFailureCodes: ReadonlySet<string> = new Set(['EACCES', 'EPERM', 'EIO']);

/**
 * Whether a filesystem error means the path could not be inspected.
 *
 * Only permission and I/O faults qualify. `ENOENT` and `ENOTDIR` are genuine
 * absence, and a dangling symlink is `lstat` succeeding after `stat` failed.
 */
export const isInspectionFailure = (error: unknown): boolean => {
  if (!isObject(error) || !('code' in error)) {
    return false;
  }
  const {code} = error;
  return isString(code) && inspectionFailureCodes.has(code);
};

/**
 * Builds the probe both the application and the CLI inject into the resolver.
 *
 * `stat` proves presence; when it throws, `lstat` distinguishes a dangling
 * symlink from absence. A permission or I/O fault reports `inaccessible` at
 * either step, because neither tells us whether the file exists.
 *
 * @param fileSystem - The caller's `stat`/`lstat` pair.
 * @returns A probe for {@link resolveConfigLocations}.
 *
 * @example
 * ```ts
 * const probe = createPathProbe({statSync, lstatSync});
 * probe('/home/ada/.config/Velocetty/config.json5'); // 'present'
 * ```
 */
export const createPathProbe =
  (fileSystem: PathProbeFileSystem) =>
  (candidate: string): ProbeState => {
    try {
      fileSystem.statSync(candidate);
      return 'present';
    } catch (error) {
      if (isInspectionFailure(error)) {
        return 'inaccessible';
      }
      try {
        fileSystem.lstatSync(candidate);
        return 'broken-link';
      } catch (linkError) {
        return isInspectionFailure(linkError) ? 'inaccessible' : 'absent';
      }
    }
  };

/**
 * Inputs of {@link resolveConfigLocations}.
 *
 * Everything that could touch the machine is injected, so the resolver stays
 * pure: the caller supplies the platform, the relevant environment paths, and
 * two filesystem predicates. `probe` is four-state so a broken symlink and an
 * unreadable path can each be told apart from an absent file. `sameFile`
 * compares real paths, so a symlinked Velocetty directory pointing at the Hyper
 * tree does not produce a spurious "ignored copy" notice.
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
  readonly probe: (candidate: ConfigPath) => ProbeState;
  readonly sameFile: (left: string, right: string) => boolean;
};

/** Locations the application and the CLI agree on. */
export type ConfigLocations = {
  readonly velocettyDirectory: string;
  /**
   * The active configuration and whether it could be inspected.
   *
   * `exists` is false when the active candidate is `inaccessible`: presence is
   * not established, but the path is still the one the user meant, so it is
   * reported rather than replaced by the creation path.
   */
  readonly config: {
    readonly path: string;
    readonly tree: ConfigTree;
    readonly exists: boolean;
    readonly inspection: ConfigInspection;
  };
  readonly keybindingsPath: string;
  /** Lower-priority `config.json5` files the active one hides. */
  readonly shadowed: readonly string[];
};

type Candidate = {
  readonly path: ConfigPath;
  readonly tree: ConfigTree;
  readonly isConfigFile: boolean;
};

const configFileName = 'config.json5';
const legacyConfigFileName = 'hyper.json';
const keybindingsFileName = 'keybindings.json5';

/** Picks the path flavour whose separators match the reported platform. */
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

/**
 * Lists the configuration candidates in priority order.
 *
 * The development directory comes first when it is active, then the Velocetty
 * tree, then the Hyper tree's two historical names. Listing is pure: existence
 * is probed by the caller, so the same order serves both the resolver and the
 * "every candidate is shadowed" check.
 */
const listCandidates = (
  input: ConfigLocationInput,
  paths: typeof path.posix,
  velocettyDirectory: string,
  hyperDirectory: string
): Candidate[] => {
  const candidates: Candidate[] = [];

  if (input.development.enabled) {
    candidates.push(
      {
        path: configPath(paths.join(input.development.directory, configFileName)),
        tree: 'development',
        isConfigFile: true
      },
      {
        path: configPath(paths.join(input.development.directory, legacyConfigFileName)),
        tree: 'development',
        isConfigFile: false
      }
    );
  }

  candidates.push(
    {path: configPath(paths.join(velocettyDirectory, configFileName)), tree: 'velocetty', isConfigFile: true},
    {path: configPath(paths.join(hyperDirectory, configFileName)), tree: 'hyper', isConfigFile: true},
    {path: configPath(paths.join(hyperDirectory, legacyConfigFileName)), tree: 'hyper', isConfigFile: false}
  );

  return candidates;
};

/**
 * Whether a candidate exists well enough to hide an ignored copy.
 *
 * A dangling symlink counts: the file is managed, and only its target is
 * temporarily missing.
 */
const isVisible = (state: ProbeState): boolean => state === 'present' || state === 'broken-link';

/** One candidate and what the probe established about it. */
type ProbedCandidate = Readonly<{candidate: Candidate; state: ProbeState}>;

/** The active configuration file, and the priority it won at. */
type ActiveSelection = Readonly<{active: ConfigLocations['config']; index: number}>;

/**
 * Selects the first candidate whose absence is not established.
 *
 * An inaccessible candidate wins on priority: its contents are unknown, so
 * falling through to a readable lower-priority file would silently change
 * which configuration the user gets. It is reported as not present and not
 * absent, so the caller keeps its defaults instead of creating a file that may
 * shadow the one it could not read.
 */
const selectActiveConfig = (probed: readonly ProbedCandidate[], creationPath: ConfigPath): ActiveSelection => {
  const index = probed.findIndex((entry) => entry.state !== 'absent');
  const entry = index === -1 ? undefined : probed[index];
  if (entry === undefined) {
    return {active: {path: creationPath, tree: 'velocetty', exists: false, inspection: 'ok'}, index};
  }
  const isInaccessible = entry.state === 'inaccessible';
  return {
    active: {
      path: entry.candidate.path,
      tree: entry.candidate.tree,
      exists: !isInaccessible,
      inspection: isInaccessible ? 'inaccessible' : 'ok'
    },
    index
  };
};

/**
 * Lists the lower-priority configuration files the active one hides.
 *
 * A path that could not be inspected is not an ignored copy, and an
 * inaccessible active file leaves the priority order unresolved rather than
 * shadowing anything, so both report no hidden copies.
 */
const listShadowed = ({
  active,
  activeIndex,
  probed,
  sameFile
}: Readonly<{
  active: ConfigLocations['config'];
  activeIndex: number;
  probed: readonly ProbedCandidate[];
  sameFile: (left: string, right: string) => boolean;
}>): readonly string[] => {
  if (activeIndex === -1 || active.inspection === 'inaccessible') {
    return [];
  }
  return probed
    .filter((entry, index) => index > activeIndex && entry.candidate.isConfigFile && isVisible(entry.state))
    .map((entry) => entry.candidate.path)
    .filter((candidatePath) => candidatePath !== active.path && !sameFile(candidatePath, active.path));
};

/**
 * Resolves the active configuration file and the paths around it.
 *
 * Priority is development mode, then the Velocetty tree, then the Hyper tree's
 * existing rules. When nothing exists, the Velocetty creation path is returned
 * with `exists: false`, so a fresh install never writes under the old name. A
 * candidate that could not be inspected is selected at its priority and
 * reported with `inspection: 'inaccessible'`, so the caller keeps the defaults
 * instead of creating a file that may shadow it.
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
  const probed = listCandidates(input, paths, velocettyDirectory, hyperDirectory).map((candidate) => ({
    candidate,
    state: input.probe(candidate.path)
  }));
  const creationPath = configPath(paths.join(velocettyDirectory, configFileName));
  const {active, index} = selectActiveConfig(probed, creationPath);
  const shadowed = listShadowed({active, activeIndex: index, probed, sameFile: input.sameFile});

  const keybindingsPath =
    active.tree === 'development'
      ? paths.join(input.development.directory, keybindingsFileName)
      : paths.join(velocettyDirectory, keybindingsFileName);

  return {velocettyDirectory, config: active, keybindingsPath, shadowed};
};
