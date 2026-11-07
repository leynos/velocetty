/** @file Imports `app/config.ts` over mocked chokidar, electron, and config adapters. */
/*
 * The composition root is only observable through its collaborators, so this
 * harness registers one stub for each of them. It lives apart from the watcher
 * spec to keep both files within the repository's file-size limit.
 */
import {mock} from 'bun:test';

import type {ConfigImportReport} from '../../app/config/import-report';
import type {KeybindingsLoadOutcome} from '../../app/config/keybindings';
import type {ColorMap, parsedConfig, rawConfig} from '@shared/types/config';
import {_init} from '../../app/config/init';
import {getElectronMock, registerElectronMock, resetElectronMock} from './electron-path';
import {registerModuleMock} from './mock-module';

let moduleInstanceCounter = 0;

/** Long enough for the watcher's 100ms debounce to fire once. */
export const DEBOUNCE_SETTLE_MS = 160;

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

export const makeParsedConfig = (keymaps: Record<string, string[]>): parsedConfig =>
  _init(structuredClone(baseRawConfig), {...structuredClone(baseRawConfig), keymaps}, () => {});

const openModuleFactory = () => ({default: () => true});
const pathsModuleFactory = () => ({
  cfgDir: '/tmp',
  cfgPath: '/tmp/config.json5',
  // The composition root names the active tree in every import record.
  configTree: 'velocetty',
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
export type EmitRequest = Readonly<{
  readonly event: WatchEvent;
  readonly eventPath: string;
}>;

export type WatchHarness = {
  readonly appOnMock: ReturnType<typeof mock>;
  readonly configModule: typeof import('../../app/config.ts');
  readonly importMock: ReturnType<typeof mock>;
  readonly callOrder: string[];
  readonly notifyMock: ReturnType<typeof mock>;
  readonly storeCleanupMock: ReturnType<typeof mock>;
  readonly subscriberMock: ReturnType<typeof mock>;
  readonly watchMock: ReturnType<typeof mock>;
  readonly watcherMock: WatchMock;
  readonly emit: (request: EmitRequest) => void;
  /** Makes the next stale-file cleanup throw, to exercise preparation failure. */
  readonly setCleanupError: (error: unknown) => void;
  readonly setReport: (report: ConfigImportReport) => void;
  readonly setConfig: (config: parsedConfig) => void;
  readonly setOutcome: (outcome: KeybindingsLoadOutcome) => void;
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

/**
 * The keybindings outcome a stub importer returns for a given summary.
 *
 * The composition root records this outcome, so the stub must report a state
 * consistent with the report it also returns.
 */
const outcomeFor = (report: ConfigImportReport): KeybindingsLoadOutcome =>
  report.keybindings === 'applied'
    ? {keymaps: {}, kind: 'applied', origin: 'file'}
    : {
        basis: 'last-known-good',
        cause: report.keybindings === 'unchanged' ? 'deferred' : 'invalid',
        diagnostics: [],
        keymaps: {},
        kind: 'kept'
      };

/** Variations a test can ask of the composition root's collaborators. */
export type WatchHarnessOptions = Readonly<{
  /** The bundled colour defaults the stubbed importer reports. */
  readonly bundledColors?: Partial<ColorMap>;
}>;

/** Imports a fresh `app/config.ts` instance over mocked chokidar and electron. */
export const createWatchHarness = async (options: WatchHarnessOptions = {}): Promise<WatchHarness> => {
  mock.restore();
  // These stand-ins ignore their arguments; recording them without naming their
  // types keeps the harness free to assert on whatever the module passes.
  const callOrder: string[] = [];
  const notifyMock = mock((..._args: unknown[]) => {});
  let cleanupError: unknown;
  const storeCleanupMock = mock(() => {
    callOrder.push('cleanup');
    if (cleanupError !== undefined) throw cleanupError;
  });
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
  // An explicit outcome overrides the one derived from the report, so a test
  // can exercise causes the report vocabulary cannot express, such as an
  // unreadable keybindings file.
  let currentOutcome: KeybindingsLoadOutcome | undefined;
  const importMock = mock((..._args: unknown[]) => {
    callOrder.push('import');
    return {
      config: currentConfig,
      keybindings: currentOutcome ?? outcomeFor(currentReport),
      report: currentReport
    };
  });

  resetElectronMock();
  registerElectronMock();
  Object.assign(getElectronMock().app, {on: appOnMock});
  registerModuleMock('chokidar', () => ({default: {watch: watchMock}}));
  registerAppModuleMock({
    factory: () => ({
      createConfigImportModule: () => ({
        _import: importMock,
        // The real query returns a whole `rawConfig`; a bundled file that could
        // not be read has no `config` section, so the stub mirrors that shape.
        getDefaultConfig: () => ({
          defaults: options.bundledColors === undefined ? {} : {config: {colors: options.bundledColors}},
          platformKeymapFault: false
        })
      })
    }),
    specifier: '../../app/config/import'
  });
  registerAppModuleMock({
    factory: () => ({
      createFileKeybindingsStore: () => ({
        label: 'keybindings.json5',
        peek: () => ({kind: 'missing'}),
        read: () => ({kind: 'missing'}),
        removeStaleTemporaryFiles: storeCleanupMock,
        write: () => ({kind: 'written'})
      })
    }),
    specifier: '../../app/config/keybindings-store'
  });
  registerAppModuleMock({factory: openModuleFactory, specifier: '../../app/config/open'});
  registerAppModuleMock({factory: pathsModuleFactory, specifier: '../../app/config/paths'});
  registerAppModuleMock({factory: windowsModuleFactory, specifier: '../../app/config/windows'});
  registerAppModuleMock({factory: () => ({default: notifyMock}), specifier: '../../app/notify'});
  // `app/utils/colours` is deliberately left real: it is a leaf module, and a
  // test that inspects the composed defaults must see the same layering the
  // application performs.

  moduleInstanceCounter += 1;
  const configModule = await import(`../../app/config.ts?config_keybindings_watch_${moduleInstanceCounter}`);

  /** Dispatches an event to every handler chokidar registered for it. */
  const emit = ({event, eventPath}: EmitRequest) => {
    const handlers = watcherMock.on.mock.calls.filter(([name]) => name === event).map(([, handler]) => handler);
    for (const handler of handlers) {
      handler(eventPath);
    }
  };

  return {
    appOnMock,
    callOrder,
    configModule,
    emit,
    importMock,
    notifyMock,
    storeCleanupMock,
    setCleanupError: (error) => {
      cleanupError = error;
    },
    setConfig: (config) => {
      currentConfig = config;
    },
    setOutcome: (outcome) => {
      currentOutcome = outcome;
    },
    setReport: (report) => {
      currentReport = report;
    },
    subscriberMock,
    watchMock,
    watcherMock
  };
};

/** Waits past the debounce interval so a queued reload has run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_SETTLE_MS));
