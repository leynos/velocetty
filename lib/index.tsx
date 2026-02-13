import './v8-snapshot-util';
import {webFrame} from 'electron';

import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';

import type {configOptions} from '@shared/types/config';

import {loadConfig, reloadConfig} from './actions/config';
import init from './actions/index';
import {addNotificationMessage} from './actions/notifications';
import * as sessionActions from './actions/sessions';
import * as termGroupActions from './actions/term-groups';
import * as uiActions from './actions/ui';
import * as updaterActions from './actions/updater';
import HyperContainer from './containers/hyper';
import rpc from './rpc';
import {transport} from './transport';
import configureStore from './store/configure-store';
import * as config from './utils/config';
import {getBase64FileData} from './utils/file';
import * as plugins from './utils/plugins';

// On Linux, the default zoom was somehow changed with Electron 3 (or maybe 2).
// Setting zoom factor to 1.2 brings back the normal default size
if (process.platform === 'linux') {
  webFrame.setZoomFactor(1.2);
}

const store_ = configureStore();

Object.defineProperty(window, 'store', {get: () => store_});
Object.defineProperty(window, 'rpc', {get: () => rpc});
Object.defineProperty(window, 'config', {get: () => config});
Object.defineProperty(window, 'plugins', {get: () => plugins});

const fetchFileData = (configData: configOptions) => {
  const configInfo: configOptions = {...configData, bellSound: null};
  if (!configInfo.bell || configInfo.bell.toUpperCase() !== 'SOUND' || !configInfo.bellSoundURL) {
    store_.dispatch(reloadConfig(configInfo));
    return;
  }

  void getBase64FileData(configInfo.bellSoundURL).then((base64FileData) => {
    // prepend "base64," to the result of this method in order for this to work properly within xterm.js
    const bellSound = !base64FileData ? null : `base64,${base64FileData}`;
    configInfo.bellSound = bellSound;
    store_.dispatch(reloadConfig(configInfo));
  });
};

// initialize config
store_.dispatch(loadConfig(config.getConfig()));
fetchFileData(config.getConfig());

config.subscribe(() => {
  const configInfo = config.getConfig();
  configInfo.bellSound = store_.getState().ui.bellSound;
  // The only async part of the config is the bellSound so we will check if the bellSoundURL
  // has changed to determine if we should re-read this file and dispatch an update to the config
  if (store_.getState().ui.bellSoundURL !== config.getConfig().bellSoundURL) {
    fetchFileData(configInfo);
  } else {
    // No change in the bellSoundURL so continue with a normal reloadConfig, reusing the value
    // we already have for `bellSound`
    store_.dispatch(reloadConfig(configInfo));
  }
});

// initialize communication with main electron process
// and subscribe to all user intents for example from menus
transport.on('ready', () => {
  store_.dispatch(init());
  store_.dispatch(uiActions.setFontSmoothing());
});

transport.on('session add', (data) => {
  store_.dispatch(sessionActions.addSession(data));
});

transport.on('session data', (d: string) => {
  // the uid is a uuid v4 so it's 36 chars long
  const uid = d.slice(0, 36);
  const data = d.slice(36);
  store_.dispatch(sessionActions.addSessionData(uid, data));
});

transport.on('session data send', ({uid, data, escaped}) => {
  store_.dispatch(sessionActions.sendSessionData(uid, data, escaped));
});

transport.on('session exit', ({uid}) => {
  store_.dispatch(termGroupActions.ptyExitTermGroup(uid));
});

transport.on('termgroup close req', () => {
  store_.dispatch(termGroupActions.exitActiveTermGroup());
});

transport.on('session clear req', () => {
  store_.dispatch(sessionActions.clearActiveSession());
});

transport.on('session move word left req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1bb'));
});

transport.on('session move word right req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1bf'));
});

transport.on('session move line beginning req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1bOH'));
});

transport.on('session move line end req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1bOF'));
});

transport.on('session del word left req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1b\x7f'));
});

transport.on('session del word right req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1bd'));
});

transport.on('session del line beginning req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1bw'));
});

transport.on('session del line end req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x10B'));
});

transport.on('session break req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x03'));
});

transport.on('session stop req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1a'));
});

transport.on('session quit req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x1c'));
});

transport.on('session tmux req', () => {
  store_.dispatch(sessionActions.sendSessionData(null, '\x02'));
});

transport.on('session search', () => {
  store_.dispatch(sessionActions.openSearch());
});

transport.on('session search close', () => {
  store_.dispatch(sessionActions.closeSearch());
});

transport.on('termgroup add req', ({activeUid, profile}) => {
  store_.dispatch(termGroupActions.requestTermGroup(activeUid, profile));
});

transport.on('split request horizontal', ({activeUid, profile}) => {
  store_.dispatch(termGroupActions.requestHorizontalSplit(activeUid, profile));
});

transport.on('split request vertical', ({activeUid, profile}) => {
  store_.dispatch(termGroupActions.requestVerticalSplit(activeUid, profile));
});

transport.on('reset fontSize req', () => {
  store_.dispatch(uiActions.resetFontSize());
});

transport.on('increase fontSize req', () => {
  store_.dispatch(uiActions.increaseFontSize());
});

transport.on('decrease fontSize req', () => {
  store_.dispatch(uiActions.decreaseFontSize());
});

transport.on('move left req', () => {
  store_.dispatch(uiActions.moveLeft());
});

transport.on('move right req', () => {
  store_.dispatch(uiActions.moveRight());
});

transport.on('move jump req', (index) => {
  store_.dispatch(uiActions.moveTo(index));
});

transport.on('next pane req', () => {
  store_.dispatch(uiActions.moveToNextPane());
});

transport.on('prev pane req', () => {
  store_.dispatch(uiActions.moveToPreviousPane());
});

transport.on('open file', ({path}) => {
  store_.dispatch(uiActions.openFile(path));
});

transport.on('open ssh', (parsedUrl) => {
  store_.dispatch(uiActions.openSSH(parsedUrl));
});

transport.on('update available', ({releaseName, releaseNotes, releaseUrl, canInstall}) => {
  store_.dispatch(updaterActions.updateAvailable(releaseName, releaseNotes, releaseUrl, canInstall));
});

transport.on('move', (window) => {
  store_.dispatch(uiActions.windowMove(window));
});

transport.on('windowGeometry change', (data) => {
  store_.dispatch(uiActions.windowGeometryUpdated(data));
});

transport.on('add notification', ({text, url, dismissable}) => {
  store_.dispatch(addNotificationMessage(text, url, dismissable));
});

transport.on('enter full screen', () => {
  store_.dispatch(uiActions.enterFullScreen());
});

transport.on('leave full screen', () => {
  store_.dispatch(uiActions.leaveFullScreen());
});

const root = createRoot(document.getElementById('mount')!);

root.render(
  <Provider store={store_}>
    <HyperContainer />
  </Provider>
);

transport.on('reload', () => {
  plugins.reload();
});
