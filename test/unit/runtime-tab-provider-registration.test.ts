/** @file Ensures runtime tab providers are registered even when initially disabled. */
import {afterAll, beforeEach, expect, mock, test} from 'bun:test';

import {GOLDEN_PATH_PLUGIN_ID} from '@shared/runtime/golden-path-demo';

type RendererConfig = {
  plugins?: Record<string, Record<string, unknown>>;
};

const rendererConfigSubscriptions: Array<() => void> = [];
let rendererConfig: RendererConfig = {};
let importNonce = 0;

const subscribeRendererConfigMock = mock((listener: () => void) => {
  rendererConfigSubscriptions.push(listener);
  return () => {};
});

const registerPluginsModuleMocks = () => {
  mock.module('../../lib/utils/config', () => ({
    getConfig: () => rendererConfig,
    subscribe: subscribeRendererConfigMock
  }));

  mock.module('../../lib/utils/notify', () => ({
    default: () => {}
  }));

  mock.module('../../lib/utils/remote-plugins', () => ({
    loadRemotePluginsModule: () => ({
      getPaths: () => ({
        plugins: [],
        localPlugins: []
      }),
      getLoadedPluginVersions: () => [],
      getDeprecatedConfig: () => ({})
    })
  }));

  mock.module('../../lib/utils/ipc-child-process', () => ({
    default: {
      exec: () => {},
      execFile: () => {}
    }
  }));
};

beforeEach(() => {
  registerPluginsModuleMocks();
  rendererConfig = {};
  rendererConfigSubscriptions.length = 0;
  subscribeRendererConfigMock.mockClear();
});

afterAll(() => {
  mock.restore();
});

test('registers runtime tab providers for live enablement toggles', async () => {
  rendererConfig = {
    plugins: {
      [GOLDEN_PATH_PLUGIN_ID]: {
        enabled: false,
        tabPrefix: 'GP'
      }
    }
  };

  const plugins = await import(`../../lib/utils/plugins.ts?runtime_tab_provider_${importNonce++}`);

  expect(subscribeRendererConfigMock.mock.calls.length).toBeGreaterThan(0);

  const tab = {
    uid: 'tab-1',
    tabIndex: 0,
    isActive: true,
    hasActivity: false,
    title: 'Shell'
  };

  const disabledProps = plugins.getTabProps(tab, {}, {text: 'Shell'});
  expect(disabledProps.text).toBe('Shell');
  expect(disabledProps.tabIndex).toBe(tab.tabIndex);

  rendererConfig = {
    plugins: {
      [GOLDEN_PATH_PLUGIN_ID]: {
        enabled: true,
        tabPrefix: 'GP'
      }
    }
  };

  rendererConfigSubscriptions.forEach((listener) => {
    listener();
  });

  const enabledProps = plugins.getTabProps(tab, {}, {text: 'Shell'});
  expect(enabledProps.text).toBe('[GP] Shell');
});
