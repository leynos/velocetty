import './v8-snapshot-util';
import './tailwind.css';
import {webFrame} from 'electron';

import Mousetrap from 'mousetrap';
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
import {composeRendererDispatcher} from './command-dispatch/compose';
import {CommandDispatcherProvider} from './command-dispatch/inbound/command-dispatcher-provider';
import HyperContainer from './containers/hyper';
import rpc from './rpc';
import {transport} from './transport';
import configureStore from './store/configure-store';
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
    termGroupActions,
    uiActions,
    updaterActions
  },
  config,
  configureStore,
  getBase64FileData,
  mountApp: (store) => {
    // One dispatcher for the whole renderer: keybindings, UI controls, and
    // plugins all reach commands through this bundle.
    const bundle = composeRendererDispatcher({
      dispatch: store.dispatch,
      emitHostCommand: (id) => transport.emit('command', id),
      getMousetrap: () => {
        const instance = Mousetrap(document.body);
        instance.stopCallback = () => {
          // All events should be intercepted even if focus is in an input/textarea
          return false;
        };
        return instance;
      }
    });

    const root = createRoot(mountElement);
    root.render(
      <Provider store={store}>
        <CommandDispatcherProvider bundle={bundle}>
          <HyperContainer />
        </CommandDispatcherProvider>
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
