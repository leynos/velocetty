/** @file Imports `app/config.ts` over mocked chokidar, electron, and config adapters. */
/*
 * The composition root is only observable through its collaborators, so this
 * harness registers one stub for each of them. It lives apart from the watcher
 * spec to keep both files within the repository's file-size limit.
 */
import {mock} from 'bun:test';
import path from 'node:path';

import type {ConfigImportReport} from '../../app/config/import-report';
import type {KeybindingsLoadOutcome} from '../../app/config/keybindings';
import type {WrittenWatchedFile} from '../../app/config/watched-file-stamp';
import type {parsedConfig, rawConfig} from '@shared/types/config';
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

/**
 * Builds a parsed configuration whose keymaps are the given bindings.
 *
 * @param keymaps - Command identifiers mapped to their binding lists.
 * @returns The configuration `_init` produces for that raw document.
 */
export const makeParsedConfig = (keymaps: Record<string, string[]>): parsedConfig =>
  _init(structuredClone(baseRawConfig), {...structuredClone(baseRawConfig), keymaps}, () => {});

/** Stands in for the `open` adapter, which the composition root only calls. */
const openModuleFactory = () => ({default: () => true});

/** The resolved configuration paths the harness presents to the composition root. */
type HarnessPaths = Readonly<{
  readonly cfgDir: string;
  readonly cfgPath: string;
  readonly keybindingsPath: string;
}>;

/** Stands in for the resolved paths, so no test reads the real home directory. */
const pathsModuleFactory = ({cfgDir, cfgPath, keybindingsPath}: HarnessPaths) => ({
  cfgDir,
  cfgPath,
  // The composition root names the active tree in every import record.
  configTree: 'velocetty',
  // The stub paths are always readable, so start-up may bootstrap as before.
  configInspection: 'ok',
  defaultCfg: path.join(cfgDir, 'config-default.json'),
  defaultPlatformKeyPath: () => path.join(cfgDir, 'linux.json'),
  keybindingsDir: cfgDir,
  keybindingsPath,
  keybindingsSchemaFile: 'keybindings.schema.json',
  keybindingsSchemaPath: path.join(cfgDir, 'keybindings.schema.json'),
  plugs: {base: path.join(cfgDir, 'plugins'), local: path.join(cfgDir, 'plugins', 'local')},
  schemaFile: 'schema.json',
  schemaPath: path.join(cfgDir, 'schema.json'),
  shadowedConfigPaths: ['/home/user/.hyper/config.json5'],
  velocettyDir: cfgDir
});
/** Stands in for the window-state store, which the composition root only wires. */
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
  /** The config file the composition root watches and stamps. */
  readonly cfgPath: string;
  /** The keybindings file the composition root watches and stamps. */
  readonly keybindingsPath: string;
  readonly notifyMock: ReturnType<typeof mock>;
  readonly storeCleanupMock: ReturnType<typeof mock>;
  readonly subscriberMock: ReturnType<typeof mock>;
  readonly watchMock: ReturnType<typeof mock>;
  readonly watcherMock: WatchMock;
  readonly emit: (request: EmitRequest) => void;
  /** Completes chokidar's initial scan, which triggers readiness reconciliation. */
  readonly emitReady: () => void;
  /** Makes the next stale-file cleanup throw, to exercise preparation failure. */
  readonly setCleanupError: (error: unknown) => void;
  readonly setReport: (report: ConfigImportReport) => void;
  readonly setConfig: (config: parsedConfig) => void;
  readonly setOutcome: (outcome: KeybindingsLoadOutcome) => void;
  /**
   * Declares the files the start-up import reports it wrote, with the text it
   * applied from each.
   *
   * A test that wants the composition root to settle a written file states the
   * file and text here. The default is empty, which reports that start-up wrote
   * nothing: the stub never derives this list from the keybindings outcome.
   */
  readonly setWrittenFiles: (files: readonly WrittenWatchedFile[]) => void;
};

/** Options for a harness instance; the default directory keeps older tests unchanged. */
export type WatchHarnessOptions = Readonly<{
  /** Directory the composition root treats as the Velocetty tree. */
  readonly configDir?: string;
  /**
   * Runs inside the importer, before it returns.
   *
   * A test uses this to land a filesystem change at the exact point the import
   * has read the files but the composition root has not yet started watching.
   */
  readonly onImport?: (phase: string) => void;
}>;

/** The watcher events the configuration module subscribes to. */
type WatchEvent = 'add' | 'change' | 'unlink';

/** The handler chokidar calls with the path that changed. */
type WatchHandler = (eventPath: string) => void;

/** The subset of chokidar's watcher surface the config module uses. */
type WatchMock = {
  close: ReturnType<typeof mock>;
  getWatched: () => Record<string, string[]>;
  // Readiness uses a zero-argument listener, so the event name is widened
  // beyond the file events the reload path subscribes to.
  on: ReturnType<typeof mock<(...args: [event: string, handler: WatchHandler]) => WatchMock>>;
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

/** Imports a fresh `app/config.ts` instance over mocked chokidar and electron. */
export const createWatchHarness = async (options: WatchHarnessOptions = {}): Promise<WatchHarness> => {
  mock.restore();
  const cfgDir = options.configDir ?? '/tmp';
  const cfgPath = path.join(cfgDir, 'config.json5');
  const keybindingsPath = path.join(cfgDir, 'keybindings.json5');
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
    on: mock((..._args: [event: string, handler: WatchHandler]) => watcherMock)
  };
  const watchMock = mock((_paths: string[], _options?: unknown) => watcherMock);

  let currentConfig = makeParsedConfig({'window:new': ['ctrl+n']});
  let currentReport: ConfigImportReport = {config: 'applied', keybindings: 'applied'};
  // An explicit outcome overrides the one derived from the report, so a test
  // can exercise causes the report vocabulary cannot express, such as an
  // unreadable keybindings file.
  let currentOutcome: KeybindingsLoadOutcome | undefined;
  /** The files the stub importer reports it wrote; empty unless a test says otherwise. */
  let currentWrittenFiles: readonly WrittenWatchedFile[] = [];
  const importMock = mock((..._args: unknown[]) => {
    callOrder.push('import');
    options.onImport?.(String(_args[0]));
    const outcome = currentOutcome ?? outcomeFor(currentReport);
    return {
      config: currentConfig,
      keybindings: outcome,
      report: currentReport,
      writtenFiles: currentWrittenFiles
    };
  });

  resetElectronMock();
  registerElectronMock();
  Object.assign(getElectronMock().app, {on: appOnMock});
  registerModuleMock('chokidar', () => ({default: {watch: watchMock}}));
  registerAppModuleMock({
    factory: () => ({
      // Decoration uses the palette the import applied, so the stub importer
      // exposes no query at all: a reintroduced bundled-file read during
      // decoration would fail rather than pass unnoticed.
      createConfigImportModule: () => ({_import: importMock})
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
  registerAppModuleMock({
    factory: () => pathsModuleFactory({cfgDir, cfgPath, keybindingsPath}),
    specifier: '../../app/config/paths'
  });
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

  /** Completes the initial scan the way chokidar does, with no path argument. */
  const emitReady = () => {
    const handlers = watcherMock.on.mock.calls.filter(([name]) => name === 'ready').map(([, handler]) => handler);
    for (const handler of handlers) {
      // SAFETY: the 'ready' subscription is chokidar's zero-argument listener,
      // which the widened `WatchMock` event signature cannot express.
      (handler as () => void)();
    }
  };

  return {
    appOnMock,
    callOrder,
    cfgPath,
    configModule,
    emit,
    emitReady,
    importMock,
    keybindingsPath,
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
    setWrittenFiles: (files) => {
      currentWrittenFiles = files;
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
