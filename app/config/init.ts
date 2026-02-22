import merge from 'lodash/merge';

import type {parsedConfig, rawConfig, configOptions} from '@shared/types/config';
import notify from '../notify';
import mapKeys from '../utils/map-keys';

// init config
const _init = (userCfg: rawConfig, defaultCfg: rawConfig): parsedConfig => {
  return {
    config: (() => {
      if (userCfg?.config) {
        const conf = userCfg.config;
        conf.defaultProfile = conf.defaultProfile || 'default';
        conf.profiles = conf.profiles || [];
        conf.profiles = conf.profiles.length > 0 ? conf.profiles : [{name: 'default', config: {}}];
        conf.profiles = conf.profiles.map((p, i) => ({
          ...p,
          name: p.name || `profile-${i + 1}`,
          config: p.config || {}
        }));
        if (!conf.profiles.map((p) => p.name).includes(conf.defaultProfile)) {
          conf.defaultProfile = conf.profiles[0].name;
        }
        return merge({}, defaultCfg.config, conf);
      } else {
        notify('Error reading configuration: `config` key is missing');
        return defaultCfg.config || ({} as configOptions);
      }
    })(),
    // Merging platform specific keymaps with user defined keymaps
    keymaps: mapKeys({...defaultCfg.keymaps, ...userCfg?.keymaps}),
    // Ignore undefined values in plugin and localPlugins array Issue #1862
    plugins: userCfg?.plugins?.filter(Boolean) || [],
    localPlugins: userCfg?.localPlugins?.filter(Boolean) || []
  };
};

export {_init};
