/** @file Verifies config watching covers keybindings.json5 and reloads through the existing path. */
import {expect, mock, test} from 'bun:test';

import type {parsedConfig, rawConfig} from '@shared/types/config';
import {_init} from '../../app/config/init';
import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {registerModuleMock} from '../testUtils/mock-module';

let moduleInstanceCounter = 0;

const baseRawConfig: rawConfig = {
  config: {
    css: '',
    defaultProfile: 'default',
    profiles: [{name: 'default', config: {}}],
    termCSS: ''
  },
  plugins: [],
  localPlugins: [],
  keymaps: {}
};

const makeParsedConfig = (keymaps: Record<string, string[]>): parsedConfig =>
  _init(structuredClone(baseRawConfig), {...structuredClone(baseRawConfig), keymaps}, () => {});

const openModuleFactory = () => ({default: () => true});
const pathsModuleFactory = () => ({
  cfgDir: '/tmp',
  cfgPath: '/tmp/config.json5',
  defaultCfg: '/tmp/config-default.json',
  defaultPlatformKeyPath: () => '/tmp/linux.json',
  keybindingsPath: '/tmp/keybindings.json5',
  plugs: {base: '/tmp/plugins', local: '/tmp/plugins/local'},
  schemaFile: 'schema.json',
  schemaPath: '/tmp/schema.json'
});
const windowsModuleFactory = () => ({defaults: {}, get: () => ({}), recordState: () => {}});
const coloursModuleFactory = () => ({getColorMap: () => ({})});

/** Registers one factory under both the extensionless and `.ts` specifiers Bun may resolve. */
const registerAppModuleMock = <Exports>(specifier: string, factory: () => Exports) => {
  registerModuleMock(specifier, factory);
  registerModuleMock(`${specifier}.ts`, factory);
};

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
    Object.assign(getElectronMock().app, {on: appOnMock});
    registerModuleMock('chokidar', () => ({default: {watch: watchMock}}));
    registerAppModuleMock('../../app/config/import', () => ({
      createConfigImportModule: () => ({
        _import: importMock,
        getDefaultConfig: () => ({config: {colors: {}}})
      })
    }));
    registerAppModuleMock('../../app/config/open', openModuleFactory);
    registerAppModuleMock('../../app/config/paths', pathsModuleFactory);
    registerAppModuleMock('../../app/config/windows', windowsModuleFactory);
    registerAppModuleMock('../../app/notify', () => ({default: notifyMock}));
    registerAppModuleMock('../../app/utils/colours', coloursModuleFactory);

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
