/**
 * @file Built-in renderer command that closes a session's search overlay.
 *
 * Responsibilities:
 * - Close the search overlay for an explicit session `uid`, or for the active
 *   session when no arguments are supplied.
 * - Release the keystroke back to the terminal when there is nothing to close,
 *   so Escape still reaches the shell.
 *
 * Invariants:
 * - The command closes at most one session's search per invocation.
 * - The key event is cleared only when the command did not close a search
 *   overlay, which is what keeps Escape working as a terminal key.
 *
 * Usage:
 * - Registered by the command-registry singleton for `editor:search-close`.
 *   Escape binds it with no arguments, which the dispatcher delivers as
 *   `null`; the search box close button supplies `{uid}`.
 *
 * Related modules:
 * - `./command-registry.ts` registers it and owns the definition.
 * - `../shared/src/types/commands.ts` declares the argument schema contract.
 */
import type {HyperDispatch, HyperState} from '../../typings/hyper';
import {SESSION_SEARCH} from '@shared/constants/sessions';
import {asSessionId} from '@shared/types/common';
import {isBoolean, isObject, isString} from '@shared/types/guards';
import {isJsonObject, type JsonObject} from '@shared/types/json';

/** The minimal key-event shape a legacy handler may mutate to release a key. */
export interface SearchCloseKeyEvent {
  catched?: boolean;
}

export const SEARCH_CLOSE_COMMAND_ID = 'editor:search-close';

/**
 * JSON Schema for `editor:search-close` arguments.
 *
 * `null` is admitted alongside an object because Escape binds the command with
 * no arguments, and the dispatcher normalizes absent arguments to `null`.
 */
export const SEARCH_CLOSE_ARGS_SCHEMA: JsonObject = {
  type: ['object', 'null'],
  properties: {
    uid: {type: 'string', minLength: 1}
  },
  additionalProperties: false
};

const isSearchKeyEvent = (candidate: unknown): candidate is SearchCloseKeyEvent =>
  isObject(candidate) && (!('catched' in candidate) || isBoolean(candidate.catched));

/**
 * Narrows dispatcher arguments to a session uid.
 *
 * Returns `undefined` for `null`, which the command treats as "the active
 * session", and for any malformed payload, which the args schema has already
 * rejected by the time a handler runs.
 */
export const searchCloseUid = (args: unknown): string | undefined => {
  if (!isJsonObject(args)) {
    return undefined;
  }
  const candidate = args.uid;
  return isString(candidate) && candidate.length > 0 ? candidate : undefined;
};

/** Shape of the thunk builder the registry injects, kept injectable for tests. */
export type CloseSearchAction = (
  uid?: string,
  keyEvent?: SearchCloseKeyEvent
) => (dispatch: HyperDispatch, getState: () => HyperState) => void;

/**
 * Builds the thunk that closes one session's search overlay.
 *
 * When the target session is not searching, the key event is released by
 * setting `catched` to `false` so xterm still receives the keystroke.
 */
export const closeSearchAction: CloseSearchAction =
  (uid, keyEvent) => (dispatch: HyperDispatch, getState: () => HyperState) => {
    const targetUid = uid ?? getState().sessions.activeUid;
    if (!targetUid) {
      // No active session yet — propagate the key event and bail.
      if (keyEvent) {
        keyEvent.catched = false;
      }
      return;
    }

    if (getState().sessions.sessions[targetUid]?.search) {
      dispatch({
        type: SESSION_SEARCH,
        uid: asSessionId(targetUid),
        value: false
      });
      return;
    }

    if (keyEvent) {
      keyEvent.catched = false;
    }
  };

export interface SearchCloseHandlerDependencies {
  readonly closeSearch: CloseSearchAction;
  readonly focusActiveTerm: () => void;
}

/**
 * Builds the legacy `(event, dispatch)` handler the registry stores for
 * `editor:search-close`.
 *
 * Both collaborators are injected rather than reached through globals, so the
 * registry keeps its single seam for tests and this module stays pure.
 */
export const createSearchCloseHandler =
  (dependencies: SearchCloseHandlerDependencies) => (event: unknown, dispatch: HyperDispatch) => {
    dispatch(dependencies.closeSearch(undefined, isSearchKeyEvent(event) ? event : undefined));
    dependencies.focusActiveTerm();
  };
