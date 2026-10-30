/** @file Verifies the config watcher covers both files and reports reloads honestly. */
import path from 'node:path';

import {expect, mock, test} from 'bun:test';

import type {ConfigImportReport} from '../../app/config/import-report';
import type {parsedConfig, rawConfig} from '@shared/types/config';
import {_init} from '../../app/config/init';
import {getElectronMock, registerElectronMock, resetElectronMock} from '../testUtils/electron-path';
import {registerModuleMock} from '../testUtils/mock-module';

let moduleInstanceCounter = 0;

const DEBOUNCE_SETTLE_MS = 160;

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
  keybindingsDir: '/tmp',
  keybindingsPath: '/tmp/keybindings.json5',
  keybindingsSchemaFile: 'keybindings.schema.json',
  keybindingsSchemaPath: '/tmp/keybindings.schema.json',
  plugs: {base: '/tmp/plugins', local: '/tmp/plugins/local'},
  schemaFile: 'schema.json',
  schemaPath: '/tmp/schema.json',
  shadowedConfigPaths: ['/home/user/.hyper/config.json5'],
  velocettyDir: '/tmp'
});
const windowsModuleFactory = () => ({defaults: {}, get: () => ({}), recordState: () => {}});
const coloursModuleFactory = () => ({getColorMap: () => ({})});

/** One module factory to register, with the specifier Bun should resolve it under. */
type AppModuleMockRequest<Exports> = Readonly<{
  readonly factory: () => Exports;
  readonly specifier: string;
}>;

/** Registers one factory under both the extensionless and `.ts` specifiers Bun may resolve. */
const registerAppModuleMock = <Exports>({factory, specifier}: AppModuleMockRequest<Exports>) => {
  registerModuleMock(specifier, factory);
  registerModuleMock(`${specifier}.ts`, factory);
};

/** One watcher event delivered to every handler registered for its name. */
type EmitRequest = Readonly<{
  readonly event: WatchEvent;
  readonly eventPath: string;
}>;

type WatchHarness = {
  readonly appOnMock: ReturnType<typeof mock>;
  readonly configModule: typeof import('../../app/config.ts');
  readonly importMock: ReturnType<typeof mock>;
  readonly notifyMock: ReturnType<typeof mock>;
  readonly subscriberMock: ReturnType<typeof mock>;
  readonly watchMock: ReturnType<typeof mock>;
  readonly watcherMock: WatchMock;
  readonly emit: (request: EmitRequest) => void;
  readonly setReport: (report: ConfigImportReport) => void;
  readonly setConfig: (config: parsedConfig) => void;
};

/** The watcher events the configuration module subscribes to. */
type WatchEvent = 'add' | 'change' | 'unlink';

/** The handler chokidar calls with the path that changed. */
type WatchHandler = (eventPath: string) => void;

/** The subset of chokidar's watcher surface the config module uses. */
type WatchMock = {
  close: ReturnType<typeof mock>;
  getWatched: () => Record<string, string[]>;
  on: ReturnType<typeof mock<(...args: [event: WatchEvent, handler: WatchHandler]) => WatchMock>>;
};

/** Imports a fresh `app/config.ts` instance over mocked chokidar and electron. */
const createWatchHarness = async (): Promise<WatchHarness> => {
  mock.restore();
  // These stand-ins ignore their arguments; recording them without naming their
  // types keeps the harness free to assert on whatever the module passes.
  const notifyMock = mock((..._args: unknown[]) => {});
  const subscriberMock = mock(() => {});
  const appOnMock = mock((..._args: unknown[]) => {});
  const watcherMock: WatchMock = {
    close: mock(async () => {}),
    getWatched: () => ({'/tmp': ['config.json5', 'keybindings.json5']}),
    on: mock((..._args: [event: WatchEvent, handler: WatchHandler]) => watcherMock)
  };
  const watchMock = mock((_paths: string[], _options?: unknown) => watcherMock);

  let currentConfig = makeParsedConfig({'window:new': ['ctrl+n']});
  let currentReport: ConfigImportReport = {config: 'applied', keybindings: 'applied'};
  const importMock = mock((..._args: unknown[]) => ({config: currentConfig, report: currentReport}));

  resetElectronMock();
  registerElectronMock();
  Object.assign(getElectronMock().app, {on: appOnMock});
  registerModuleMock('chokidar', () => ({default: {watch: watchMock}}));
  registerAppModuleMock({
    factory: () => ({
      createConfigImportModule: () => ({
        _import: importMock,
        getDefaultConfig: () => ({config: {colors: {}}})
      })
    }),
    specifier: '../../app/config/import'
  });
  registerAppModuleMock({factory: openModuleFactory, specifier: '../../app/config/open'});
  registerAppModuleMock({factory: pathsModuleFactory, specifier: '../../app/config/paths'});
  registerAppModuleMock({factory: windowsModuleFactory, specifier: '../../app/config/windows'});
  registerAppModuleMock({factory: () => ({default: notifyMock}), specifier: '../../app/notify'});
  registerAppModuleMock({factory: coloursModuleFactory, specifier: '../../app/utils/colours'});

  moduleInstanceCounter += 1;
  const configModule = await import(`../../app/config.ts?config_keybindings_watch_${moduleInstanceCounter}`);

  const emit = ({event, eventPath}: EmitRequest) => {
    const handlers = watcherMock.on.mock.calls.filter(([name]) => name === event).map(([, handler]) => handler);
    for (const handler of handlers) {
      handler(eventPath);
    }
  };

  return {
    appOnMock,
    configModule,
    emit,
    importMock,
    notifyMock,
    setConfig: (config) => {
      currentConfig = config;
    },
    setReport: (report) => {
      currentReport = report;
    },
    subscriberMock,
    watchMock,
    watcherMock
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_SETTLE_MS));

test.serial('setup watches the configuration directory once, filtered to both files', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();

    expect(harness.watchMock).toHaveBeenCalledTimes(1);
    // The active config and the keybindings file share `/tmp`, so one
    // directory watch covers both without watching the tree recursively.
    // `path.resolve` makes the expectation portable: Windows turns the
    // mock's `/tmp` into a drive-qualified path.
    expect(harness.watchMock.mock.calls[0]?.[0]).toEqual([path.resolve('/tmp')]);
    expect(harness.watchMock.mock.calls[0]?.[1]).toEqual({depth: 0, ignoreInitial: true});
  } finally {
    mock.restore();
  }
});

test.serial('add and unlink events reload, and only applied reports notify', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    harness.setConfig(makeParsedConfig({'window:new': ['ctrl+shift+n']}));

    harness.emit({event: 'add', eventPath: '/tmp/keybindings.json5'});
    await settle();

    expect(harness.importMock.mock.calls.map(([phase]) => phase)).toEqual(['startup', 'reload']);
    expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock).toHaveBeenCalledWith('Configuration updated', 'Configuration reloaded!');

    harness.setReport({config: 'applied', keybindings: 'kept'});
    harness.emit({event: 'unlink', eventPath: '/tmp/keybindings.json5'});
    await settle();

    expect(harness.importMock).toHaveBeenCalledTimes(3);
    expect(harness.subscriberMock).toHaveBeenCalledTimes(2);
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);

    harness.setReport({config: 'fallback', keybindings: 'applied'});
    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await settle();

    expect(harness.importMock).toHaveBeenCalledTimes(4);
    expect(harness.notifyMock).toHaveBeenCalledTimes(1);
  } finally {
    mock.restore();
  }
});

test.serial('a burst touching both files reloads once and stays quiet when keybindings are kept', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    harness.configModule.subscribe(harness.subscriberMock);
    harness.setReport({config: 'applied', keybindings: 'kept'});

    harness.emit({event: 'change', eventPath: '/tmp/config.json5'});
    await new Promise((resolve) => setTimeout(resolve, 20));
    harness.emit({event: 'change', eventPath: '/tmp/keybindings.json5'});
    await settle();

    expect(harness.importMock.mock.calls.map(([phase]) => phase)).toEqual(['startup', 'reload']);
    expect(harness.subscriberMock).toHaveBeenCalledTimes(1);
    expect(harness.notifyMock).not.toHaveBeenCalled();
  } finally {
    mock.restore();
  }
});

test.serial('events for unwatched files do not reload', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    harness.emit({event: 'change', eventPath: '/tmp/schema.json'});
    await settle();
    expect(harness.importMock.mock.calls.map(([phase]) => phase)).toEqual(['startup']);
  } finally {
    mock.restore();
  }
});

test.serial('the watcher closes on before-quit', async () => {
  const harness = await createWatchHarness();
  try {
    harness.configModule.setup();
    const quitHandler = harness.appOnMock.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    expect(quitHandler).toBeFunction();
    // SAFETY: the matcher above fails the test unless a handler was registered.
    const notifyQuit = quitHandler as () => void;

    notifyQuit();

    expect(harness.watcherMock.close).toHaveBeenCalledTimes(1);
  } finally {
    mock.restore();
  }
});
