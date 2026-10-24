/**
 * @file Executes the app entry point and asserts the branch it takes.
 *
 * `app/index.mts` dispatches on `process.argv` while its module body runs, and
 * both of its imports are dynamic, so this suite drives the real file rather
 * than reading its source. Text assertions cannot tell the branches apart: a
 * negated condition keeps every `console.log` string and the `app.quit()` call
 * in place while sending `--help` down the startup path. Only evaluation shows
 * which statements actually ran.
 *
 * Each case imports the entry point under its own query string, so Bun
 * evaluates the module afresh instead of serving the first evaluation's cached
 * side effects. Every case is therefore `test.serial`: the suite replaces
 * `process.argv`, `process.exitCode`, `console`, and the module mocks, and the
 * runner shares that global state across files in one process.
 *
 * The mocks are keyed on the `.js`-suffixed specifiers the entry point itself
 * imports (`./config.js` resolves to `app/config.ts` on disk). Bun keys a mock
 * by the specifier as written, so a key naming the real `.ts` file does not
 * intercept it; the `.js` name is what the entry point asks for.
 *
 * Cross-links:
 * - Source: `app/index.mts`
 * - Harness: `test/testUtils/electron-path.ts`, `test/testUtils/import-fresh.ts`
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';

import {readFileSync} from 'node:fs';
import path from 'node:path';

import {getElectronMock, registerElectronMock} from '../testUtils/electron-path';
import {importFresh} from '../testUtils/import-fresh';
import {registerModuleMock} from '../testUtils/mock-module';

const entryPoint = '../../app/index.mts';

/**
 * The absolute specifier the entry point imports, spelled with `.js`.
 *
 * `app/config.js` need not exist: Bun compiles the entry point's `./config.js`
 * to `app/config.ts`, and the mock is keyed on this string either way.
 */
const stubSpecifier = (fileName: string): string => path.resolve(import.meta.dir, '../..', 'app', fileName);

const configStubPath = stubSpecifier('config.js');
const packageJsonStubPath = stubSpecifier('package.json');
const startStubPath = stubSpecifier('start.js');

/**
 * The real `app/package.json` contents, so the stub below stays faithful.
 *
 * Reading the file instead of hard-coding a version keeps this suite honest:
 * its own assertions look for the real version prefix, and any other suite that
 * inherits the registration sees the same metadata the module really exports.
 */
const packageMetadata = parsePackageMetadata();

/** Reads the metadata the stub below spreads. */
function parsePackageMetadata(): {readonly productName: string; readonly version: string} {
  const contents = readFileSync(path.join(import.meta.dir, '../../app/package.json'), 'utf8');
  // SAFETY: `app/package.json` is a repository file whose `productName` and
  // `version` fields are strings, which the assertions below read as text.
  return JSON.parse(contents) as {readonly productName: string; readonly version: string};
}

/**
 * Where the shared config stub finds the behaviour for the current case.
 *
 * `beforeEach` points this at the case's own stub and `afterEach` empties it.
 * The module mocks cannot be unregistered per case, so nothing here may be
 * left callable once a case finishes.
 */
type ConfigSetupStub = {setup: () => void};

let activeConfigStub: ConfigSetupStub | undefined;

/** Refuses a call that arrives after the case which installed it finished. */
const requireActiveConfigStub = (): ConfigSetupStub => {
  if (!activeConfigStub) {
    throw new Error('A configuration stub was called outside the case that installed it.');
  }
  return activeConfigStub;
};

/** Records what the entry point did, in order. */
type EntryTrace = {
  readonly labels: string[];
  readonly appStart: () => number;
};

/** A private trace, so a case cannot read another case's calls. */
const createTrace = (): EntryTrace => {
  const labels: string[] = [];
  return {
    labels,
    appStart: () => labels.push('app.start')
  };
};

/** The stub `config.setup()` resolves to while a case runs. */
const recordConfigurationSetup = (): ConfigSetupStub => ({
  setup: () => {
    trace.labels.push('configuration.setup');
  }
});

/**
 * Registers the stubs the entry point imports.
 *
 * `start` records only its own evaluation. Importing the real module would pull
 * in the whole main process, which needs a live Electron runtime.
 *
 * The factories read the state each case installs rather than closing over one
 * case's trace, so a case changes behaviour by changing that state.
 *
 * The config stub must also answer with every export another suite could ask
 * that module for. `getDefaultProfile` is one: `test/unit/updater.test.ts`
 * imports it from `../../app/config`, and a stub carrying only `setup` breaks
 * it, because Bun maps this `.js` key onto the shared `app/config.ts` entry.
 *
 * The metadata stub is the mirror image of that hazard. Bun keeps one mock
 * registry for the whole process, so a double another suite registered first —
 * `updater.test.ts` had a `{version}`-only one — is still in force when this
 * suite imports the entry point, and its `default` import of the metadata
 * object throws `Missing 'default' export`. A later registration replaces an
 * earlier one, so claiming the module here makes this suite independent of
 * file order rather than dependent on another suite's discipline.
 */
const registerEntryStubs = (): void => {
  registerModuleMock(configStubPath, () => ({
    setup: () => {
      requireActiveConfigStub().setup();
    },
    getDefaultProfile: () => 'default'
  }));
  registerModuleMock(packageJsonStubPath, () => ({
    ...packageMetadata,
    default: packageMetadata
  }));
  registerModuleMock(startStubPath, () => {
    trace.appStart();
    return {};
  });
};

/** The console output a single entry-point evaluation produced. */
type CapturedOutput = {readonly lines: string[]};

/** Collects the entry point's console output instead of printing it. */
const captureConsole = (): CapturedOutput => {
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    lines.push(`ERROR ${args.map(String).join(' ')}`);
  };
  return {lines};
};

const originalArgv = process.argv;
// Read once, before any case can set it. `process.exitCode` is non-configurable
// in Bun, so it cannot be deleted, and assigning `undefined` does not clear a
// value already recorded. Restoring `0` is what actually clears it.
const originalExitCode = process.exitCode ?? 0;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

let trace: EntryTrace;
let output: CapturedOutput;
let quits: number;

// Registered once, before any case runs. Re-registering a mock inside
// `beforeEach` makes Bun discard the entry it had already resolved and invoke
// the factory again outside any case, so the registrations live at module
// scope and each case only changes the state the factories read.
registerEntryStubs();

beforeEach(() => {
  trace = createTrace();
  output = captureConsole();
  activeConfigStub = recordConfigurationSetup();
  quits = 0;
  getElectronMock().app.quit = () => {
    quits += 1;
  };
  registerElectronMock();
});

afterEach(() => {
  process.argv = originalArgv;
  // The last case deliberately leaves a failing exit code behind; without this
  // reset it would become the test runner's own status.
  process.exitCode = originalExitCode;
  activeConfigStub = undefined;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

/**
 * Runs the entry point with `args` standing in for its command line.
 *
 * The cache key counts evaluations rather than naming the arguments: two cases
 * can share a command line, and a key derived from it would make the second one
 * reuse the first one's cached evaluation instead of running the module again.
 */
let entryEvaluations = 0;

const runEntryPoint = async (args: string[]): Promise<void> => {
  process.argv = ['electron', ...args];
  process.exitCode = 0;
  entryEvaluations += 1;
  await importFresh<typeof import('../../app/index.mts')>(entryPoint, `entry_${entryEvaluations}`);
};

describe('the informational argument branch', () => {
  const informationalArguments = ['--help', '-v', '--version'];

  for (const argument of informationalArguments) {
    test.serial(`${argument} reports diagnostics and skips startup`, async () => {
      await runEntryPoint([argument]);

      // Order matters: the diagnostics are printed before the process is asked
      // to quit, so a run that quit first would emit nothing a user could read.
      expect(output.lines).toHaveLength(3);
      expect(output.lines[0]).toMatch(/^Hyper version \d/);
      expect(output.lines[1]).toContain('Hyper does not accept any command line arguments.');
      expect(output.lines[2]).toMatch(/^Hyper configuration file located at: /);
      expect(trace.labels).toEqual([]);
      expect(quits).toBe(1);
      expect(process.exitCode).toBe(0);
    });
  }
});

describe('the startup branch', () => {
  test.serial('an ordinary launch initializes the configuration, then starts the app', async () => {
    await runEntryPoint(['--no-sandbox']);

    // `config.setup()` must precede the start import: modules below it read the
    // configuration while their own bodies run, so the order is the contract.
    expect(trace.labels).toEqual(['configuration.setup', 'app.start']);
    expect(output.lines).toEqual([]);
    expect(quits).toBe(0);
    expect(process.exitCode).toBe(0);
  });

  test.serial('a throwing startup dependency is reported and turns into a failing exit code', async () => {
    activeConfigStub = {
      setup: () => {
        throw new Error('config unavailable');
      }
    };

    await runEntryPoint(['--no-sandbox']);

    expect(output.lines).toHaveLength(1);
    expect(output.lines[0]).toContain('ERROR Failed to start Hyper.');
    expect(output.lines[0]).toContain('config unavailable');
    // The app must not have reached its own start import after the failure.
    expect(trace.labels).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(quits).toBe(1);
  });
});
