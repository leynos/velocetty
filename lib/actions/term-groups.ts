/** @file Terminal group action creators and split-session orchestration. */
import {asProfileId, asSessionId, asTermGroupId} from '@shared/types/common';
import {SESSION_REQUEST} from '@shared/constants/sessions';
import {
  DIRECTION,
  TERM_GROUP_RESIZE,
  TERM_GROUP_REQUEST,
  TERM_GROUP_EXIT,
  TERM_GROUP_EXIT_ACTIVE
} from '@shared/constants/term-groups';
import type {ITermState, ITermGroup, HyperState, HyperDispatch, HyperActions} from '../../typings/hyper';
import type {SplitRequestParams} from '../types/request-shapes';
import {transport} from '../transport';
import {getRootGroups} from '../selectors';
import findBySession, {getTermGroup} from '../utils/term-groups';

import {ptyExitSession, setActiveSession, userExitSession} from './sessions';

type ResolvedSplitContext = {activeUid: string | undefined; profile: string | undefined};

function resolveSplitContext(
  {activeUid: requestedActiveUid, profile: requestedProfile}: SplitRequestParams,
  getState: () => HyperState
): ResolvedSplitContext {
  const {sessions} = getState();
  const activeUid = requestedActiveUid ?? sessions.activeUid ?? undefined;
  const activeSession = activeUid ? sessions.sessions[activeUid] : undefined;
  // `session.profile` is nullable in state, so only a real name may reach the
  // emitted request; the window's profile is the last resort.
  const profile = requestedProfile ?? activeSession?.profile ?? globalThis.profileName;
  return {activeUid, profile};
}

function emitNewSession(
  extra: {splitDirection?: 'VERTICAL' | 'HORIZONTAL'; isNewGroup?: true},
  cwd: string | undefined,
  {activeUid, profile}: ResolvedSplitContext
): void {
  transport.emit('new', {
    ...extra,
    cwd,
    activeUid: activeUid ? asSessionId(activeUid) : undefined,
    profile: profile ? asProfileId(profile) : undefined
  });
}

function requestSplit(direction: 'VERTICAL' | 'HORIZONTAL') {
  return ({activeUid: requestedActiveUid, profile: requestedProfile}: SplitRequestParams = {}) =>
    (dispatch: HyperDispatch, getState: () => HyperState): void => {
      dispatch({
        type: SESSION_REQUEST,
        effect: () => {
          const {ui} = getState();
          emitNewSession(
            {splitDirection: direction},
            ui.cwd,
            resolveSplitContext({activeUid: requestedActiveUid, profile: requestedProfile}, getState)
          );
        }
      });
    };
}

export const requestVerticalSplit = requestSplit(DIRECTION.VERTICAL);
export const requestHorizontalSplit = requestSplit(DIRECTION.HORIZONTAL);

export function resizeTermGroup(uid: string, sizes: number[]): HyperActions {
  return {
    uid: asTermGroupId(uid),
    type: TERM_GROUP_RESIZE,
    sizes
  };
}

export function requestTermGroup({activeUid: requestedActiveUid, profile: requestedProfile}: SplitRequestParams = {}) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: TERM_GROUP_REQUEST,
      effect: () => {
        const {ui} = getState();
        emitNewSession(
          {isNewGroup: true},
          ui.cwd,
          resolveSplitContext({activeUid: requestedActiveUid, profile: requestedProfile}, getState)
        );
      }
    });
  };
}

export function setActiveGroup(uid: string) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const {termGroups} = getState();
    dispatch(setActiveSession(termGroups.activeSessions[uid]));
  };
}

// When we've found the next group which we want to
// set as active (after closing something), we also need
// to find the first child group which has a sessionUid.
const findFirstSession = (state: ITermState, group: ITermGroup): string | undefined => {
  if (group.sessionUid) {
    return group.sessionUid;
  }

  for (const childUid of group.children.asMutable()) {
    // We want to find the *leftmost* session,
    // even if it's nested deep down:
    const sessionUid = findFirstSession(state, getTermGroup(state.termGroups, childUid));
    if (sessionUid) {
      return sessionUid;
    }
  }

  return undefined;
};

const findPrevious = <T>(list: T[], old: T): T | undefined => {
  const index = list.indexOf(old);
  // If `old` was the first item in the list,
  // choose the other item available:
  return index ? list[index - 1] : list[1];
};

const findNextSessionUid = (state: ITermState, group: ITermGroup): string | undefined => {
  // If we're closing a root group (i.e. a whole tab),
  // the next group needs to be a root group as well:
  if (state.activeRootGroup === group.uid) {
    const rootGroups = getRootGroups({termGroups: state});
    const nextGroup = findPrevious(rootGroups, group);
    return nextGroup ? findFirstSession(state, nextGroup) : undefined;
  }

  const parent = group.parentUid ? getTermGroup(state.termGroups, group.parentUid) : undefined;
  if (!parent) {
    return undefined;
  }
  const nextUid = findPrevious(parent.children.asMutable(), group.uid);
  const nextGroup = nextUid ? state.termGroups[nextUid] : undefined;
  return nextGroup ? findFirstSession(state, nextGroup) : undefined;
};

export function ptyExitTermGroup(sessionUid: string) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const {termGroups} = getState();
    const group = findBySession(termGroups, sessionUid);
    // This might have already been closed:
    if (!group) {
      return dispatch(ptyExitSession(sessionUid));
    }

    dispatch({
      type: TERM_GROUP_EXIT,
      uid: asTermGroupId(group.uid),
      effect: () => {
        const activeSessionUid = termGroups.activeSessions[termGroups.activeRootGroup!];
        if (Object.keys(termGroups.termGroups).length > 1 && activeSessionUid === sessionUid) {
          const nextSessionUid = findNextSessionUid(termGroups, group);
          dispatch(setActiveSession(nextSessionUid!));
        }

        dispatch(ptyExitSession(sessionUid));
      }
    });
  };
}

export function userExitTermGroup(uid: string) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const {termGroups} = getState();
    dispatch({
      type: TERM_GROUP_EXIT,
      uid: asTermGroupId(uid),
      effect: () => {
        const group = termGroups.termGroups[uid];
        // A group can already be gone when a queued exit runs; there is then
        // nothing left to close.
        if (!group) {
          return;
        }

        if (Object.keys(termGroups.termGroups).length <= 1) {
          // No need to attempt finding a new active session
          // if this is the last one we've got:
          return group.sessionUid ? dispatch(userExitSession(group.sessionUid)) : undefined;
        }

        const activeSessionUid = termGroups.activeSessions[termGroups.activeRootGroup!];
        if (termGroups.activeRootGroup === uid || activeSessionUid === group.sessionUid) {
          const nextSessionUid = findNextSessionUid(termGroups, group);
          if (nextSessionUid) {
            dispatch(setActiveSession(nextSessionUid));
          }
        }

        if (group.sessionUid) {
          dispatch(userExitSession(group.sessionUid));
        } else {
          group.children.forEach((childUid) => {
            dispatch(userExitTermGroup(childUid));
          });
        }
      }
    });
  };
}

export function exitActiveTermGroup() {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: TERM_GROUP_EXIT_ACTIVE,
      effect() {
        const {sessions, termGroups} = getState();
        const {uid} = findBySession(termGroups, sessions.activeUid!)!;
        dispatch(userExitTermGroup(uid));
      }
    });
  };
}
