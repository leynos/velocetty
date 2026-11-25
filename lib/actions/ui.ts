import {stat} from 'node:fs';
import type {Stats} from 'node:fs';

import type parseUrl from 'parse-url';
import {php_escapeshellcmd as escapeShellCmd} from 'php-escape-shell';

import {
  UI_FONT_SIZE_SET,
  UI_FONT_SIZE_INCR,
  UI_FONT_SIZE_DECR,
  UI_FONT_SIZE_RESET,
  UI_FONT_SMOOTHING_SET,
  UI_MOVE_LEFT,
  UI_MOVE_RIGHT,
  UI_MOVE_TO,
  UI_MOVE_NEXT_PANE,
  UI_MOVE_PREV_PANE,
  UI_WINDOW_GEOMETRY_CHANGED,
  UI_WINDOW_MOVE,
  UI_OPEN_FILE,
  UI_ENTER_FULLSCREEN,
  UI_LEAVE_FULLSCREEN,
  UI_OPEN_SSH_URL,
  UI_CONTEXTMENU_OPEN,
  UI_COMMAND_EXEC
} from '@shared/constants/ui';
import type {CommandId} from '@shared/types/commands';
import type {HyperState, HyperDispatch, HyperActions, ITermGroups} from '../../typings/hyper';
import {SETTINGS_TAB_UID} from '@shared/constants/settings-tab';
import {selectTabStrip} from '../selectors/tab-strip';
import {activateTab, closeSettingsTab} from './tab-strip';
import {isAllowedOnSettingsSurface} from '../settings/surface-command-gate';
import {isExecutable} from '../utils/file';
import notify from '../utils/notify';
import findBySession, {getTermGroup} from '../utils/term-groups';
import {transport} from '../transport';

import {requestSession, sendSessionData, setActiveSession} from './sessions';

export function openContextMenu(uid: string, selection: string) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: UI_CONTEXTMENU_OPEN,
      uid,
      effect() {
        const state = getState();
        const show = !state.ui.quickEdit;
        if (show) {
          transport.emit('open context menu', selection);
        }
      }
    });
  };
}

export function increaseFontSize() {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: UI_FONT_SIZE_INCR,
      effect() {
        const state = getState();
        const old = state.ui.fontSizeOverride || state.ui.fontSize;
        const value = old + 1;
        dispatch({
          type: UI_FONT_SIZE_SET,
          value
        });
      }
    });
  };
}

export function decreaseFontSize() {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: UI_FONT_SIZE_DECR,
      effect() {
        const state = getState();
        const old = state.ui.fontSizeOverride || state.ui.fontSize;
        // when the font-size is really small, below 5px, xterm starts showing up issues.
        const value = old > 5 ? old - 1 : old;
        dispatch({
          type: UI_FONT_SIZE_SET,
          value
        });
      }
    });
  };
}

export function resetFontSize(): HyperActions {
  return {
    type: UI_FONT_SIZE_RESET
  };
}

export function setFontSmoothing() {
  return (dispatch: HyperDispatch) => {
    setTimeout(() => {
      const devicePixelRatio = window.devicePixelRatio;
      const fontSmoothing = devicePixelRatio < 2 ? 'subpixel-antialiased' : 'antialiased';

      dispatch({
        type: UI_FONT_SMOOTHING_SET,
        fontSmoothing
      });
    }, 100);
  };
}

export function windowGeometryUpdated({isMaximized}: {isMaximized: boolean}): HyperActions {
  return {
    type: UI_WINDOW_GEOMETRY_CHANGED,
    isMaximized
  };
}

// Find all sessions that are below the given
// termGroup uid in the hierarchy:
const findChildSessions = (termGroups: ITermGroups, uid: string): string[] => {
  const group = getTermGroup(termGroups, uid);
  if (group.sessionUid) {
    return [uid];
  }

  const childSessions: string[] = [];
  for (const childUid of group.children) {
    childSessions.push(...findChildSessions(termGroups, childUid));
  }
  return childSessions;
};

// Get the index of the next or previous group,
// depending on the movement direction:
const getNeighbourIndex = (groups: string[], uid: string, type: string) => {
  if (type === UI_MOVE_NEXT_PANE) {
    return (groups.indexOf(uid) + 1) % groups.length;
  }

  return (groups.indexOf(uid) + groups.length - 1) % groups.length;
};

function moveToNeighbourPane(type: typeof UI_MOVE_NEXT_PANE | typeof UI_MOVE_PREV_PANE) {
  return () => (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type,
      effect() {
        const {sessions, termGroups} = getState();
        const {uid} = findBySession(termGroups, sessions.activeUid!)!;
        const childGroups = findChildSessions(termGroups.termGroups, termGroups.activeRootGroup!);
        if (childGroups.length === 1) {
          console.log('ignoring move for single group');
        } else {
          const index = getNeighbourIndex(childGroups, uid, type);
          const nextGroupUid = childGroups[index];
          if (nextGroupUid) {
            const {sessionUid} = getTermGroup(termGroups.termGroups, nextGroupUid);
            if (sessionUid) {
              dispatch(setActiveSession(sessionUid));
            }
          }
        }
      }
    });
  };
}

export const moveToNextPane = moveToNeighbourPane(UI_MOVE_NEXT_PANE);
export const moveToPreviousPane = moveToNeighbourPane(UI_MOVE_PREV_PANE);

const getTabUids = (state: HyperState) => selectTabStrip(state).map(({uid}) => uid);

const getSurfaceUid = (state: HyperState): string | null =>
  state.settingsTab.isActive ? SETTINGS_TAB_UID : (state.termGroups.activeRootGroup ?? null);

export function moveLeft() {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: UI_MOVE_LEFT,
      effect() {
        const state = getState();
        const uid = getSurfaceUid(state);
        const tabUids = getTabUids(state);
        const index = tabUids.indexOf(uid ?? '');
        const next = tabUids[index - 1] || tabUids.at(-1);
        if (!next || next === uid) {
          console.log('ignoring left move action');
        } else {
          dispatch(activateTab(next));
        }
      }
    });
  };
}

export function moveRight() {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    dispatch({
      type: UI_MOVE_RIGHT,
      effect() {
        const state = getState();
        const uid = getSurfaceUid(state);
        const tabUids = getTabUids(state);
        const index = tabUids.indexOf(uid ?? '');
        const next = tabUids[index + 1] || tabUids[0];
        if (!next || next === uid) {
          console.log('ignoring right move action');
        } else {
          dispatch(activateTab(next));
        }
      }
    });
  };
}

const getLastTabIndex = (state: HyperState): number => getTabUids(state).length - 1;

export function moveTo(i: number | 'last') {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    const targetIndex = i === 'last' ? getLastTabIndex(getState()) : i;
    dispatch({
      type: UI_MOVE_TO,
      index: targetIndex,
      effect() {
        const state = getState();
        const tabUids = getTabUids(state);
        const uid = getSurfaceUid(state);
        const target = tabUids[targetIndex];
        if (!target) {
          console.log('ignoring inexistent index', targetIndex);
        } else if (uid === target) {
          console.log('ignoring same uid');
        } else {
          dispatch(activateTab(target));
        }
      }
    });
  };
}

export function windowMove(window: any) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_WINDOW_MOVE,
      window,
      effect() {
        dispatch(setFontSmoothing());
      }
    });
  };
}

export function windowGeometryChange() {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_WINDOW_MOVE,
      effect() {
        dispatch(setFontSmoothing());
      }
    });
  };
}

export function openFile(path: string) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_OPEN_FILE,
      effect() {
        stat(path, (err: any, stats: Stats) => {
          if (err) {
            notify('Unable to open path', `"${path}" doesn't exist.`, {error: err});
          } else {
            let command = escapeShellCmd(path).replaceAll(' ', String.raw`\ `);
            if (stats.isDirectory()) {
              command = `cd ${command}\n`;
            } else if (stats.isFile() && isExecutable(stats)) {
              command += '\n';
            }
            transport.once('session add', ({uid}) => {
              transport.once('session data', () => {
                dispatch(sendSessionData({uid, data: command}));
              });
            });
          }
          dispatch(requestSession());
        });
      }
    });
  };
}

export function enterFullScreen(): HyperActions {
  return {
    type: UI_ENTER_FULLSCREEN
  };
}

export function leaveFullScreen(): HyperActions {
  return {
    type: UI_LEAVE_FULLSCREEN
  };
}

export function openSSH(parsedUrl: ReturnType<typeof parseUrl>) {
  return (dispatch: HyperDispatch) => {
    dispatch({
      type: UI_OPEN_SSH_URL,
      effect() {
        let command = `${parsedUrl.protocol} ${parsedUrl.user ? `${parsedUrl.user}@` : ''}${parsedUrl.resource}`;

        if (parsedUrl.port) command += ` -p ${parsedUrl.port}`;

        command += '\n';

        transport.once('session add', ({uid}) => {
          transport.once('session data', () => {
            dispatch(sendSessionData({uid, data: command}));
          });
        });

        dispatch(requestSession());
      }
    });
  };
}

export function execCommand(
  command: CommandId,
  fn: ((e: unknown, dispatch: HyperDispatch) => void) | undefined,
  e: unknown
) {
  return (dispatch: HyperDispatch, getState: () => HyperState) => {
    if (getState().settingsTab.isActive) {
      if (command === 'pane:close') {
        dispatch(closeSettingsTab());
        return;
      }
      if (!isAllowedOnSettingsSurface(command)) {
        // Drop the command entirely: no handler, no main-process fallback, and
        // the caller leaves the native browser behaviour alone.
        return;
      }
    }
    dispatch({
      type: UI_COMMAND_EXEC,
      command,
      effect() {
        if (fn) {
          fn(e, dispatch);
        } else {
          transport.emit('command', command);
        }
      }
    });
  };
}
