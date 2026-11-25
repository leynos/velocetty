/** @file A complete stand-in for `app/config/paths`, for suites that mock it. */
/*
 * Bun keeps one mock registry for the whole test process, so a suite that
 * registers a partial stub of `app/config/paths` leaks it to every later suite
 * that imports a main-process module asking for one of the missing exports. The
 * failure surfaces as a `SyntaxError` about a missing export in a file the
 * partial stub's author never touched, which is hard to trace back.
 *
 * Registering this complete surface instead keeps the blast radius to the
 * fields a suite actually overrides. It mirrors the real module's exports; add
 * a field here whenever `app/config/paths.ts` gains one.
 */
import path from 'node:path';

/** The paths a suite needs to redirect; every other path is a neutral default. */
export type PathsModuleStubOptions = Readonly<{
  cfgDir?: string;
  cfgPath?: string;
  configInspection?: string;
  icon?: string;
  keybindingsPath?: string;
}>;

const DEFAULT_CFG_DIR = '/tmp/velocetty-paths-stub';

/**
 * Builds the full export surface of `app/config/paths` from a few overrides.
 *
 * @param options - The paths the suite cares about; the rest are derived from
 * `cfgDir`.
 *
 * @example
 * ```ts
 * const paths = createPathsModuleStub({cfgPath: '/tmp/cfg/config.json5'});
 * paths.schemaPath; // '/tmp/velocetty-paths-stub/schema.json'
 * ```
 */
export const createPathsModuleStub = ({
  cfgDir = DEFAULT_CFG_DIR,
  cfgPath = path.join(cfgDir, 'config.json5'),
  configInspection = 'ok',
  icon = path.join(cfgDir, 'icon.png'),
  keybindingsPath = path.join(cfgDir, 'keybindings.json5')
}: PathsModuleStubOptions = {}) => ({
  bun: 'bun',
  cfgDir,
  cfgFile: path.basename(cfgPath),
  cfgPath,
  cliLinkPath: path.join(cfgDir, 'hyper'),
  cliScriptPath: path.join(cfgDir, 'cli.js'),
  configInspection,
  configTree: 'velocetty',
  defaultCfg: path.join(cfgDir, 'config-default.json'),
  defaultPlatformKeyPath: () => path.join(cfgDir, 'linux.json'),
  homeDirectory: cfgDir,
  icon,
  keybindingsFile: 'keybindings.json5',
  keybindingsPath,
  keybindingsSchemaFile: 'keybindings.schema.json',
  keybindingsSchemaPath: path.join(cfgDir, 'keybindings.schema.json'),
  plugs: {base: path.join(cfgDir, 'plugins'), local: path.join(cfgDir, 'plugins', 'local')},
  schemaFile: 'schema.json',
  schemaPath: path.join(cfgDir, 'schema.json'),
  shadowedConfigPaths: [path.join(cfgDir, '.hyper', 'config.json5')],
  velocettyDir: cfgDir
});
