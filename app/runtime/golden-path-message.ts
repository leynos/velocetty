/** @file Resolves the message the golden-path demo command announces. */
/*
 * The message is a query over the active configuration, so it lives beside the
 * plugin runtime rather than in the command table: the table takes the resolved
 * message as a dependency and never reads the configuration itself.
 */
import {getConfig} from '../config';
import {isString} from '../utils/runtime-guards';
import {GOLDEN_PATH_PLUGIN_ID, goldenPathSettingsDefaults} from './golden-path-demo';
import {getRuntimePluginSettings} from './plugin-runtime';

/**
 * Resolves the message the golden-path demo command announces.
 *
 * The runtime plugin settings may carry a user-supplied message, so the
 * bundled default is the fallback rather than an empty notification.
 *
 * @returns The configured message, or the bundled default when none is set.
 *
 * @example
 * ```ts
 * // With no plugin settings persisted, start-up announcements use the bundled text.
 * getGoldenPathNotificationMessage(); // goldenPathSettingsDefaults.message
 * ```
 */
export const getGoldenPathNotificationMessage = (): string => {
  const runtimeSettings = getRuntimePluginSettings(getConfig(), GOLDEN_PATH_PLUGIN_ID);
  const configuredMessage = runtimeSettings.message;
  if (isString(configuredMessage) && configuredMessage.trim().length > 0) {
    return configuredMessage;
  }
  return goldenPathSettingsDefaults.message;
};
