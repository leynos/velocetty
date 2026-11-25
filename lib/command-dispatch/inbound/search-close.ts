/**
 * @file The search box close button's route into the dispatcher.
 *
 * Responsibilities:
 * - Invoke `editor:search-close` with the owning session's uid, so the button
 *   travels exactly the path a keybinding does.
 * - Fall back to the caller's local teardown when no dispatcher is available —
 *   a plugin-rendered subtree or a unit test — so the button still works.
 *
 * Invariants:
 * - The command owns the state change; the caller keeps its local teardown.
 * - The invocation is fire-and-forget: a close button has nothing to do with a
 *   failure result beyond the dispatcher's own logging.
 *
 * Usage:
 * - `lib/components/term.tsx` binds `close={requestSearchClose(...)}`.
 *
 * Related modules:
 * - `../../commands/search-close.ts` owns the command.
 * - `../compose.ts` supplies the bundle.
 */
import {asCommandId} from '@shared/types/commands';
import {SEARCH_CLOSE_COMMAND_ID} from '../../commands/search-close';
import type {RendererDispatcherBundle} from '../compose';

/** Runs `editor:search-close` for `uid`, or `fallback` without a dispatcher. */
export const requestSearchClose = (
  bundle: RendererDispatcherBundle | undefined,
  uid: string,
  fallback: () => void
): void => {
  if (!bundle) {
    fallback();
    return;
  }

  void bundle.dispatcher.invoke(
    {id: asCommandId(SEARCH_CLOSE_COMMAND_ID), args: {uid}, source: 'ui'},
    {},
    {triggerEvent: undefined}
  );
};
