import Immutable from 'seamless-immutable';

import {
  SESSION_ADD,
  SESSION_PTY_EXIT,
  SESSION_USER_EXIT,
  SESSION_PTY_DATA,
  SESSION_SET_ACTIVE,
  SESSION_CLEAR_ACTIVE,
  SESSION_RESIZE,
  SESSION_SET_XTERM_TITLE,
  SESSION_SET_CWD,
  SESSION_SEARCH
} from '@shared/constants/sessions';
import type {SessionAddAction, SessionResizeAction} from '@shared/constants/sessions';
import type {SessionId} from '@shared/types/common';
import type {sessionState, session, Mutable, ISessionReducer} from '../../typings/hyper';
import {decorateSessionsReducer} from '../utils/plugins';

const initialState: sessionState = Immutable<Mutable<sessionState>>({
  sessions: {},
  activeUid: null
});

function Session(obj: Immutable.DeepPartial<session>) {
  const x: session = {
    uid: '',
    title: '',
    cols: null,
    rows: null,
    cleared: false,
    search: false,
    shell: '',
    pid: null,
    profile: ''
  };
  return Immutable(x).merge(obj);
}

function deleteSession(state: sessionState, uid: string) {
  return state.updateIn(['sessions'], (sessions: (typeof state)['sessions']) => {
    const sessions_ = sessions.asMutable();
    delete sessions_[uid];
    return sessions_;
  });
}

/** Records a newly created session and makes it the active one. */
const addSession = (state: sessionState, action: SessionAddAction): sessionState =>
  state.set('activeUid', action.uid).setIn(
    ['sessions', action.uid],
    Session({
      cols: action.cols,
      rows: action.rows,
      uid: action.uid,
      // The shell is reported as a full path, but only its basename is meaningful
      // to the user, and `null` stays `null` rather than becoming the string
      // "null".
      shell: action.shell ? action.shell.split('/').pop() : null,
      pid: action.pid,
      profile: action.profile
    })
  );

/** Clears the `cleared` flag that suppresses output for a session. */
const markSessionUncleared = (state: sessionState, uid: SessionId): sessionState =>
  state.merge({sessions: {[uid]: {cleared: false}}}, {deep: true});

/**
 * Drops a session's terminal output flag once data arrives.
 *
 * This is the most common action by a wide margin, so the common case returns
 * the state untouched and only a cleared session takes the merge path.
 */
const handlePtyData = (state: sessionState, uid: SessionId): sessionState =>
  state.sessions[uid]?.cleared ? markSessionUncleared(state, uid) : state;

/** Removes a session when its pty exits, tolerating an already-closed session. */
const handlePtyExit = (state: sessionState, uid: SessionId): sessionState => {
  if (state.sessions[uid]) {
    return deleteSession(state, uid);
  }
  console.log('ignore pty exit: session removed by user');
  return state;
};

/** Applies a viewport resize, ignoring resizes for sessions that are gone. */
const resizeSession = (state: sessionState, action: SessionResizeAction): sessionState => {
  const session = state.sessions[action.uid];
  // A resize can be queued before the session is added, or arrive after
  // the user has already closed it. There is nothing to resize in that
  // window, and the next resize for a live session applies normally.
  if (!session) {
    return state;
  }
  return state.setIn(
    ['sessions', action.uid],
    session.merge({
      rows: action.rows,
      cols: action.cols,
      resizeAt: action.now
    })
  );
};

/** Records the working directory for the active session, if there is one. */
const setActiveSessionCwd = (state: sessionState, cwd: string): sessionState => {
  if (state.activeUid) {
    return state.setIn(['sessions', state.activeUid, 'cwd'], cwd);
  }
  return state;
};

const reducer: ISessionReducer = (state = initialState, action) => {
  switch (action.type) {
    case SESSION_ADD: {
      return addSession(state, action);
    }

    case SESSION_SET_ACTIVE: {
      return state.set('activeUid', action.uid);
    }

    case SESSION_SEARCH: {
      return state.setIn(['sessions', action.uid, 'search'], action.value);
    }

    case SESSION_CLEAR_ACTIVE: {
      return state.merge(
        {
          sessions: {
            [state.activeUid!]: {
              cleared: true
            }
          }
        },
        {deep: true}
      );
    }

    case SESSION_PTY_DATA: {
      return handlePtyData(state, action.uid);
    }

    case SESSION_PTY_EXIT: {
      return handlePtyExit(state, action.uid);
    }

    case SESSION_USER_EXIT: {
      return deleteSession(state, action.uid);
    }

    case SESSION_SET_XTERM_TITLE: {
      return state.setIn(
        ['sessions', action.uid, 'title'],
        // we need to trim the title because `cmd.exe`
        // likes to report ' ' as the title
        action.title.trim()
      );
    }

    case SESSION_RESIZE: {
      return resizeSession(state, action);
    }

    case SESSION_SET_CWD: {
      return setActiveSessionCwd(state, action.cwd);
    }

    default: {
      return state;
    }
  }
};

export default decorateSessionsReducer(reducer);
