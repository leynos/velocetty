import merge from 'lodash/merge';

import type {configOptions, parsedConfig, rawConfig} from '@shared/types/config';
import mapKeys from '../utils/map-keys';

type ConfigNotify = (title: string, body?: string, details?: {error?: unknown}) => void;

// init config
const _init = (userCfg: rawConfig, defaultCfg: rawConfig, notify: ConfigNotify): parsedConfig => {
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
    keymaps: mapKeys({...defaultCfg.keymaps, ...userCfg.keymaps}),
    // Ignore undefined values in plugin and localPlugins array Issue #1862
    plugins: userCfg.plugins?.filter(Boolean) || [],
    localPlugins: userCfg.localPlugins?.filter(Boolean) || []
  };
};

export {_init};
