/** @file Completes a decorated configuration's colours from bundled defaults. */
/*
 * The terminal needs a colour for every xterm CSS slot, so the bundled
 * defaults supply any the user did not override. The bundled colours are a
 * parameter rather than a module import: the composition root reads them from
 * the bundled config, and a test can supply a partial or absent palette
 * without loading Electron.
 */
import type {ColorMap, configOptions} from '@shared/types/config';

import {withDefaultColors} from '../utils/colours';

/**
 * Fills the colours the decorated configuration leaves unset.
 *
 * A bundled config that could not be read or parsed has no `colors` section,
 * so the defaults are absent rather than merely incomplete. The user's own
 * colours always win, and the result is always a complete map.
 *
 * @param decoratedConfig - The configuration to complete, mutated in place.
 * @param defaultColors - The bundled defaults; absent or partial when the
 * bundled config could not be read.
 * @returns The same configuration with a full colour map.
 *
 * @example
 * ```ts
 * fixConfigDefaults({colors: {}} as configOptions, {black: '#000'}).colors.black; // '#000'
 * ```
 */
export const fixConfigDefaults = (decoratedConfig: configOptions, defaultColors?: Partial<ColorMap>): configOptions => {
  decoratedConfig.colors = withDefaultColors(decoratedConfig.colors, defaultColors);
  return decoratedConfig;
};
