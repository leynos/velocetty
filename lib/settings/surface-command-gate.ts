/**
 * @file Decides which commands may run while the settings surface is active.
 *
 * Settings is a tab, not a modal, so the window must stay usable: tab
 * movement, window commands, zoom, and preferences all keep working. Every
 * other command is ignored, and — deliberately — does not call
 * `preventDefault`, so typing, `Home`, `End`, and `Ctrl+C` behave natively in
 * the search box and never reach a hidden terminal.
 */

import type {CommandId} from '@shared/types/commands';

/** Commands that keep working while the settings surface owns input. */
const SETTINGS_SURFACE_COMMANDS: ReadonlySet<string> = new Set<string>([
  'tab:new',
  'tab:next',
  'tab:prev',
  'tab:jump:1',
  'tab:jump:2',
  'tab:jump:3',
  'tab:jump:4',
  'tab:jump:5',
  'tab:jump:6',
  'tab:jump:7',
  'tab:jump:8',
  'tab:jump:9',
  'window:new',
  'window:minimize',
  'window:close',
  'window:preferences',
  'window:openConfigFile',
  'window:toggleFullScreen',
  'window:reload',
  'window:reloadFull',
  'window:devtools',
  'window:hamburgerMenu',
  'zoom:in',
  'zoom:out',
  'zoom:reset',
  'plugins:update'
]);

/**
 * Reports whether a command keeps working on the settings surface.
 *
 * @param command - The command id about to run.
 * @returns True when the command is on the global allow-list.
 *
 * @example
 * isAllowedOnSettingsSurface('tab:next'); // true
 * isAllowedOnSettingsSurface('editor:paste'); // false
 */
export const isAllowedOnSettingsSurface = (command: CommandId | string): boolean =>
  SETTINGS_SURFACE_COMMANDS.has(command);

/**
 * Reports whether a command must be ignored while settings is active.
 *
 * `pane:close` is not gated: it closes the settings tab itself.
 *
 * @param command - The command id about to run.
 * @returns True when the command must be ignored and must not prevent default.
 *
 * @example
 * isSettingsSurfaceGated('editor:paste'); // true
 * isSettingsSurfaceGated('pane:close'); // false
 */
export const isSettingsSurfaceGated = (command: CommandId | string): boolean =>
  command !== 'pane:close' && !isAllowedOnSettingsSurface(command);
