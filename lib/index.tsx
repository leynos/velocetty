/**
 * @file Renderer entry point.
 *
 * Mounts the Redux store and the application container, then starts the
 * renderer bootstrap with the action groups it dispatches. Start-up order is
 * load-config, then transport and plugin wiring, then first render.
 */
import './v8-snapshot-util';
import './tailwind.css';
import {webFrame} from 'electron';

import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';

import {loadConfig, reloadConfig} from './actions/config';
import init from './actions/index';
import {addNotificationMessage} from './actions/notifications';
import * as sessionActions from './actions/sessions';
import * as termGroupActions from './actions/term-groups';
import * as uiActions from './actions/ui';
import * as updaterActions from './actions/updater';
import {startRendererApplication} from './bootstrap/renderer-bootstrap';
import HyperContainer from './containers/hyper';
import rpc from './rpc';
import {transport} from './transport';
import configureStore from './store/configure-store';
import * as settingsTabActions from './actions/tab-strip';
import * as config from './utils/config';
import {getBase64FileData} from './utils/file';
import * as plugins from './utils/plugins';

const mountElement = document.querySelector('#mount');
if (!mountElement) {
  throw new Error('Expected renderer mount element with id "mount".');
}

startRendererApplication({
  actions: {
    addNotificationMessage,
    init,
    loadConfig,
    reloadConfig,
    sessionActions,
    settingsTabActions,
    termGroupActions,
    uiActions,
    updaterActions
  },
  config,
  configureStore,
  getBase64FileData,
  mountApp: (store) => {
    const root = createRoot(mountElement);
    root.render(
      <Provider store={store}>
        <HyperContainer />
      </Provider>
    );

    return root;
  },
  platform: process.platform,
  plugins,
  rpc,
  transport,
  webFrame,
  windowObject: globalThis
});
