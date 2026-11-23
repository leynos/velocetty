/** @file Read-only queries over the configuration the last import applied. */
/*
 * These helpers are the application's whole read surface for configuration.
 * They read the process-wide applied state rather than a snapshot, so a window
 * that opens after a reload sees the configuration in effect. Each one is a
 * plain function over that state, which keeps the composition root free to do
 * nothing but construct adapters and wire them together.
 */
import type {ColorMap, configOptions} from '@shared/types/config';

import {isJsonObject} from '../utils/runtime-guards';
import {getCurrentConfig, hasCurrentConfig} from './current-config';
import {fixConfigDefaults as applyConfigDefaults} from './fix-config-defaults';
import _openConfig from './open';
import {cfgDir} from './paths';

/** Shows a title and body to the user; the warning paths take it as a dependency. */
export type ConfigWarningNotifier = (title: string, body: string) => void;

/**
 * Lists the deprecated CSS class names the configuration still uses.
 *
 * @param config - The decorated configuration to inspect.
 * @returns The deprecated names found in `css` or `termCSS`, in a fixed order.
 *
 * @example
 * ```ts
 * getDeprecatedCSS({css: '.x-screen {}', termCSS: ''} as configOptions); // ['x-screen']
 * ```
 */
export const getDeprecatedCSS = (config: configOptions) => {
  const deprecated: string[] = [];
  const deprecatedCSS = ['x-screen', 'x-row', 'cursor-node', '::selection'];
  deprecatedCSS.forEach((css) => {
    if (config.css.includes(css) || config.termCSS.includes(css)) {
      deprecated.push(css);
    }
  });
  return deprecated;
};

/**
 * Warns once when the active configuration uses deprecated CSS classes.
 *
 * Silent before start-up has stored a configuration, so a query cannot warn.
 *
 * @param notify - Shows the warning to the user.
 *
 * @example
 * ```ts
 * checkDeprecatedConfig(notify); // notifies only when a deprecated class is in use
 * ```
 */
export const checkDeprecatedConfig = (notify: ConfigWarningNotifier) => {
  if (!hasCurrentConfig()) {
    return;
  }
  const deprecated = getDeprecatedCSS(getCurrentConfig().config);
  if (deprecated.length === 0) {
    return;
  }
  const deprecatedStr = deprecated.join(', ');
  notify('Configuration warning', `Your configuration uses some deprecated CSS classes (${deprecatedStr})`);
};

/**
 * Returns the active configuration directory.
 *
 * Plugins load from here, so it names the tree the running configuration came
 * from rather than the Velocetty tree unconditionally.
 *
 * @example
 * ```ts
 * getConfigDir(); // '/home/ada/.config/Velocetty'
 * ```
 */
export const getConfigDir = () => {
  // expose config directory to load plugin from the right place
  return cfgDir;
};

/**
 * Returns the name of the profile the application starts with.
 *
 * Falls back to the first configured profile, then to `default`, so a config
 * that names no profile still resolves to something usable.
 *
 * @example
 * ```ts
 * getDefaultProfile(); // 'default'
 * ```
 */
export const getDefaultProfile = () => {
  const {config} = getCurrentConfig();
  return config.defaultProfile || config.profiles[0]?.name || 'default';
};

/**
 * Returns the merged configuration for the default profile.
 *
 * Kept for backward compatibility with callers that predate profiles.
 *
 * @example
 * ```ts
 * getConfig().colors; // the default profile's colours
 * ```
 */
export const getConfig = () => {
  return getProfileConfig(getDefaultProfile());
};

/**
 * Returns every configured profile.
 *
 * @example
 * ```ts
 * getProfiles().map(({name}) => name); // ['default']
 * ```
 */
export const getProfiles = () => {
  return getCurrentConfig().config.profiles;
};

/** The settings a profile is allowed to override in the root configuration. */
type ProfileOverrideKey = keyof configOptions['profiles'][number]['config'];

/**
 * Merges one profile over the root configuration.
 *
 * Object-valued settings merge key by key, so a profile can recolour one entry
 * without restating the rest; every other setting replaces the root value.
 *
 * @param profileName - The profile to merge; an unknown name contributes nothing.
 * @returns A new configuration with the profile's overrides applied.
 *
 * @example
 * ```ts
 * getProfileConfig('default').colors; // root colours plus the profile's overrides
 * ```
 */
export const getProfileConfig = (profileName: string): configOptions => {
  const {profiles, defaultProfile, ...baseConfig} = getCurrentConfig().config;
  const profileConfig = profiles.find((candidate) => candidate.name === profileName)?.config ?? {};
  const merged: configOptions = {...baseConfig, defaultProfile, profiles};

  // A profile overrides only the settings it names. Object-valued settings
  // (`colors`, `env`, `modifierKeys`) merge with the base so a profile can
  // recolour one entry; every other setting replaces the base value outright.
  // SAFETY: `profileConfig` is a `Partial<profileConfigOptions>`, so every
  // enumerable key it carries is a profile setting; `Object.keys` only loses
  // that fact because it widens the key type to `string`.
  for (const key of Object.keys(profileConfig) as ProfileOverrideKey[]) {
    const baseValue = merged[key];
    const overrideValue = profileConfig[key];
    const mergedValue =
      isJsonObject(baseValue) && isJsonObject(overrideValue) ? {...baseValue, ...overrideValue} : overrideValue;
    Object.assign(merged, {[key]: mergedValue});
  }

  return merged;
};

/**
 * Opens the active configuration file in the user's editor.
 *
 * @example
 * ```ts
 * openConfig(); // launches the configured editor on config.json5
 * ```
 */
export const openConfig = () => {
  return _openConfig();
};

/**
 * Returns the plugins the active configuration enables.
 *
 * @example
 * ```ts
 * getPlugins(); // {plugins: ['hyper-simple'], localPlugins: []}
 * ```
 */
export const getPlugins = () => {
  const currentConfig = getCurrentConfig();
  return {
    plugins: currentConfig.plugins,
    localPlugins: currentConfig.localPlugins
  };
};

/**
 * Returns the keymaps the running configuration applies.
 *
 * @example
 * ```ts
 * getKeymaps(); // {'window:new': ['ctrl+shift+n']}
 * ```
 */
export const getKeymaps = () => {
  return getCurrentConfig().keymaps;
};

/**
 * Fills the colours the decorated configuration leaves unset.
 *
 * The terminal needs a colour for every xterm CSS slot, so the palette the
 * configuration import applied supplies any the user did not override. The
 * palette is a parameter rather than a fresh bundled-file read: decoration
 * happens whenever a window or the preferences editor opens, and those must
 * not depend on a second read of a file the import already read.
 *
 * @param decoratedConfig - The configuration to complete, mutated in place.
 * @param appliedColors - The colours the applied configuration supplies;
 *   absent or partial when the bundled config could not be read.
 * @returns The same configuration with a full colour map.
 *
 * @example
 * ```ts
 * fixConfigDefaults({colors: {}} as configOptions, {black: '#000'}).colors.black; // '#000'
 * ```
 */
export const fixConfigDefaults = (decoratedConfig: configOptions, appliedColors?: Partial<ColorMap>) =>
  // A bundled config that could not be read or parsed has no `config` section,
  // so the palette is absent rather than merely incomplete. Keep the user's
  // own colours instead of dereferencing `undefined`.
  applyConfigDefaults(decoratedConfig, appliedColors);

/**
 * Decorates a profile's configuration, then completes its colour map.
 *
 * The palette the import applied is copied before the decorator runs, so a
 * plugin that removes a colour cannot also remove the default it should fall
 * back to. The copied palette is the decoration's only default source: a
 * second read of the bundled file would let a later read fault change the
 * colours of an already-running window.
 *
 * The configuration itself is cloned before the decorator sees it.
 * `getProfileConfig` copies only the top level, so its nested settings still
 * alias the applied configuration; a decorator is plugin code and must not be
 * able to rewrite what every later window reads.
 *
 * @param profileName - The profile to decorate.
 * @param decorate - The plugin decoration to apply first.
 * @returns The decorated configuration with a complete colour map.
 *
 * @example
 * ```ts
 * decorateProfileConfig('default', (config) => ({...config, colors: {}})).colors.black; // the applied black
 * ```
 */
export const decorateProfileConfig = (
  profileName: string,
  decorate: (decoratedConfig: configOptions) => configOptions
): configOptions => {
  const baseConfig = structuredClone(getProfileConfig(profileName));
  const appliedColors = {...baseConfig.colors};
  return fixConfigDefaults(decorate(baseConfig), appliedColors);
};

/**
 * Rewrites legacy hterm CSS selectors to their current equivalents.
 *
 * @param config - The configuration whose `css` and `termCSS` are rewritten.
 * @returns The same configuration with the selectors translated.
 *
 * @example
 * ```ts
 * htermConfigTranslate({css: '.x-screen {}', termCSS: ''} as configOptions).css; // '.xterm-rows > div {}'
 * ```
 */
export const htermConfigTranslate = (config: configOptions) => {
  const cssReplacements = {
    'x-screen x-row([ {.[])': '.xterm-rows > div$1',
    '.cursor-node([ {.[])': '.terminal-cursor$1',
    '::selection([ {.[])': '.terminal .xterm-selection div$1',
    'x-screen a([ {.[])': '.terminal a$1',
    'x-row a([ {.[])': '.terminal a$1'
  };
  Object.entries(cssReplacements).forEach(([pattern, newvalue]) => {
    const searchvalue = new RegExp(pattern, 'g');
    config.css = config.css.replace(searchvalue, newvalue);
    config.termCSS = config.termCSS.replace(searchvalue, newvalue);
  });
  return config;
};
