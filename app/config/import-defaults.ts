/** @file Reads the bundled defaults and the shipped platform keymap, without side effects. */
/*
 * The query is deliberately read-only. It reads the bundled default payload and
 * the platform keymap, but it never creates a directory, copies a schema,
 * bootstraps `config.json5`, notifies the user, or writes to a log sink. Start-up
 * turns the faults this query returns into log lines and notices, so a caller
 * may ask for the defaults at any time without the application acting on them.
 */
import {copySync, existsSync, mkdirpSync, readFileSync, writeFileSync} from 'fs-extra';

import type {configValidationDiagnostic, rawConfig} from '@shared/types/config';
import type {ConfigInspection} from './config-tree';
import {replaceLegacyKeymaps} from './import-keybindings';
import type {ConfigFallbackCause} from './import-report';
import {parseRawConfig} from './import-sources-parse';
import {parseKeybindingsText, toRawKeymaps} from './keybindings-codec';
import type {UserKeymaps} from './keybindings-policy';

export type ConfigImportPaths = {
  cfgDir: string;
  cfgPath: string;
  /**
   * Whether the active config path could be inspected.
   *
   * An `inaccessible` path may hold the user's configuration, so start-up must
   * not create a file that would shadow it.
   */
  configInspection: ConfigInspection;
  defaultCfg: string;
  /** Directory holding `keybindings.json5`; its schema copy belongs beside it. */
  keybindingsDir: string;
  keybindingsPath: string;
  keybindingsSchemaFile: string;
  keybindingsSchemaPath: string;
  defaultPlatformKeyPath: () => string;
  plugs: {
    base: string;
    local: string;
  };
  schemaFile: string;
  schemaPath: string;
  /** Lower-priority config files the active configuration hides. */
  shadowedConfigPaths: readonly string[];
  /** The Velocetty tree, where new configuration files and schema copies go. */
  velocettyDir: string;
};

/** The filesystem subset the loader uses; injected so a query can be proved read-only. */
export type ConfigImportFileSystem = Pick<
  typeof import('fs-extra'),
  'copySync' | 'existsSync' | 'mkdirpSync' | 'readFileSync' | 'writeFileSync'
>;

/** One config source as read, before anything decides whether it applies. */
export type LoadedConfig = {
  config: rawConfig;
  diagnostics: configValidationDiagnostic[];
  /**
   * The text of `config.json5` this payload was read from.
   *
   * Present only when the payload applied, never when it fell back: a fallback
   * describes defaults rather than the file, so claiming the file's text was
   * applied would be false.
   */
  appliedText?: string;
  /** Present only when the payload is a fallback, naming why it fell back. */
  failure?: ConfigFallbackCause;
  usedFallback: boolean;
};

/** A loaded default payload plus what the platform keymap read learned. */
export type LoadedDefaults = LoadedConfig & {
  platformKeymapDiagnostics: readonly configValidationDiagnostic[];
  /** Present only when the platform keymap could not be used. */
  platformKeymapFailure?: ConfigFallbackCause;
  platformKeymapFault: boolean;
};

/** The bundled defaults, with what start-up learned about the shipped files. */
export type DefaultConfigQuery = {
  readonly defaults: rawConfig;
  /** Present when the bundled config file could not be read or parsed. */
  readonly failure?: ConfigFallbackCause;
  /**
   * Whether the shipped platform keymap could not be read or parsed.
   *
   * It is reported separately from `failure` because the two files fail
   * independently: the platform keymap can be missing while the bundled config
   * still applies unchanged.
   */
  readonly platformKeymapFault: boolean;
  /** Present only when the platform keymap could not be used. */
  readonly platformKeymapFailure?: ConfigFallbackCause;
};

/** One shipped-file load: the payload plus whether the file could be used. */
export type PlatformKeymapLoad = {
  readonly diagnostics: readonly configValidationDiagnostic[];
  /** Present only when the file could not be used. */
  readonly failure?: ConfigFallbackCause;
  readonly fault: boolean;
  readonly keymaps: UserKeymaps;
};

/** The filesystem functions a loader may call when the caller injects none. */
export const defaultFileSystem: ConfigImportFileSystem = {
  copySync,
  existsSync,
  mkdirpSync,
  readFileSync,
  writeFileSync
};

const defaultRawConfigFallback: rawConfig = {
  plugins: [],
  localPlugins: []
} as const;

/**
 * Creates an isolated copy of a raw config payload for safe mutation.
 *
 * @example
 * ```ts
 * const copy = cloneRawConfig(defaults);
 * copy.plugins.push('local'); // leaves `defaults` unchanged
 * ```
 */
export const cloneRawConfig = (config: rawConfig): rawConfig => structuredClone(config);

/** What a defaults query needs: where the shipped files live and how to read them. */
export type DefaultConfigQueryDependencies = {
  /** Injected so a test can prove the query writes nothing. */
  fs?: ConfigImportFileSystem;
  paths: ConfigImportPaths;
};

/**
 * Creates the read-only query for the bundled defaults and platform keymap.
 *
 * Each call reads both shipped files afresh rather than reusing an earlier
 * result. A query must not influence what start-up applies: the files are
 * shipped artefacts, and a start-up that reused a query's snapshot could apply
 * a payload the files no longer hold — including a faulted fallback, which it
 * would then persist into `config.json5`. Reading them again costs one small
 * parse and keeps start-up the single authority on what is in effect.
 *
 * @example
 * ```ts
 * const query = createDefaultConfigQuery({paths});
 * const first = query.getDefaultConfig();
 * const second = query.getDefaultConfig();
 * first.defaults === second.defaults; // false, because each caller gets its own copy
 * ```
 */
export const createDefaultConfigQuery = (dependencies: DefaultConfigQueryDependencies) => {
  const fileSystem = dependencies.fs ?? defaultFileSystem;
  const pathDeps = dependencies.paths;

  /**
   * Reads the bundled default config, keeping safe defaults on any error.
   *
   * A missing, unreadable, or invalid bundled file is a packaging fault rather
   * than a user fault, so it is reported and the process continues.
   */
  const loadDefaultConfig = (): LoadedConfig => {
    let defaultCfgRaw: string;
    try {
      defaultCfgRaw = fileSystem.readFileSync(pathDeps.defaultCfg, 'utf8');
    } catch {
      // The fault is returned rather than logged: only the start-up command
      // reports it, so the read-only query stays free of sink emissions.
      // A substituted payload is a fallback even though `{}` would parse, so
      // start-up can tell the user the bundled defaults were never read.
      return {
        config: cloneRawConfig(defaultRawConfigFallback),
        diagnostics: [],
        failure: 'read',
        usedFallback: true
      };
    }

    const filePath = pathDeps.defaultCfg;
    const parsedDefaultConfigResult = parseRawConfig({filePath, rawContent: defaultCfgRaw});

    if (!parsedDefaultConfigResult.usedFallback && parsedDefaultConfigResult.value !== null) {
      return {
        config: parsedDefaultConfigResult.value,
        diagnostics: parsedDefaultConfigResult.diagnostics,
        usedFallback: false
      };
    }

    // The fault is returned rather than announced: only the start-up command
    // tells the user, so the read-only query stays free of notifications.
    return {
      config: cloneRawConfig(defaultRawConfigFallback),
      diagnostics: parsedDefaultConfigResult.diagnostics,
      failure: 'parse',
      usedFallback: true
    };
  };

  /**
   * Reads the shipped per-platform keymap, recording whether it was usable.
   *
   * The fault flag travels with the payload so start-up can tell the user that
   * the platform defaults are missing, rather than silently running without
   * them. It is not announced here: only the start-up command notifies.
   */
  const loadPlatformKeymap = (): PlatformKeymapLoad => {
    const platformKeyPath = pathDeps.defaultPlatformKeyPath();
    let content = '{}';
    try {
      content = fileSystem.readFileSync(platformKeyPath, 'utf8');
    } catch {
      // Reported by the start-up command, never by the read that found it.
      return {diagnostics: [], failure: 'read', fault: true, keymaps: {}};
    }

    const keymapResult = parseKeybindingsText(content, platformKeyPath);
    if (keymapResult.kind === 'invalid') {
      return {diagnostics: keymapResult.diagnostics, failure: 'parse', fault: true, keymaps: {}};
    }
    return {diagnostics: [], fault: false, keymaps: toRawKeymaps(keymapResult.keymaps)};
  };

  /**
   * Reads the bundled defaults and merges the platform keymap.
   *
   * Each call reads both shipped files afresh rather than reusing an earlier
   * result, so a query never becomes a stale snapshot for start-up.
   */
  const readDefaults = (): LoadedDefaults => {
    const loaded = loadDefaultConfig();
    const platform = loadPlatformKeymap();
    replaceLegacyKeymaps(loaded.config, platform.keymaps);
    const defaults: LoadedDefaults = {
      ...loaded,
      platformKeymapDiagnostics: platform.diagnostics,
      platformKeymapFault: platform.fault
    };
    // Added only when the keymap actually failed, never as `undefined`.
    if (platform.failure !== undefined) {
      Object.assign(defaults, {platformKeymapFailure: platform.failure});
    }
    return defaults;
  };

  /**
   * Describes the bundled defaults without writing, logging, or notifying.
   *
   * Both shipped-file faults are part of the result: a caller that needs a
   * usable payload can still read `config`, while one that reports health has
   * the cause instead of guessing. The start-up command turns those causes
   * into log lines and notices, so a query never reaches a sink.
   *
   * @example
   * ```ts
   * const defaults = query.getDefaultConfig();
   * defaults.defaults.keymaps; // the platform bindings, merged into the defaults
   * ```
   */
  const loadDefaultsOnly = (): DefaultConfigQuery => {
    const loaded = readDefaults();
    const result: DefaultConfigQuery = {
      defaults: cloneRawConfig(loaded.config),
      platformKeymapFault: loaded.platformKeymapFault
    };
    // Added only when the bundled file actually fell back, never as `undefined`.
    if (loaded.failure !== undefined) {
      Object.assign(result, {failure: loaded.failure});
    }
    if (loaded.platformKeymapFailure !== undefined) {
      Object.assign(result, {platformKeymapFailure: loaded.platformKeymapFailure});
    }
    return result;
  };

  /**
   * Returns a defensive copy of the bundled defaults and their health.
   *
   * The query is read-only: it reads the bundled defaults and the platform
   * keymap, but never creates a directory, copies a schema, or bootstraps
   * `config.json5`, and it never notifies the user or writes to the warning
   * and error sinks. A fault is logged and announced by the start-up command
   * instead. It also never starts the keybindings service, so querying
   * defaults cannot seed or re-read `keybindings.json5`. Nothing is retained
   * between calls, so a later start-up applies what the files hold then rather
   * than what an earlier query saw.
   *
   * @example
   * ```ts
   * const first = query.getDefaultConfig();
   * const second = query.getDefaultConfig();
   * first.defaults === second.defaults; // false, because each caller gets its own copy
   * first.failure; // undefined when the bundled file was read and parsed
   * ```
   */
  const getDefaultConfig = (): DefaultConfigQuery => loadDefaultsOnly();

  return {getDefaultConfig, readDefaults};
};
