import {release} from 'node:os';

import Immutable from 'seamless-immutable';
import type {Immutable as ImmutableType} from 'seamless-immutable';

import {CONFIG_LOAD, CONFIG_RELOAD} from '@shared/constants/config';
import {NOTIFICATION_MESSAGE, NOTIFICATION_DISMISS} from '@shared/constants/notifications';
import {
  SESSION_ADD,
  SESSION_RESIZE,
  SESSION_PTY_DATA,
  SESSION_PTY_EXIT,
  SESSION_SET_ACTIVE,
  SESSION_SET_CWD
} from '@shared/constants/sessions';
import {
  UI_FONT_SIZE_SET,
  UI_FONT_SIZE_RESET,
  UI_FONT_SMOOTHING_SET,
  UI_WINDOW_MAXIMIZE,
  UI_WINDOW_UNMAXIMIZE,
  UI_WINDOW_GEOMETRY_CHANGED,
  UI_ENTER_FULLSCREEN,
  UI_LEAVE_FULLSCREEN
} from '@shared/constants/ui';
import {UPDATE_AVAILABLE} from '@shared/constants/updater';
import type {uiState, Mutable, IUiReducer} from '../../typings/hyper';
import {decorateUIReducer} from '../utils/plugins';

const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].includes(navigator.platform) || process.platform === 'win32';

const allowedCursorShapes = new Set(['BEAM', 'BLOCK', 'UNDERLINE']);
const allowedCursorBlinkValues = new Set([true, false]);
const allowedBells = new Set(['SOUND', 'false', false]);
const allowedHamburgerMenuValues = new Set([true, false, ''] as const);
const allowedWindowControlsValues = new Set([true, false, 'left']);

// Populate `config-default.js` from this :)
const initial: uiState = Immutable<Mutable<uiState>>({
  cols: null,
  rows: null,
  scrollback: 1000,
  activeUid: null,
  cursorColor: '#F81CE5',
  cursorAccentColor: '#000',
  cursorShape: 'BLOCK',
  cursorBlink: false,
  borderColor: '#333',
  selectionColor: 'rgba(248,28,229,0.3)',
  fontSize: 12,
  padding: '12px 14px',
  fontFamily: 'Menlo, "DejaVu Sans Mono", "Lucida Console", monospace',
  uiFontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
  fontSizeOverride: null,
  fontSmoothingOverride: 'antialiased',
  fontWeight: 'normal',
  fontWeightBold: 'bold',
  imageSupport: true,
  lineHeight: 1,
  letterSpacing: 0,
  css: '',
  termCSS: '',
  openAt: {},
  resizeAt: 0,
  colors: {
    black: '#000000',
    red: '#C51E14',
    green: '#1DC121',
    yellow: '#C7C329',
    blue: '#0A2FC4',
    magenta: '#C839C5',
    cyan: '#20C5C6',
    white: '#C7C7C7',
    lightBlack: '#686868',
    lightRed: '#FD6F6B',
    lightGreen: '#67F86F',
    lightYellow: '#FFFA72',
    lightBlue: '#6A76FB',
    lightMagenta: '#FD7CFC',
    lightCyan: '#68FDFE',
    lightWhite: '#FFFFFF'
  },
  activityMarkers: {},
  notifications: {
    font: false,
    resize: false,
    updates: false,
    message: false
  },
  fullScreen: false,
  foregroundColor: '#fff',
  backgroundColor: '#000',
  maximized: false,
  updateVersion: null,
  updateNotes: null,
  updateReleaseUrl: null,
  updateCanInstall: null,
  _lastUpdate: null,
  messageText: null,
  messageURL: null,
  messageDismissable: null,
  bell: 'SOUND',
  bellSoundURL: null, // directly relates to the value in the configuration file
  bellSound: null, // A base64 encoded binary string representation of the audio data from the bellSoundURL
  copyOnSelect: false,
  modifierKeys: {
    altIsMeta: false,
    cmdIsMeta: false
  },
  showHamburgerMenu: '',
  showWindowControls: '',
  quickEdit: false,
  webGLRenderer: true,
  webGLRendererMaxContexts: 16,
  webLinksActivationKey: '',
  macOptionSelectionMode: 'vertical',
  disableLigatures: true,
  screenReaderMode: false,
  defaultProfile: '',
  profiles: []
});

type UiStatePartial = Immutable.DeepPartial<Mutable<uiState>>;

const processFontSizeConfig = (config: any, state: uiState): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (state.fontSizeOverride && config.fontSize !== state.fontSize) {
    ret.fontSizeOverride = null;
  }

  if (config.fontSize) {
    ret.fontSize = config.fontSize;
  }

  return ret;
};

const processFontFamilyConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.fontFamily) {
    ret.fontFamily = config.fontFamily;
  }

  if (config.uiFontFamily) {
    ret.uiFontFamily = config.uiFontFamily;
  }

  if (config.uiFontFamily) {
    ret.uiFontFamily = config.uiFontFamily;
  }

  return ret;
};

const processFontWeightConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.fontWeight) {
    ret.fontWeight = config.fontWeight;
  }

  if (config.fontWeightBold) {
    ret.fontWeightBold = config.fontWeightBold;
  }

  return ret;
};

const processFontSpacingConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (Number.isFinite(config.lineHeight)) {
    ret.lineHeight = config.lineHeight;
  }

  if (Number.isFinite(config.letterSpacing)) {
    ret.letterSpacing = config.letterSpacing;
  }

  return ret;
};

const processFontConfig = (config: any, state: uiState): UiStatePartial => {
  return {
    ...processFontSizeConfig(config, state),
    ...processFontFamilyConfig(config),
    ...processFontWeightConfig(config),
    ...processFontSpacingConfig(config)
  };
};

const processCursorConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.cursorColor) {
    ret.cursorColor = config.cursorColor;
  }

  if (config.cursorAccentColor) {
    ret.cursorAccentColor = config.cursorAccentColor;
  }

  if (allowedCursorShapes.has(config.cursorShape)) {
    ret.cursorShape = config.cursorShape;
  }

  if (allowedCursorBlinkValues.has(config.cursorBlink)) {
    ret.cursorBlink = config.cursorBlink;
  }

  return ret;
};

const processColorConfig = (config: any, state: uiState): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.borderColor) {
    ret.borderColor = config.borderColor;
  }

  if (config.selectionColor) {
    ret.selectionColor = config.selectionColor;
  }

  if (config.foregroundColor) {
    ret.foregroundColor = config.foregroundColor;
  }

  if (config.backgroundColor) {
    ret.backgroundColor = config.backgroundColor;
  }

  if (config.colors) {
    if (JSON.stringify(state.colors) !== JSON.stringify(config.colors)) {
      ret.colors = config.colors;
    }
  }

  return ret;
};

const processRendererConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.webGLRenderer !== undefined) {
    ret.webGLRenderer = config.webGLRenderer;
  }

  if (Number.isInteger(config.webGLRendererMaxContexts) && config.webGLRendererMaxContexts > 0) {
    ret.webGLRendererMaxContexts = config.webGLRendererMaxContexts;
  }

  return ret;
};

const processBellConfig = (config: any, state: uiState): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (allowedBells.has(config.bell)) {
    ret.bell = (config.bell as any) === 'false' ? false : config.bell;
  }

  if (config.bellSoundURL !== state.bellSoundURL) {
    ret.bellSoundURL = config.bellSoundURL || initial.bellSoundURL;
  }

  if (config.bellSound !== state.bellSound) {
    ret.bellSound = config.bellSound || initial.bellSound;
  }

  return ret;
};

const processUIControlsConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (allowedHamburgerMenuValues.has(config.showHamburgerMenu)) {
    ret.showHamburgerMenu = config.showHamburgerMenu;
  }

  if (allowedWindowControlsValues.has(config.showWindowControls)) {
    ret.showWindowControls = config.showWindowControls;
  }

  if (config.webLinksActivationKey !== undefined) {
    ret.webLinksActivationKey = config.webLinksActivationKey;
  }

  return ret;
};

const processQuickEditConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (process.platform === 'win32' && (config.quickEdit === undefined || config.quickEdit === null)) {
    ret.quickEdit = true;
  } else if (typeof config.quickEdit !== 'undefined' && config.quickEdit !== null) {
    ret.quickEdit = config.quickEdit;
  }

  return ret;
};

const processMacOptionsConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.macOptionSelectionMode) {
    ret.macOptionSelectionMode = config.macOptionSelectionMode;
  }

  return ret;
};

const processWindowsPtyConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (!isWindows) {
    return ret;
  }

  const buildNumber = parseInt(release().split('.').at(-1) || '0', 10);
  if (Number.isNaN(buildNumber) || buildNumber <= 0) {
    return ret;
  }

  const useConpty = typeof config.useConpty === 'boolean' ? config.useConpty : buildNumber >= 18309;
  ret.windowsPty = {
    backend: useConpty ? 'conpty' : 'winpty',
    buildNumber
  };

  return ret;
};

const processPlatformSpecificConfig = (config: any): UiStatePartial => {
  return {
    ...processQuickEditConfig(config),
    ...processMacOptionsConfig(config),
    ...processWindowsPtyConfig(config)
  };
};

const processScrollAndPaddingConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.scrollback) {
    ret.scrollback = config.scrollback;
  }

  if (typeof config.padding !== 'undefined' && config.padding !== null) {
    ret.padding = config.padding;
  }

  return ret;
};

const processInputBehaviourConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (typeof config.copyOnSelect !== 'undefined' && config.copyOnSelect !== null) {
    ret.copyOnSelect = config.copyOnSelect;
  }

  if (config.modifierKeys) {
    ret.modifierKeys = config.modifierKeys;
  }

  return ret;
};

const processAccessibilityConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.disableLigatures !== undefined) {
    ret.disableLigatures = config.disableLigatures;
  }

  if (config.screenReaderMode !== undefined) {
    ret.screenReaderMode = config.screenReaderMode;
  }

  if (config.imageSupport !== undefined) {
    ret.imageSupport = config.imageSupport;
  }

  return ret;
};

const processTerminalBehaviourConfig = (config: any): UiStatePartial => {
  return {
    ...processScrollAndPaddingConfig(config),
    ...processInputBehaviourConfig(config),
    ...processAccessibilityConfig(config)
  };
};

const processStyleConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.css || config.css === '') {
    ret.css = config.css;
  }

  if (config.termCSS) {
    ret.termCSS = config.termCSS;
  }

  return ret;
};

const processProfileConfig = (config: any): UiStatePartial => {
  const ret: UiStatePartial = {};

  if (config.defaultProfile !== undefined) {
    ret.defaultProfile = config.defaultProfile;
  }

  if (config.profiles !== undefined) {
    ret.profiles = config.profiles;
  }

  return ret;
};

const mergeConfigIntoState = (config: any, state: uiState, now: number): UiStatePartial => {
  return {
    ...processFontConfig(config, state),
    ...processCursorConfig(config),
    ...processColorConfig(config, state),
    ...processRendererConfig(config),
    ...processBellConfig(config, state),
    ...processUIControlsConfig(config),
    ...processPlatformSpecificConfig(config),
    ...processTerminalBehaviourConfig(config),
    ...processStyleConfig(config),
    ...processProfileConfig(config),
    _lastUpdate: now
  };
};

const handleConfigLoad = (state: uiState, action: any): uiState => {
  const {config, now} = action;
  // unset the user font size override if the
  // font size changed from the config
  return state.merge(mergeConfigIntoState(config, state, now));
};

const handleUIActions = (state: uiState, action: any): uiState => {
  switch (action.type) {
    case UI_FONT_SIZE_SET:
      return state.set('fontSizeOverride', action.value);

    case UI_FONT_SIZE_RESET:
      return state.set('fontSizeOverride', null);

    case UI_FONT_SMOOTHING_SET:
      return state.set('fontSmoothingOverride', action.fontSmoothing);

    case UI_WINDOW_MAXIMIZE:
      return state.set('maximized', true);

    case UI_WINDOW_UNMAXIMIZE:
      return state.set('maximized', false);

    case UI_WINDOW_GEOMETRY_CHANGED: {
      const isMax = action.isMaximized;
      if (state.maximized !== isMax) {
        return state.set('maximized', isMax);
      }

      return state;
    }

    case UI_ENTER_FULLSCREEN:
      return state.set('fullScreen', true);

    case UI_LEAVE_FULLSCREEN:
      return state.set('fullScreen', false);

    default:
      return state;
  }
};

const handleNotifications = (state: uiState, action: any): uiState => {
  switch (action.type) {
    case NOTIFICATION_DISMISS:
      return state.merge(
        {
          notifications: {
            [action.id]: false
          }
        },
        {deep: true}
      );

    case NOTIFICATION_MESSAGE:
      return state.merge({
        messageText: action.text,
        messageURL: action.url,
        messageDismissable: action.dismissable === true
      });

    case UPDATE_AVAILABLE:
      return state.merge({
        updateVersion: action.version,
        updateNotes: action.notes || '',
        updateReleaseUrl: action.releaseUrl,
        updateCanInstall: !!action.canInstall
      });

    default:
      return state;
  }
};

const handleSessionResize = (state: uiState, action: any): uiState => {
  // only care about the sizes
  // of standalone terms (i.e. not splits):
  if (!action.isStandaloneTerm) {
    return state;
  }

  return state.merge({
    rows: action.rows,
    cols: action.cols,
    resizeAt: action.now
  });
};

const handleSessionPtyExit = (state: uiState, action: any): uiState => {
  return state
    .updateIn(['openAt'], (times: ImmutableType<Record<string, number>>) => {
      const times_ = times.asMutable();
      delete times_[action.uid];
      return times_;
    })
    .updateIn(['activityMarkers'], (markers: ImmutableType<Record<string, boolean>>) => {
      const markers_ = markers.asMutable();
      delete markers_[action.uid];
      return markers_;
    });
};

const setActiveUidAndMerge = (state: uiState, uid: string, propertyName: string, propertyValue: any): uiState => {
  return state.merge(
    {
      activeUid: uid,
      [propertyName]: {
        [uid]: propertyValue
      }
    },
    {deep: true}
  );
};

const handleSessionPtyData = (state: uiState, action: any): uiState => {
  // ignore activity markers for current tab
  if (action.uid === state.activeUid) {
    return state;
  }

  // if first data events after open, ignore
  if (action.now - state.openAt[action.uid] < 1000) {
    return state;
  }

  // ignore activity markers that are within
  // proximity of a resize event, since we
  // expect to get data packets from the resize
  // of the ptys as a result
  if (!state.resizeAt || action.now - state.resizeAt > 1000) {
    return state.merge(
      {
        activityMarkers: {
          [action.uid]: true
        }
      },
      {deep: true}
    );
  }

  return state;
};

const updateFontNotification = (state: uiState, state_: uiState, actionType: string): uiState => {
  if (CONFIG_LOAD === actionType) {
    return state_;
  }

  if (state_.fontSize !== state.fontSize || state_.fontSizeOverride !== state.fontSizeOverride) {
    return state_.merge({notifications: {font: true}}, {deep: true});
  }

  return state_;
};

const updateResizeNotification = (state: uiState, state_: uiState): uiState => {
  if (state.cols !== null && state.rows !== null && (state.rows !== state_.rows || state.cols !== state_.cols)) {
    return state_.merge({notifications: {resize: true}}, {deep: true});
  }
  return state_;
};

const updateMessageNotification = (state: uiState, state_: uiState): uiState => {
  if (state.messageText !== state_.messageText || state.messageURL !== state_.messageURL) {
    return state_.merge({notifications: {message: true}}, {deep: true});
  }
  return state_;
};

const updateVersionNotification = (state: uiState, state_: uiState): uiState => {
  if (state.updateVersion !== state_.updateVersion) {
    return state_.merge({notifications: {updates: true}}, {deep: true});
  }
  return state_;
};

const applyNotificationUpdates = (state: uiState, state_: uiState, actionType: string): uiState => {
  let result = state_;
  result = updateFontNotification(state, result, actionType);
  result = updateResizeNotification(state, result);
  result = updateMessageNotification(state, result);
  result = updateVersionNotification(state, result);
  return result;
};

const reducer: IUiReducer = (state = initial, action) => {
  let state_ = state;
  switch (action.type) {
    case CONFIG_LOAD:
    case CONFIG_RELOAD:
      state_ = handleConfigLoad(state, action);
      break;

    case SESSION_ADD:
      state_ = setActiveUidAndMerge(state, action.uid, 'openAt', action.now);
      break;

    case SESSION_RESIZE:
      state_ = handleSessionResize(state, action);
      break;

    case SESSION_PTY_EXIT:
      state_ = handleSessionPtyExit(state, action);
      break;

    case SESSION_SET_ACTIVE:
      state_ = setActiveUidAndMerge(state, action.uid, 'activityMarkers', false);
      break;

    case SESSION_PTY_DATA:
      state_ = handleSessionPtyData(state, action);
      break;

    case SESSION_SET_CWD:
      state_ = state.set('cwd', action.cwd);
      break;

    case UI_FONT_SIZE_SET:
    case UI_FONT_SIZE_RESET:
    case UI_FONT_SMOOTHING_SET:
    case UI_WINDOW_MAXIMIZE:
    case UI_WINDOW_UNMAXIMIZE:
    case UI_WINDOW_GEOMETRY_CHANGED:
    case UI_ENTER_FULLSCREEN:
    case UI_LEAVE_FULLSCREEN:
      state_ = handleUIActions(state, action);
      break;

    case NOTIFICATION_DISMISS:
    case NOTIFICATION_MESSAGE:
    case UPDATE_AVAILABLE:
      state_ = handleNotifications(state, action);
      break;
  }

  state_ = applyNotificationUpdates(state, state_, action.type);

  return state_;
};

export default decorateUIReducer(reducer);
