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

export type CliApi = {
  readonly configPath: string;
  exists: () => boolean;
  existsOnNpm: (plugin: PluginSpecifier, signal?: AbortSignal) => Promise<unknown>;
  install: (plugin: PluginSpecifier, options?: InstallOptions) => Promise<void>;
  isInstalled: (plugin: PluginSpecifier, locally?: boolean) => boolean;
  list: () => string | false;
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

export const createCliApi = (options: CliApiOptions = {}): CliApi => {
  const context = resolveCliApiContext(options);
  const {configPath} = context;

  const getFileContents = () => context.fsModule.readFileSync(configPath, 'utf8');

  const getParsedFile = () => parseJson5StrictWithSchema(getFileContents(), cliConfigSchema);

  const getPluginsByKey = (key: 'plugins' | 'localPlugins'): PluginSpecifier[] =>
    getParsedFile()[key].map((entry) => pluginSpecifier(entry));

  const getPlugins = () => getPluginsByKey('plugins');
  const getLocalPlugins = () => getPluginsByKey('localPlugins');

  const exists = () => context.fsModule.existsSync(configPath);

  const isInstalled = (plugin: PluginSpecifier, locally?: boolean) => {
    const installedPlugins = locally ? getLocalPlugins() : getPlugins();
    return installedPlugins.includes(plugin);
  };

  const save = (config: unknown) => {
    return context.fsModule.writeFileSync(configPath, stringifyJson5(config), 'utf8');
  };

  const existsOnNpm = (plugin: PluginSpecifier, signal?: AbortSignal) => {
    const requestUrl = resolveRegistryPackageUrl(context.registryUrl, getPackageName(plugin));
    return context.gotClient
      .get<unknown>(requestUrl, {
        timeout: {request: 10000},
        responseType: 'json',
        signal
      })
      .then((res) => {
        const validated = npmRegistryResponseSchema.safeParse(res.body);
        if (!validated.success) {
          return Promise.reject(res);
        }
        return res;
      });
  };

  const install = (plugin: PluginSpecifier, options: InstallOptions = {}) => {
    const {locally = false, signal} = options;
    return existsOnNpm(plugin, signal)
      .catch((err: unknown) => handleNpmCheckError(err, plugin))
      .then(() => {
        const installedPlugins = locally ? getLocalPlugins() : getPlugins();
        if (installedPlugins.includes(plugin)) {
          return Promise.reject(`${plugin} is already installed`);
        }

        const config = getParsedFile();
        config[locally ? 'localPlugins' : 'plugins'] = [...installedPlugins, plugin];
        save(config);
      });
  };

  const uninstall = async (plugin: PluginSpecifier) => {
    const config = getParsedFile();
    const hasPlugin = config.plugins.some((installedPlugin) => installedPlugin === plugin);
    const hasLocalPlugin = config.localPlugins.some((installedPlugin) => installedPlugin === plugin);

    if (!hasPlugin && !hasLocalPlugin) {
      throw new Error(`${plugin} is not installed`);
    }

    config.plugins = config.plugins.filter((installedPlugin) => installedPlugin !== plugin);
    config.localPlugins = config.localPlugins.filter((installedPlugin) => installedPlugin !== plugin);
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

export const configPath = defaultCliApi.configPath;
export const {exists, existsOnNpm, install, isInstalled, list, uninstall} = defaultCliApi;
export {pluginSpecifier};
