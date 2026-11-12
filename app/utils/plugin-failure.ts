/** @file Bounded text for a plugin that could not be loaded. */
/*
 * A plugin lives in a directory the user named, and an error raised while
 * loading it can quote that directory's path. Neither the notification body
 * nor the console line may repeat it: the notification is user-facing text
 * that is also copied into support reports, and the console line is read by
 * whoever has the terminal. Both take the plugin's directory name, which
 * identifies it, plus a fixed failure token.
 */
import {describeError} from './error-code';

/**
 * Describes a plugin load failure without its path or raw message.
 *
 * The failure token is the error's errno code when it carries a known one, and
 * nothing otherwise: an arbitrary string could itself quote the path, so an
 * unrecognized code is dropped rather than echoed. The bounded error name is
 * also omitted, because `Error` alone tells the reader nothing.
 *
 * @param pluginName - The plugin directory's name, which identifies it.
 * @param error - The value the load threw.
 * @returns A sentence naming the plugin, with a code when one is bounded.
 *
 * @example
 * ```ts
 * pluginLoadFailureText('hyper-cwd', Object.assign(new Error('ENOENT: /home/ada'), {code: 'ENOENT'}));
 * // 'Plugin "hyper-cwd" failed to load (ENOENT).'
 * pluginLoadFailureText('hyper-cwd', new Error('MODULE_NOT_FOUND: /home/ada/x'));
 * // 'Plugin "hyper-cwd" failed to load.'
 * ```
 */
export const pluginLoadFailureText = (pluginName: string, error: unknown): string => {
  const {code} = describeError(error);
  return code === undefined
    ? `Plugin "${pluginName}" failed to load.`
    : `Plugin "${pluginName}" failed to load (${code}).`;
};
