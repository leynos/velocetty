/** @file CLI helpers for reading, validating, and mutating Hyper plugin config. */
// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unsafe-return */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import got from 'got';
import registryUrlModule from 'registry-url';
import {z} from 'zod';
import {parseJson5StrictWithSchema, stringifyJson5} from '@shared/config/json5-config';

const registryUrl = registryUrlModule();

/** Branded type for plugin specifiers (e.g., 'hyper-plugin', '@scope/plugin@1.0.0') */
type PluginSpecifier = string & {readonly __brand: 'PluginSpecifier'};

/** Branded type for normalized npm package names (e.g., 'hyper-plugin', '@scope%2fplugin') */
type PackageName = string & {readonly __brand: 'PackageName'};

/** Smart constructor for PluginSpecifier with runtime validation */
const pluginSpecifier = (value: string): PluginSpecifier => {
  if (!value || value.trim().length === 0) {
    throw new Error('Plugin specifier cannot be empty');
  }
  return value as PluginSpecifier;
};

/** Smart constructor for PackageName (output of normalization) */
const packageName = (value: string): PackageName => value as PackageName;

// If the user defines XDG_CONFIG_HOME they definitely want their config there,
// otherwise use the home directory in linux/mac and userdata in windows
const applicationDirectory = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'Hyper')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA!, 'Hyper')
    : path.join(os.homedir(), '.config', 'Hyper');

const devConfigFileName = path.join(__dirname, `../hyper.json`);

const fileName =
  process.env.NODE_ENV !== 'production' && fs.existsSync(devConfigFileName)
    ? devConfigFileName
    : path.join(applicationDirectory, 'hyper.json');

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

const getFileContents = memoize(() => {
  return fs.readFileSync(fileName, 'utf8');
});

const pluginNameSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {message: 'Plugin identifiers must not be empty or whitespace-only.'});

const cliConfigSchema = z
  .object({
    plugins: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(pluginNameSchema)).default([]),
    localPlugins: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(pluginNameSchema)).default([])
  })
  .passthrough();

const getParsedFile = memoize(() => parseJson5StrictWithSchema(getFileContents(), cliConfigSchema));

const getPluginsByKey = (key: 'plugins' | 'localPlugins'): PluginSpecifier[] =>
  getParsedFile()[key].map((entry) => pluginSpecifier(entry));

const getPlugins = memoize(() => {
  return getPluginsByKey('plugins');
});

const getLocalPlugins = memoize(() => {
  return getPluginsByKey('localPlugins');
});

function exists() {
  return getFileContents() !== undefined;
}

function isInstalled(plugin: PluginSpecifier, locally?: boolean) {
  const normalizedPlugin = pluginSpecifier(plugin);
  const array = locally ? getLocalPlugins() : getPlugins();
  if (array && Array.isArray(array)) {
    return array.includes(normalizedPlugin);
  }
  return false;
}

function save(config: unknown) {
  return fs.writeFileSync(fileName, stringifyJson5(config), 'utf8');
}

function getPackageName(plugin: PluginSpecifier): PackageName {
  const normalizedPlugin = pluginSpecifier(plugin);
  const isScoped = normalizedPlugin[0] === '@';
  const nameWithoutVersion = normalizedPlugin.split('#')[0];

  if (isScoped) {
    return packageName(`@${nameWithoutVersion.split('@')[1].replace('/', '%2f')}`);
  }

  return packageName(nameWithoutVersion.split('@')[0]);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const npmRegistryResponseSchema = z.object({
  name: z.string().optional(),
  versions: z.unknown().refine((value) => value !== undefined, {message: 'versions must be defined'})
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

function existsOnNpm(plugin: PluginSpecifier, signal?: AbortSignal) {
  const normalizedPlugin = pluginSpecifier(plugin);
  const name = getPackageName(normalizedPlugin);
  return got
    .get<unknown>(registryUrl + name.toLowerCase(), {timeout: {request: 10000}, responseType: 'json', signal})
    .then((res) => {
      const validated = npmRegistryResponseSchema.safeParse(res.body);
      if (!validated.success) {
        return Promise.reject(res);
      } else {
        return res;
      }
    });
}

const handleNpmCheckError = (err: unknown, plugin: PluginSpecifier): Promise<never> => {
  const normalizedPlugin = pluginSpecifier(plugin);
  const statusCode = isRecord(err) && typeof err.statusCode === 'number' ? err.statusCode : undefined;
  if (statusCode && (statusCode === 404 || statusCode === 200)) {
    return Promise.reject(`${normalizedPlugin} not found on npm`);
  }

  const errorMessage = getErrorMessage(err);
  return Promise.reject(`${errorMessage}\nPlugin check failed. Check your internet connection or retry later.`);
};

type InstallOptions = {
  readonly locally?: boolean;
  readonly signal?: AbortSignal;
};

function install(plugin: PluginSpecifier, options: InstallOptions = {}) {
  const {locally = false, signal} = options;
  const normalizedPlugin = pluginSpecifier(plugin);
  const array = locally ? getLocalPlugins() : getPlugins();
  return existsOnNpm(normalizedPlugin, signal)
    .catch((err: unknown) => handleNpmCheckError(err, normalizedPlugin))
    .then(() => {
      if (isInstalled(normalizedPlugin, locally)) {
        return Promise.reject(`${normalizedPlugin} is already installed`);
      }

      const config = getParsedFile();
      config[locally ? 'localPlugins' : 'plugins'] = [...array, normalizedPlugin];
      save(config);
    });
}

async function uninstall(plugin: PluginSpecifier) {
  const normalizedPlugin = pluginSpecifier(plugin);
  if (!isInstalled(normalizedPlugin)) {
    return Promise.reject(`${normalizedPlugin} is not installed`);
  }

  const config = getParsedFile();
  config.plugins = getPlugins().filter((p) => p !== normalizedPlugin);
  save(config);
}

function list() {
  if (getPlugins().length > 0) {
    return getPlugins().join('\n');
  }
  return false;
}

export const configPath = fileName;
export {exists, existsOnNpm, isInstalled, install, uninstall, list, pluginSpecifier};
