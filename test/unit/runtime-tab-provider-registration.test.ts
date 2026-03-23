/** @file Ensures runtime tab providers are registered even when initially disabled. */
import {randomUUID} from 'node:crypto';

import {expect, mock, test} from 'bun:test';

import {GOLDEN_PATH_PLUGIN_ID} from '@shared/runtime/golden-path-demo';

type RendererConfig = {
  plugins?: Record<string, Record<string, unknown>>;
};

type RuntimeTabProviderHarness = {
  cleanup: () => void;
  notifyRendererConfigSubscribers: () => void;
  plugins: typeof import('../../lib/utils/plugins');
  setRendererConfig: (nextConfig: RendererConfig) => void;
  subscribeRendererConfigMock: typeof mock<(_: () => void) => () => void>;
};

const registerPluginsModuleMocks = (
  getRendererConfig: () => RendererConfig,
  subscribeRendererConfigMock: RuntimeTabProviderHarness['subscribeRendererConfigMock']
) => {
  mock.module('../../lib/utils/config', () => ({
    getConfig: () => getRendererConfig(),
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

const createRuntimeTabProviderHarness = async (): Promise<RuntimeTabProviderHarness> => {
  const rendererConfigSubscriptions: Array<() => void> = [];
  let rendererConfig: RendererConfig = {};
  const subscribeRendererConfigMock = mock((listener: () => void) => {
    rendererConfigSubscriptions.push(listener);
    return () => {};
  });
  let cleanupCalled = false;

  const cleanup = () => {
    if (cleanupCalled) {
      return;
    }
    cleanupCalled = true;
    mock.restore();
  };

  try {
    registerPluginsModuleMocks(() => rendererConfig, subscribeRendererConfigMock);
    const plugins = await import(`../../lib/utils/plugins.ts?runtime_tab_provider_${randomUUID()}`);

    return {
      cleanup,
      notifyRendererConfigSubscribers: () => {
        rendererConfigSubscriptions.forEach((listener) => {
          listener();
        });
      },
      plugins,
      setRendererConfig: (nextConfig) => {
        rendererConfig = nextConfig;
      },
      subscribeRendererConfigMock
    };
  } catch (error) {
    cleanup();
    throw error;
  }
};

test('registers runtime tab providers for live enablement toggles', async () => {
  const harness = await createRuntimeTabProviderHarness();
  try {
    harness.setRendererConfig({
      plugins: {
        [GOLDEN_PATH_PLUGIN_ID]: {
          enabled: false,
          tabPrefix: 'GP'
        }
      }
    });

    expect(harness.subscribeRendererConfigMock.mock.calls.length).toBeGreaterThan(0);

    const tab = {
      uid: 'tab-1',
      tabIndex: 0,
      isActive: true,
      hasActivity: false,
      title: 'Shell'
    };

    const disabledProps = harness.plugins.getTabProps(tab, {}, {text: 'Shell'});
    expect(disabledProps.text).toBe('Shell');
    expect(disabledProps.tabIndex).toBe(tab.tabIndex);

    harness.setRendererConfig({
      plugins: {
        [GOLDEN_PATH_PLUGIN_ID]: {
          enabled: true,
          tabPrefix: 'GP'
        }
      }
    });

    harness.notifyRendererConfigSubscribers();

    const enabledProps = harness.plugins.getTabProps(tab, {}, {text: 'Shell'});
    expect(enabledProps.text).toBe('[GP] Shell');
  } finally {
    harness.cleanup();
  }
});
