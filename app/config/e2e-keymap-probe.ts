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

// The marker stream lives in `e2e-marker-sink`; it is re-exported here so this
// probe's importers keep naming the lane's markers through one specifier.
export {emitE2EMarker, isE2ERun} from './e2e-marker-sink';

/** The reload status vocabulary the marker reports. */
export type E2EKeymapStatus = 'applied' | 'kept';

/**
 * The request token of the press whose command is being dispatched.
 *
 * The lane writes `#<ordinal>` before each chord and the probe repeats that
 * token in its reply, so the same token on the command marker is what lets a
 * scenario prove that this press, not an earlier one, ran the command. The
 * token travels with the command message rather than with the press that is
 * sending, so a command whose handler lands while a later press is running
 * still prints its own token, and a message that carries none keeps the
 * original, untagged shape.
 */
let currentPressToken: string | undefined;

/**
 * Runs `handle` with `token` as the current press token, then restores it.
 *
 * The token belongs to the message being handled, not to whichever press the
 * probe happens to be sending, so binding it around the synchronous dispatch
 * is what attributes the marker a command handler prints to the press that
 * sent that command. Restoring rather than clearing keeps a nested dispatch
 * honest, and an untagged message runs with no token at all.
 *
 * @param token - The token the message carried, or `undefined` when it had none.
 * @param handle - The synchronous work that may print a marker.
 * @returns Whatever `handle` returns.
 *
 * @example
 * ```ts
 * withPressToken('#7', () => formatCommandExecutedMarker('window:new'));
 * // '[e2e] command-executed window:new press=#7'
 * withPressToken(undefined, () => formatCommandExecutedMarker('window:new'));
 * // '[e2e] command-executed window:new'
 * ```
 */
export const withPressToken = <Value>(token: string | undefined, handle: () => Value): Value => {
  const previous = currentPressToken;
  currentPressToken = token;
  try {
    return handle();
  } finally {
    currentPressToken = previous;
  }
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
 * withPressToken('#7', () => formatCommandExecutedMarker('window:new'));
 * // '[e2e] command-executed window:new press=#7'
 * withPressToken(undefined, () => formatCommandExecutedMarker('window:new'));
 * // '[e2e] command-executed window:new'
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
