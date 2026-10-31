/** @file Turns raw user configuration into the profile and keymap shape the app expects. */
/*
 * `_init` merges the user's `config` object over the bundled defaults, repairs
 * the profile list, and normalises legacy keymaps. The configuration importer
 * calls it once per import, and a missing `config` key is reported through the
 * injected notifier rather than thrown.
 */

import merge from 'lodash/merge';

import type {configOptions, parsedConfig, rawConfig} from '@shared/types/config';
import mapKeys from '../utils/map-keys';
import {readLegacyKeymaps} from './import-keybindings';
import type {ConfigImportNotify} from './keybindings';

/**
 * Merges the user configuration over the bundled defaults.
 *
 * The user's profiles are repaired in place: a missing `defaultProfile` or
 * profile name is filled in, and a `defaultProfile` that names no profile
 * falls back to the first one. Legacy keymaps from both sources are merged
 * last, so a user binding wins over the bundled platform binding.
 *
 * @param userCfg - The parsed user configuration.
 * @param defaultCfg - The bundled default configuration.
 * @param notify - Reports a missing `config` key to the user.
 * @returns The effective configuration for this import.
 *
 * @example
 * ```ts
 * _init({config: {}}, {config: {profiles: []}}, notify); // default profile filled in
 * ```
 */
const _init = (userCfg: rawConfig, defaultCfg: rawConfig, notify: ConfigImportNotify): parsedConfig => {
  return {
    config: (() => {
      if (userCfg.config) {
        const conf = userCfg.config;
        conf.defaultProfile = conf.defaultProfile || 'default';
        conf.profiles = conf.profiles || [];
        conf.profiles = conf.profiles.length > 0 ? conf.profiles : [{name: 'default', config: {}}];
        conf.profiles = conf.profiles.map((p, i) => ({
          ...p,
          name: p.name || `profile-${i + 1}`,
          config: p.config
        }));
        if (!conf.profiles.map((p) => p.name).includes(conf.defaultProfile)) {
          conf.defaultProfile = conf.profiles[0].name;
        }
        // SAFETY: The bundled default config supplies every required option;
        // the user config is a validated partial override of that default.
        return merge({}, defaultCfg.config, conf) as configOptions;
      } else {
        notify('Error reading configuration: `config` key is missing');
        // SAFETY: The bundled default config is complete when present. The
        // empty fallback preserves the existing recovery path for missing data.
        return (defaultCfg.config || {}) as configOptions;
      }
    })(),
    // Merging platform specific keymaps with user defined keymaps
    keymaps: mapKeys({...readLegacyKeymaps(defaultCfg), ...readLegacyKeymaps(userCfg)}),
    // Ignore undefined values in plugin and localPlugins array Issue #1862
    plugins: userCfg.plugins?.filter(Boolean) || [],
    localPlugins: userCfg.localPlugins?.filter(Boolean) || []
  };
};

export {_init};
