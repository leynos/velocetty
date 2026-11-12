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

/**
 * Writes a marker line only when the end-to-end lane is running.
 *
 * The marker stream is the lane's only observation surface: the test reads the
 * child process's standard output, so every assertion is a line printed here.
 *
 * @example
 * ```ts
 * emitE2EMarker('[e2e] renderer-ready'); // prints only under RUN_E2E=1
 * ```
 */
export const emitE2EMarker = (line: string): void => {
  if (isE2ERun()) {
    console.log(line);
  }
};

/** The reload status vocabulary the marker reports. */
export type E2EKeymapStatus = 'applied' | 'kept';

/**
 * The request token of the press whose command is being dispatched.
 *
 * The lane writes `#<ordinal>` before each chord and the probe repeats that
 * token in its reply, so the same token on the command marker is what lets a
 * scenario prove that this press, not an earlier one, ran the command. It is
 * cleared as soon as the press returns, so a marker printed outside a press
 * keeps its original, untagged shape.
 */
let currentPressToken: string | undefined;

/** Records the request token of the press now being handled, if any. */
export const setCurrentPressToken = (token: string | undefined): void => {
  currentPressToken = token;
};

/**
 * Formats the marker a command handler prints when it runs.
 *
 * The token is appended only while a press is being handled: the harness can
 * then require the marker for the exact request it sent, rather than accepting
 * any marker for the command, which a late press could have printed.
 *
 * @example
 * ```ts
 * setCurrentPressToken('#7');
 * formatCommandExecutedMarker('window:new'); // '[e2e] command-executed window:new press=#7'
 * setCurrentPressToken(undefined);
 * formatCommandExecutedMarker('window:new'); // '[e2e] command-executed window:new'
 * ```
 */
export const formatCommandExecutedMarker = (command: string): string =>
  currentPressToken === undefined
    ? `[e2e] command-executed ${command}`
    : `[e2e] command-executed ${command} press=${currentPressToken}`;

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
