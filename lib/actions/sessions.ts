/** @file Session action creators for state transitions and IPC effects. */
import {asProfileId, asSessionId, type Session} from '@shared/types/common';
import {
  SESSION_ADD,
  SESSION_RESIZE,
  SESSION_REQUEST,
  SESSION_ADD_DATA,
  SESSION_PTY_DATA,
  SESSION_PTY_EXIT,
  SESSION_USER_EXIT,
  SESSION_SET_ACTIVE,
  SESSION_CLEAR_ACTIVE,
  SESSION_USER_DATA,
  SESSION_SET_XTERM_TITLE,
  SESSION_SEARCH
} from '@shared/constants/sessions';
import type {HyperState, HyperDispatch, HyperActions} from '../../typings/hyper';
import rpc from '../rpc';
import {keys} from '../utils/object';
import findBySession from '../utils/term-groups';

/** Add a session to state and emit initial metadata. */
export function addSession({uid, shell, pid, cols = null, rows = null, splitDirection, activeUid, profile}: Session) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const {sessions} = getState();
    const now = Date.now();
    dispatch({
      type: SESSION_ADD,
      uid,
      shell,
      pid,
      cols,
      rows,
      splitDirection,
      activeUid: activeUid ? activeUid : asSessionId(sessions.activeUid),
      now,
      profile
    });
  };
}

/** Request a new session and forward decorated profile context to RPC. */
export function requestSession(profile: string | undefined) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: SESSION_REQUEST,
      effect: () => {
        const {ui} = getState();
        const {cwd} = ui;
        rpc.emit('new', {cwd, profile: profile ? asProfileId(profile) : undefined});
      }
    });
  };
}

/** Queue incoming PTY data and stamp it with the current timestamp. */
export function addSessionData(uid: string, data: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: SESSION_ADD_DATA,
      data,
      effect() {
        const now = Date.now();
        dispatch({
          type: SESSION_PTY_DATA,
          uid: asSessionId(uid),
          data,
          now
        });
      }
    });
  };
}

function createExitAction(type: typeof SESSION_USER_EXIT | typeof SESSION_PTY_EXIT) {
  return (uid: string) => (dispatch: HyperDispatch, getState: () => HyperState) => {
    const sessionUid = asSessionId(uid);
    return dispatch({
      type,
      uid: sessionUid,
      effect() {
        if (type === SESSION_USER_EXIT) {
          rpc.emit('exit', {uid: sessionUid});
        }

        const sessions = keys(getState().sessions.sessions);
        if (sessions.length === 0) {
          window.close();
        }
      }
    } as HyperActions);
  };
}

// we want to distinguish an exit
// that's UI initiated vs pty initiated
/** Create an action creator for user-initiated session exits. */
export const userExitSession = createExitAction(SESSION_USER_EXIT);
/** Create an action creator for PTY-initiated session exits. */
export const ptyExitSession = createExitAction(SESSION_PTY_EXIT);

/** Set the active session identifier in state. */
export function setActiveSession(uid: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: SESSION_SET_ACTIVE,
      uid: asSessionId(uid)
    });
  };
}

/** Clear any active session reference from state. */
export function clearActiveSession(): HyperActions {
  return {
    type: SESSION_CLEAR_ACTIVE
  };
}

/** Set the xterm title for the given session identifier. */
export function setSessionXtermTitle(uid: string, title: string): HyperActions {
  return {
    type: SESSION_SET_XTERM_TITLE,
    uid: asSessionId(uid),
    title
  };
}

/** Resize a session and forward dimensions to the backend PTY. */
export function resizeSession(uid: string, cols: number, rows: number) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const {termGroups} = getState();
    const group = findBySession(termGroups, uid)!;
    const isStandaloneTerm = !group.parentUid && !group.children.length;
    const now = Date.now();
    const sessionUid = asSessionId(uid);
    dispatch({
      type: SESSION_RESIZE,
      uid: sessionUid,
      cols,
      rows,
      isStandaloneTerm,
      now,
      effect() {
        rpc.emit('resize', {uid: sessionUid, cols, rows});
      }
    });
  };
}

/** Open the session search overlay for the target or active session. */
export function openSearch(uid?: string) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const targetUid = uid || getState().sessions.activeUid!;
    dispatch({
      type: SESSION_SEARCH,
      uid: asSessionId(targetUid),
      value: true
    });
  };
}

/** Close the session search overlay or release key handling when inactive. */
export function closeSearch(uid?: string, keyEvent?: any) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const targetUid = uid || getState().sessions.activeUid!;
    if (getState().sessions.sessions[targetUid]?.search) {
      dispatch({
        type: SESSION_SEARCH,
        uid: asSessionId(targetUid),
        value: false
      });
    } else {
      if (keyEvent) {
        keyEvent.catched = false;
      }
    }
  };
}

/** Send session input data to RPC with optional shell escaping. */
export function sendSessionData(uid: string | null, data: string, escaped?: boolean) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: SESSION_USER_DATA,
      data,
      effect() {
        // If no uid is passed, data is sent to the active session.
        const targetUid = uid || getState().sessions.activeUid;

        rpc.emit('data', {uid: targetUid ? asSessionId(targetUid) : null, data, escaped});
      }
    });
  };
}
