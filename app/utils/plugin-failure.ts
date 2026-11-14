/** @file Bounded text for a plugin that could not be loaded. */
/*
 * A plugin lives in a directory the user named, and an error raised while
 * loading it can quote that directory's path. Neither the notification body
 * nor the console line may repeat it: the notification is user-facing text
 * that is also copied into support reports, and the console line is read by
 * whoever has the terminal.
 *
 * The two sinks identify the plugin differently. A notification names it,
 * because the reader has to act on it and already chose that name. A console
 * line numbers it instead: the name is arbitrary user text, so a log gets a
 * position in the configured list, which is bounded and still points at the
 * entry to fix.
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

/**
 * Describes a plugin load failure for the console, without its name or path.
 *
 * The number is the plugin's position in the configured list, counted from
 * one, which is enough to find the entry without repeating user text. The
 * failure token follows the same rule as the notification: an errno code when
 * the error carries a bounded one, and nothing otherwise.
 *
 * @param ordinal - The plugin's position in the configured list, from one.
 * @param error - The value the load threw.
 * @returns A sentence numbering the plugin, with a code when one is bounded.
 *
 * @example
 * ```ts
 * pluginFailureLogText(3, Object.assign(new Error('ENOENT: /home/ada/secret'), {code: 'ENOENT'}));
 * // 'Plugin 3 failed to load (ENOENT).'
 * pluginFailureLogText(4, new Error('nope'));
 * // 'Plugin 4 failed to load.'
 * ```
 */
export const pluginFailureLogText = (ordinal: number, error: unknown): string => {
  const {code} = describeError(error);
  return code === undefined ? `Plugin ${ordinal} failed to load.` : `Plugin ${ordinal} failed to load (${code}).`;
};

/**
 * Says a plugin directory has no package metadata, without naming it.
 *
 * @param ordinal - The plugin's position in the configured list, from one.
 * @returns A console sentence that identifies the plugin by position.
 *
 * @example
 * ```ts
 * pluginMetadataWarning(3); // 'No package.json found for plugin 3.'
 * ```
 */
export const pluginMetadataWarning = (ordinal: number): string => `No package.json found for plugin ${ordinal}.`;

/**
 * Says a plugin loaded, identifying it by position rather than name.
 *
 * The directory name and the version both come from the configured plugin, so
 * neither belongs in a console line: the position locates the entry in the
 * list the user can edit, and carries no user text.
 *
 * @param ordinal - The plugin's position in the configured list, from one.
 * @returns A console sentence that identifies the plugin by position.
 *
 * @example
 * ```ts
 * pluginLoadedText(3); // 'Plugin 3 loaded.'
 * ```
 */
export const pluginLoadedText = (ordinal: number): string => `Plugin ${ordinal} loaded.`;
