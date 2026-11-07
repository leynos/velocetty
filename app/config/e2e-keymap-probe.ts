/** @file The keybinding probe the end-to-end lane reports after every reload. */
/*
 * The probe is deliberately a command and shortcut that no shipped keymap
 * binds, so a marker that reports it can only have come from the user's file.
 * The unit test beside the E2E suite proves that precondition still holds.
 */

/** The only command the end-to-end lane reports. */
export const E2E_KEYMAP_PROBE = 'window:new';

/** The shortcut the E2E scenarios write; no shipped keymap may contain it. */
export const E2E_PROBE_SHORTCUT = 'ctrl+alt+shift+n';

/** Whether this process was started by the end-to-end lane. */
export const isE2ERun = (): boolean => process.env.RUN_E2E === '1';

/** The reload status vocabulary the marker reports. */
export type E2EKeymapStatus = 'applied' | 'kept';

/**
 * Formats the keymaps marker for one reload.
 *
 * @example
 * ```ts
 * formatKeymapsMarker('applied', {'window:new': ['ctrl+alt+shift+n']});
 * // '[e2e] keymaps-active status=applied window:new=ctrl+alt+shift+n'
 * ```
 */
export const formatKeymapsMarker = (
  status: E2EKeymapStatus,
  keymaps: Readonly<Record<string, readonly string[]>>
): string => {
  const shortcuts = keymaps[E2E_KEYMAP_PROBE] ?? [];
  return `[e2e] keymaps-active status=${status} ${E2E_KEYMAP_PROBE}=${shortcuts.join(',')}`;
};
