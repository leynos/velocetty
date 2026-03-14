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

type CliApiContext = {
  readonly appData?: string;
  readonly env: CliApiEnvironment;
  readonly fsModule: CliApiFsModule;
  readonly gotClient: CliApiGotClient;
  readonly homeDirectory: string;
  readonly moduleDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly registryUrl: string;
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

const resolveCliApiContext = (options: CliApiOptions = {}): CliApiContext => ({
  appData: options.appData ?? options.env?.APPDATA ?? process.env.APPDATA,
  env: options.env ?? process.env,
  fsModule: options.fsModule ?? fs,
  gotClient: options.gotClient ?? got,
  homeDirectory: options.homeDirectory ?? os.homedir(),
  moduleDirectory: options.moduleDirectory ?? __dirname,
  platform: options.platform ?? process.platform,
  registryUrl: options.registryUrl ?? registryUrlModule()
});

// If the user defines XDG_CONFIG_HOME they definitely want their config there,
// otherwise use the home directory in linux/mac and userdata in windows.
const resolveApplicationDirectory = (context: CliApiContext): string => {
  const configuredXdgConfigHome = context.env.XDG_CONFIG_HOME;
  if (configuredXdgConfigHome) {
    return path.join(configuredXdgConfigHome, 'Hyper');
  }

  if (context.platform === 'win32') {
    return path.join(context.appData ?? path.join(context.homeDirectory, 'AppData', 'Roaming'), 'Hyper');
  }

  return path.join(context.homeDirectory, '.config', 'Hyper');
};

const resolveConfigPath = (context: CliApiContext): string => {
  const applicationDirectory = resolveApplicationDirectory(context);
  const devConfigFileName = path.join(context.moduleDirectory, `../${configFileName}`);
  const devLegacyConfigFileName = path.join(context.moduleDirectory, `../${legacyConfigFileName}`);
  if (context.env.NODE_ENV !== 'production') {
    if (context.fsModule.existsSync(devConfigFileName)) {
      return devConfigFileName;
    }
    if (context.fsModule.existsSync(devLegacyConfigFileName)) {
      return devLegacyConfigFileName;
    }
  }

  const configPath = path.join(applicationDirectory, configFileName);
  if (context.fsModule.existsSync(configPath)) {
    return configPath;
  }

  const legacyConfigPath = path.join(applicationDirectory, legacyConfigFileName);
  if (context.fsModule.existsSync(legacyConfigPath)) {
    return legacyConfigPath;
  }

  return configPath;
};

/**
 * We need to make sure the file reading and parsing is lazy so that failure to
 * statically analyze the hyper configuration isn't fatal for all kinds of
 * subcommands. We can use memoization to make reading and parsing lazy.
 */
function memoize<T extends (...args: unknown[]) => unknown>(fn: T): T {
  let hasResult = false;
  let result: ReturnType<T> | undefined;
  return ((...args: Parameters<T>): ReturnType<T> => {
    if (!hasResult) {
      result = fn(...args) as ReturnType<T>;
      hasResult = true;
    }
    return result as ReturnType<T>;
  }) as T;
}

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

type InstallOptions = {
  readonly locally?: boolean;
  readonly signal?: AbortSignal;
};

export const createCliApi = (options: CliApiOptions = {}): CliApi => {
  const context = resolveCliApiContext(options);
  const configPath = resolveConfigPath(context);

  const getFileContents = memoize(() => {
    return context.fsModule.readFileSync(configPath, 'utf8');
  });

  const getParsedFile = memoize(() => parseJson5StrictWithSchema(getFileContents(), cliConfigSchema));

  const getPluginsByKey = (key: 'plugins' | 'localPlugins'): PluginSpecifier[] =>
    getParsedFile()[key].map((entry) => pluginSpecifier(entry));

  const getPlugins = memoize(() => getPluginsByKey('plugins'));
  const getLocalPlugins = memoize(() => getPluginsByKey('localPlugins'));

  const exists = () => context.fsModule.existsSync(configPath);

  const isInstalled = (plugin: PluginSpecifier, locally?: boolean) => {
    const installedPlugins = locally ? getLocalPlugins() : getPlugins();
    if (Array.isArray(installedPlugins)) {
      return installedPlugins.includes(plugin);
    }
    return false;
  };

  const save = (config: unknown) => {
    return context.fsModule.writeFileSync(configPath, stringifyJson5(config), 'utf8');
  };

  const existsOnNpm = (plugin: PluginSpecifier, signal?: AbortSignal) => {
    const name = getPackageName(plugin);
    return context.gotClient
      .get<unknown>(context.registryUrl + name.toLowerCase(), {
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
    const installedPlugins = locally ? getLocalPlugins() : getPlugins();
    return existsOnNpm(plugin, signal)
      .catch((err: unknown) => handleNpmCheckError(err, plugin))
      .then(() => {
        if (isInstalled(plugin, locally)) {
          return Promise.reject(`${plugin} is already installed`);
        }

        const config = getParsedFile();
        config[locally ? 'localPlugins' : 'plugins'] = [...installedPlugins, plugin];
        save(config);
      });
  };

  const uninstall = async (plugin: PluginSpecifier) => {
    if (!isInstalled(plugin)) {
      throw new Error(`${plugin} is not installed`);
    }

    const config = getParsedFile();
    config.plugins = getPlugins().filter((installedPlugin) => installedPlugin !== plugin);
    save(config);
  };

  const list = () => {
    if (getPlugins().length > 0) {
      return getPlugins().join('\n');
    }
    return false;
  };

  return {configPath, exists, existsOnNpm, install, isInstalled, list, uninstall};
};

const defaultCliApi = createCliApi();

export const configPath = defaultCliApi.configPath;
export const {exists, existsOnNpm, install, isInstalled, list, uninstall} = defaultCliApi;
export {pluginSpecifier};
