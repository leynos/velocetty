/** @file Verifies config watching covers keybindings.json5 and reloads through the existing path. */
import {expect, mock, test} from 'bun:test';

import type {parsedConfig} from '@shared/types/config';
import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';

let moduleInstanceCounter = 0;

const makeParsedConfig = (keymaps: Record<string, string[]>): parsedConfig =>
  ({
    config: {
      defaultProfile: 'default',
      profiles: [{name: 'default', config: {}}]
    },
    plugins: [],
    localPlugins: [],
    keymaps
  }) as parsedConfig;

test.serial(
  'setup watches config.json5 and keybindings.json5, then reloads keymaps on keybindings changes',
  async () => {
    mock.restore();
    const notifyMock = mock((_title: string, _body?: string) => {});
    const subscriberMock = mock(() => {});
    const appOnMock = mock((_event: string, _handler: () => void) => {});
    const watcherMock = {
      close: mock(async () => {}),
      getWatched: () => ({'/tmp': ['config.json5', 'keybindings.json5']}),
      on: mock((_event: string, _handler: () => void) => watcherMock)
    };
    const watchMock = mock((_paths: string[]) => watcherMock);
    let currentConfig = makeParsedConfig({'window:new': ['ctrl+n']});
    const importMock = mock(() => currentConfig);

    resetElectronMock();
    registerElectronMock();
    const electronApp = getElectronMock().app as Record<string, unknown>;
    electronApp.on = appOnMock;
    mock.module('chokidar', () => ({
      default: {
        watch: watchMock
      }
    }));
    const importModuleFactory = () => ({
      _import: importMock,
      getDefaultConfig: () => ({config: {colors: {}}})
    });
    mock.module('../../app/config/import', importModuleFactory);
    mock.module('../../app/config/import.ts', importModuleFactory);
    const openModuleFactory = () => ({
      default: () => true
    });
    mock.module('../../app/config/open', openModuleFactory);
    mock.module('../../app/config/open.ts', openModuleFactory);
    const pathsModuleFactory = () => ({
      cfgDir: '/tmp',
      cfgPath: '/tmp/config.json5',
      keybindingsPath: '/tmp/keybindings.json5'
    });
    mock.module('../../app/config/paths', pathsModuleFactory);
    mock.module('../../app/config/paths.ts', pathsModuleFactory);
    const windowsModuleFactory = () => ({
      defaults: {},
      get: () => ({}),
      recordState: () => {}
    });
    mock.module('../../app/config/windows', windowsModuleFactory);
    mock.module('../../app/config/windows.ts', windowsModuleFactory);
    const notifyModuleFactory = () => ({
      default: notifyMock
    });
    mock.module('../../app/notify', notifyModuleFactory);
    mock.module('../../app/notify.ts', notifyModuleFactory);
    const colorsModuleFactory = () => ({
      getColorMap: () => ({})
    });
    mock.module('../../app/utils/colors', colorsModuleFactory);
    mock.module('../../app/utils/colors.ts', colorsModuleFactory);

    moduleInstanceCounter += 1;
    const configModule = await import(`../../app/config.ts?config_keybindings_watch_${moduleInstanceCounter}`);

    configModule.setup();
    configModule.subscribe(subscriberMock);

    expect(watchMock).toHaveBeenCalledWith(['/tmp/config.json5', '/tmp/keybindings.json5']);

    currentConfig = makeParsedConfig({'window:new': ['ctrl+shift+n']});
    const changeHandler = watcherMock.on.mock.calls.find(([event]) => event === 'change')?.[1];
    expect(changeHandler).toBeFunction();

    changeHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(importMock).toHaveBeenCalledTimes(2);
    expect(subscriberMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith('Configuration updated', 'Hyper configuration reloaded!');
    expect(configModule.getKeymaps()).toEqual({'window:new': ['ctrl+shift+n']});

    mock.restore();
  }
);
