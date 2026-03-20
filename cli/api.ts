/**
 * @file CLI helpers for reading, validating, and mutating Hyper plugin config.
 *
 * Invariants:
 * - `parseJson5StrictWithSchema` must reject malformed JSON5 or schema-invalid
 *   input so CLI operations only run against validated config.
 * - `stringifyJson5` must emit deterministic, stable output so config
 *   round-trips preserve formatting expectations.
 *
 * Cross-links:
 * - Shared JSON5 helper implementation:
 *   `shared/src/config/json5-config.ts` (`parseJson5StrictWithSchema`,
 *   `stringifyJson5`).
 */
// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unsafe-return */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import got from 'got';
import registryUrlModule from 'registry-url';
import {z} from 'zod';
import {parseJson5StrictWithSchema, stringifyJson5} from '@shared/config/json5-config';

/** Branded type for plugin specifiers (e.g., 'hyper-plugin', '@scope/plugin@1.0.0') */
type PluginSpecifier = string & {readonly __brand: 'PluginSpecifier'};

/** Branded type for normalized npm package names (e.g., 'hyper-plugin', '@scope%2fplugin') */
type PackageName = string & {readonly __brand: 'PackageName'};

type CliApiFsModule = Pick<typeof fs, 'existsSync' | 'readFileSync' | 'writeFileSync'>;

type CliApiGotClient = Pick<typeof got, 'get'>;

type CliApiEnvironment = {
  readonly APPDATA?: string;
  readonly NODE_ENV?: string;
  readonly XDG_CONFIG_HOME?: string;
};

type CliApiOptions = {
  readonly appData?: string;
  readonly env?: CliApiEnvironment;
  readonly fsModule?: CliApiFsModule;
  readonly gotClient?: CliApiGotClient;
  readonly homeDirectory?: string;
  readonly moduleDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly registryUrl?: string;
};

type CliApiDependencies = {
  readonly env: CliApiEnvironment;
  readonly fsModule: CliApiFsModule;
  readonly gotClient: CliApiGotClient;
  readonly platform: NodeJS.Platform;
  readonly registryUrl: string;
};

type CliRuntimeConfig = {
  readonly appData: string | undefined;
  readonly homeDirectory: string;
  readonly moduleDirectory: string;
  readonly configPath: string;
};

type CliApiContext = CliApiDependencies & CliRuntimeConfig;

type ApplicationDirectoryInput = {
  readonly appData: string | undefined;
  readonly env: Pick<CliApiEnvironment, 'XDG_CONFIG_HOME'>;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
};

type ConfigPathInput = {
  readonly appData: string | undefined;
  readonly env: Pick<CliApiEnvironment, 'NODE_ENV' | 'XDG_CONFIG_HOME'>;
  readonly fsModule: CliApiFsModule;
  readonly homeDirectory: string;
  readonly moduleDirectory: string;
  readonly platform: NodeJS.Platform;
};

/**
 * Public CLI helper surface for inspecting and mutating Hyper plugin config.
 */
export type CliApi = {
  readonly configPath: string;
  /** Returns `true` when the resolved config file exists on disk. */
  exists: () => boolean;
  /**
   * Checks whether a plugin exists on npm.
   *
   * @param plugin Plugin specifier validated at runtime.
   * @param signal Optional `AbortSignal` used to cancel the registry request.
   * @returns A promise that resolves with the raw registry response body wrapper.
   */
  existsOnNpm: (plugin: PluginSpecifier, signal?: AbortSignal) => Promise<unknown>;
  /**
   * Installs a plugin entry into the persisted config.
   *
   * @param plugin Plugin specifier validated at runtime.
   * @param options Optional install controls such as local install mode or request cancellation.
   * @returns A promise that resolves after persisting the updated config.
   */
  install: (plugin: PluginSpecifier, options?: InstallOptions) => Promise<void>;
  /**
   * Reports whether a plugin is already configured.
   *
   * @param plugin Plugin specifier validated at runtime.
   * @param locally When `true`, checks `localPlugins` instead of `plugins`.
   * @returns `true` when the plugin is present in the selected config list.
   */
  isInstalled: (plugin: PluginSpecifier, locally?: boolean) => boolean;
  /** Returns newline-delimited configured plugins or `false` when the list is empty. */
  list: () => string | false;
  /**
   * Removes a plugin entry from the persisted config.
   *
   * @param plugin Plugin specifier validated at runtime.
   * @returns A promise that resolves after persisting the updated config.
   */
  uninstall: (plugin: PluginSpecifier) => Promise<void>;
};

/** Smart constructor for PluginSpecifier with runtime validation */
const pluginSpecifier = (value: string): PluginSpecifier => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error('Plugin specifier cannot be empty');
  }
  return trimmedValue as PluginSpecifier;
};

/** Smart constructor for PackageName (output of normalization) */
const packageName = (value: string): PackageName => value as PackageName;

const configFileName = 'config.json5';
const legacyConfigFileName = 'hyper.json';
const currentModuleDirectory = path.dirname(fileURLToPath(import.meta.url));

const getPlatformPath = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

const resolveDependencies = (options: CliApiOptions = {}): CliApiDependencies => ({
  env: options.env ?? {
    APPDATA: process.env.APPDATA,
    NODE_ENV: process.env.NODE_ENV,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME
  },
  fsModule: options.fsModule ?? fs,
  gotClient: options.gotClient ?? got,
  platform: options.platform ?? process.platform,
  registryUrl: options.registryUrl ?? registryUrlModule()
});

const resolveRuntimeConfig = (dependencies: CliApiDependencies, options: CliApiOptions = {}): CliRuntimeConfig => {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const appData = options.appData ?? dependencies.env.APPDATA;
  const moduleDirectory = options.moduleDirectory ?? currentModuleDirectory;

  return {
    appData,
    configPath: resolveConfigPath({
      appData,
      env: dependencies.env,
      fsModule: dependencies.fsModule,
      homeDirectory,
      moduleDirectory,
      platform: dependencies.platform
    }),
    homeDirectory,
    moduleDirectory
  };
};

const resolveCliApiContext = (options: CliApiOptions = {}): CliApiContext => {
  const dependencies = resolveDependencies(options);
  const runtimeConfig = resolveRuntimeConfig(dependencies, options);

  return {
    ...dependencies,
    ...runtimeConfig
  };
};

// If the user defines XDG_CONFIG_HOME they definitely want their config there,
// otherwise use the home directory in linux/mac and userdata in windows.
const resolveApplicationDirectory = ({appData, env, homeDirectory, platform}: ApplicationDirectoryInput): string => {
  const platformPath = getPlatformPath(platform);
  const configuredXdgConfigHome = env.XDG_CONFIG_HOME;
  if (configuredXdgConfigHome) {
    return platformPath.join(configuredXdgConfigHome, 'Hyper');
  }

  if (platform === 'win32') {
    return platformPath.join(appData ?? platformPath.join(homeDirectory, 'AppData', 'Roaming'), 'Hyper');
  }

  return platformPath.join(homeDirectory, '.config', 'Hyper');
};

const resolveConfigPath = ({
  appData,
  env,
  fsModule,
  homeDirectory,
  moduleDirectory,
  platform
}: ConfigPathInput): string => {
  const platformPath = getPlatformPath(platform);
  const applicationDirectory = resolveApplicationDirectory({
    appData,
    env,
    homeDirectory,
    platform
  });
  const devConfigFileName = platformPath.join(moduleDirectory, '..', configFileName);
  const devLegacyConfigFileName = platformPath.join(moduleDirectory, '..', legacyConfigFileName);

  if (env.NODE_ENV !== 'production') {
    if (fsModule.existsSync(devConfigFileName)) {
      return devConfigFileName;
    }

    if (fsModule.existsSync(devLegacyConfigFileName)) {
      return devLegacyConfigFileName;
    }
  }

  const configPath = platformPath.join(applicationDirectory, configFileName);
  if (fsModule.existsSync(configPath)) {
    return configPath;
  }

  const legacyConfigPath = platformPath.join(applicationDirectory, legacyConfigFileName);
  if (fsModule.existsSync(legacyConfigPath)) {
    return legacyConfigPath;
  }

  return configPath;
};

const pluginNameSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Plugin identifiers must not be empty or whitespace-only.'
});

const cliConfigSchema = z
  .object({
    plugins: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(pluginNameSchema)).default([]),
    localPlugins: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(pluginNameSchema)).default([])
  })
  .passthrough();

type ParsedCliConfig = z.infer<typeof cliConfigSchema>;

type NormalizedCliConfig = Omit<ParsedCliConfig, 'plugins' | 'localPlugins'> & {
  plugins: PluginSpecifier[];
  localPlugins: PluginSpecifier[];
};

function getPackageName(plugin: PluginSpecifier): PackageName {
  const isScoped = plugin[0] === '@';
  const nameWithoutVersion = plugin.split('#')[0];

  if (isScoped) {
    return packageName(`@${nameWithoutVersion.split('@')[1].replace('/', '%2f')}`);
  }

  return packageName(nameWithoutVersion.split('@')[0]);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const npmRegistryResponseSchema = z.object({
  name: z.string().optional(),
  versions: z.record(z.string(), z.unknown())
});

const getErrorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }
  if (isRecord(value) && typeof value.message === 'string') {
    return value.message;
  }
  return String(value);
};

const handleNpmCheckError = (err: unknown, plugin: PluginSpecifier): Promise<never> => {
  const statusCode = isRecord(err) && typeof err.statusCode === 'number' ? err.statusCode : undefined;
  if (statusCode === 404) {
    return Promise.reject(`${plugin} not found on npm`);
  }
  if (statusCode === 200) {
    return Promise.reject(`Malformed npm registry response for ${plugin}`);
  }

  const errorMessage = getErrorMessage(err);
  return Promise.reject(`${errorMessage}\nPlugin check failed. Check your internet connection or retry later.`);
};

const resolveRegistryPackageUrl = (registryUrl: string, packageNameValue: PackageName): string => {
  const normalizedBase = new URL(registryUrl);
  if (!normalizedBase.pathname.endsWith('/')) {
    normalizedBase.pathname = `${normalizedBase.pathname}/`;
  }

  return new URL(packageNameValue.toLowerCase(), normalizedBase).toString();
};

type InstallOptions = {
  readonly locally?: boolean;
  readonly signal?: AbortSignal;
};

const installOptionsSchema = z
  .object({
    locally: z.boolean().optional(),
    signal: z.instanceof(AbortSignal).optional()
  })
  .strict();

const validatePluginInput = (value: unknown): PluginSpecifier => pluginSpecifier(z.string().parse(value));

const validateOptionalSignalInput = (value: unknown): AbortSignal | undefined =>
  value === undefined ? undefined : z.instanceof(AbortSignal).parse(value);

const validateOptionalBooleanInput = (value: unknown): boolean | undefined => z.boolean().optional().parse(value);

/**
 * Creates a CLI API instance bound to the provided filesystem, environment, and registry dependencies.
 *
 * @param options Optional dependency overrides for filesystem, environment, platform, and npm registry access.
 * @returns A `CliApi` instance that reads and writes the resolved Hyper config path.
 */
export const createCliApi = (options: CliApiOptions = {}): CliApi => {
  const context = resolveCliApiContext(options);
  const {configPath} = context;

  const getFileContents = () => context.fsModule.readFileSync(configPath, 'utf8');

  const getParsedFile = (): NormalizedCliConfig => {
    const config = parseJson5StrictWithSchema(getFileContents(), cliConfigSchema);
    return {
      ...config,
      plugins: config.plugins.map((entry) => pluginSpecifier(entry)),
      localPlugins: config.localPlugins.map((entry) => pluginSpecifier(entry))
    };
  };

  const getPluginsByKey = (key: 'plugins' | 'localPlugins'): PluginSpecifier[] => getParsedFile()[key];

  const getPlugins = () => getPluginsByKey('plugins');
  const getLocalPlugins = () => getPluginsByKey('localPlugins');

  const exists = () => context.fsModule.existsSync(configPath);

  const isInstalled = (plugin: PluginSpecifier, locally?: boolean) => {
    const validatedPlugin = validatePluginInput(plugin);
    const validatedLocally = validateOptionalBooleanInput(locally);
    const installedPlugins = validatedLocally ? getLocalPlugins() : getPlugins();
    return installedPlugins.includes(validatedPlugin);
  };

  const save = (config: unknown) => {
    return context.fsModule.writeFileSync(configPath, stringifyJson5(config), 'utf8');
  };

  const existsOnNpm = (plugin: PluginSpecifier, signal?: AbortSignal) => {
    return Promise.resolve().then(() => {
      const validatedPlugin = validatePluginInput(plugin);
      const validatedSignal = validateOptionalSignalInput(signal);
      const requestUrl = resolveRegistryPackageUrl(context.registryUrl, getPackageName(validatedPlugin));
      return context.gotClient
        .get<unknown>(requestUrl, {
          timeout: {request: 10000},
          responseType: 'json',
          signal: validatedSignal
        })
        .then((res) => {
          const validated = npmRegistryResponseSchema.safeParse(res.body);
          if (!validated.success) {
            return Promise.reject(res);
          }
          return res;
        });
    });
  };

  const install = (plugin: PluginSpecifier, options: InstallOptions = {}) => {
    return Promise.resolve()
      .then(() => {
        const validatedPlugin = validatePluginInput(plugin);
        const {locally = false, signal} = installOptionsSchema.parse(options);
        return {locally, signal, validatedPlugin};
      })
      .then(({locally, signal, validatedPlugin}) =>
        existsOnNpm(validatedPlugin, signal)
          .catch((err: unknown) => handleNpmCheckError(err, validatedPlugin))
          .then(() => {
            const config = getParsedFile();
            const pluginKey = locally ? 'localPlugins' : 'plugins';
            const installedPlugins = config[pluginKey];
            if (installedPlugins.includes(validatedPlugin)) {
              return Promise.reject(`${validatedPlugin} is already installed`);
            }

            config[pluginKey] = [...installedPlugins, validatedPlugin];
            save(config);
          })
      );
  };

  const uninstall = async (plugin: PluginSpecifier) => {
    const validatedPlugin = validatePluginInput(plugin);
    const config = getParsedFile();
    const hasPlugin = config.plugins.some((installedPlugin) => installedPlugin === validatedPlugin);
    const hasLocalPlugin = config.localPlugins.some((installedPlugin) => installedPlugin === validatedPlugin);

    if (!hasPlugin && !hasLocalPlugin) {
      throw new Error(`${validatedPlugin} is not installed`);
    }

    config.plugins = config.plugins.filter((installedPlugin) => installedPlugin !== validatedPlugin);
    config.localPlugins = config.localPlugins.filter((installedPlugin) => installedPlugin !== validatedPlugin);
    save(config);
  };

  const list = () => {
    const plugins = getPlugins();
    if (plugins.length > 0) {
      return plugins.join('\n');
    }
    return false;
  };

  return {configPath, exists, existsOnNpm, install, isInstalled, list, uninstall};
};

const defaultCliApi = createCliApi();

/** Resolved Hyper config path for the default CLI API instance. */
export const configPath = defaultCliApi.configPath;

/** Returns `true` when the default CLI config file exists on disk. */
export const exists = defaultCliApi.exists;

/**
 * Checks whether a plugin exists on npm for the default CLI API instance.
 *
 * @param plugin Plugin specifier validated at runtime.
 * @param signal Optional `AbortSignal` used to cancel the registry request.
 * @returns A promise that resolves with the raw registry response body wrapper.
 */
export const existsOnNpm = defaultCliApi.existsOnNpm;

/**
 * Installs a plugin entry into the persisted config for the default CLI API instance.
 *
 * @param plugin Plugin specifier validated at runtime.
 * @param options Optional install controls such as local install mode or request cancellation.
 * @returns A promise that resolves after persisting the updated config.
 */
export const install = defaultCliApi.install;

/**
 * Reports whether a plugin is already configured for the default CLI API instance.
 *
 * @param plugin Plugin specifier validated at runtime.
 * @param locally When `true`, checks `localPlugins` instead of `plugins`.
 * @returns `true` when the plugin is present in the selected config list.
 */
export const isInstalled = defaultCliApi.isInstalled;

/** Returns newline-delimited configured plugins or `false` when the list is empty. */
export const list = defaultCliApi.list;

/**
 * Removes a plugin entry from the persisted config for the default CLI API instance.
 *
 * @param plugin Plugin specifier validated at runtime.
 * @returns A promise that resolves after persisting the updated config.
 */
export const uninstall = defaultCliApi.uninstall;
export {pluginSpecifier};
