/** @file Shared session action constants and action contracts. */
export const SESSION_ADD = 'SESSION_ADD';
export const SESSION_RESIZE = 'SESSION_RESIZE';
export const SESSION_REQUEST = 'SESSION_REQUEST';
export const SESSION_ADD_DATA = 'SESSION_ADD_DATA';
export const SESSION_PTY_DATA = 'SESSION_PTY_DATA';
export const SESSION_PTY_EXIT = 'SESSION_PTY_EXIT';
export const SESSION_USER_EXIT = 'SESSION_USER_EXIT';
export const SESSION_SET_ACTIVE = 'SESSION_SET_ACTIVE';
export const SESSION_CLEAR_ACTIVE = 'SESSION_CLEAR_ACTIVE';
export const SESSION_USER_DATA = 'SESSION_USER_DATA';
export const SESSION_SET_XTERM_TITLE = 'SESSION_SET_XTERM_TITLE';
export const SESSION_SET_CWD = 'SESSION_SET_CWD';
export const SESSION_SEARCH = 'SESSION_SEARCH';

/** Adds a newly created session to state. */
export interface SessionAddAction {
  type: typeof SESSION_ADD;
  readonly uid: string;
  readonly shell: string | null;
  readonly pid: number | null;
  readonly cols: number | null;
  readonly rows: number | null;
  readonly splitDirection?: 'HORIZONTAL' | 'VERTICAL';
  readonly activeUid: string | null;
  readonly now: number;
  readonly profile: string;
}

/** Resizes an existing session terminal viewport. */
export interface SessionResizeAction {
  type: typeof SESSION_RESIZE;
  readonly uid: string;
  readonly cols: number;
  readonly rows: number;
  readonly isStandaloneTerm: boolean;
  readonly now: number;
}

/** Requests a new session from the backend. */
export interface SessionRequestAction {
  type: typeof SESSION_REQUEST;
}

/** Marks that data is pending for a session. */
export interface SessionAddDataAction {
  type: typeof SESSION_ADD_DATA;
}

/** Appends PTY data for a session. */
export interface SessionPtyDataAction {
  type: typeof SESSION_PTY_DATA;
  readonly data: string;
  readonly uid: string;
  readonly now: number;
}

/** Handles backend PTY exit events for a session. */
export interface SessionPtyExitAction {
  type: typeof SESSION_PTY_EXIT;
  readonly uid: string;
}

/** Handles user-triggered session exits. */
export interface SessionUserExitAction {
  type: typeof SESSION_USER_EXIT;
  readonly uid: string;
}

/** Marks a specific session as active. */
export interface SessionSetActiveAction {
  type: typeof SESSION_SET_ACTIVE;
  readonly uid: string;
}

/** Clears the currently active session reference. */
export interface SessionClearActiveAction {
  type: typeof SESSION_CLEAR_ACTIVE;
}

/** Records user data updates for session metadata. */
export interface SessionUserDataAction {
  type: typeof SESSION_USER_DATA;
}

/** Updates the xterm title for a session. */
export interface SessionSetXtermTitleAction {
  type: typeof SESSION_SET_XTERM_TITLE;
  readonly uid: string;
  readonly title: string;
}

/** Updates the working directory shown for a session. */
export interface SessionSetCwdAction {
  type: typeof SESSION_SET_CWD;
  readonly cwd: string;
}

/** Toggles search UI visibility for a session. */
export interface SessionSearchAction {
  type: typeof SESSION_SEARCH;
  readonly uid: string;
  readonly value: boolean;
}

/** Union of every shared session action contract. */
export type SessionActions =
  | SessionAddAction
  | SessionResizeAction
  | SessionRequestAction
  | SessionAddDataAction
  | SessionPtyDataAction
  | SessionPtyExitAction
  | SessionUserExitAction
  | SessionSetActiveAction
  | SessionClearActiveAction
  | SessionUserDataAction
  | SessionSetXtermTitleAction
  | SessionSetCwdAction
  | SessionSearchAction;
