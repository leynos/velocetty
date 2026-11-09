/**
 * @file Launch, marker, and file helpers shared by the keybindings E2E suite.
 *
 * The suite itself stays focused on the scenarios; this module owns how an
 * Electron run is started, how its `[e2e]` marker stream is read, and how the
 * configuration files around it are seeded and replaced. Keeping it separate
 * also keeps both files inside the repository's 400-line limit.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import {appendFileSync, existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {test} from 'bun:test';

import {isJsonObject, isObject, isString} from '../../app/utils/runtime-guards';
import {type createIsolatedE2EEnvironment, withTimeout} from './electron-e2e-helpers';

const shouldRunE2E = process.env.RUN_E2E === '1';

/** The suite's test function: a real test when `RUN_E2E=1`, otherwise a skip. */
export const e2eTest = shouldRunE2E ? test : test.skip;

/** Per-scenario budget for the marker waits. */
export const scenarioTimeoutMs = 90_000;

/** How long the app must leave a deleted file alone before the test believes it. */
export const noRecreationWaitMs = 2000;

const markerTimeoutMs = 10_000;
const stopTimeoutMs = 5000;
const maxReplaceAttempts = 5;
const configFileNames = new Set([
  'config.json5',
  'hyper.json',
  'keybindings.json5',
  'schema.json',
  'keybindings.schema.json'
]);

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const developmentAppLaunchArgs =
  process.platform === 'linux' && (process.env.CI === 'true' || process.env.ELECTRON_DISABLE_SANDBOX === '1')
    ? ['node_modules/electron/cli.js', '--no-sandbox', '--disable-setuid-sandbox', 'dist/app']
    : ['node_modules/electron/cli.js', 'dist/app'];

/** One output line to wait for, with a label used in failure messages. */
type MarkerWait = Readonly<{
  readonly description: string;
  readonly matcher: RegExp;
  /** Overrides the default wait, so a caller can retry instead of failing. */
  readonly timeoutMs?: number;
}>;

/** The probe marker a keymap should emit for a shortcut. */
type ProbeMarkerRequest = Readonly<{
  readonly shortcut: string;
  readonly status: 'applied' | 'kept';
}>;

type LaunchedApp = {
  /** How many captured lines match, so a caller can wait for the next one. */
  readonly count: (matcher: RegExp) => number;
  readonly output: () => string;
  /**
   * Appends one chord request and returns the request's ordinal.
   *
   * The ordinal travels with the request, so the probe's reply names the
   * request rather than only the chord. Two presses of the same chord then stay
   * distinguishable, which a count of markers cannot do.
   */
  readonly send: (line: string) => number;
  readonly waitFor: (wait: MarkerWait) => Promise<string>;
  readonly stop: () => Promise<void>;
};

/** Launches the development output and exposes its `[e2e]` marker stream. */
export const launchApp = async (
  environment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>
): Promise<LaunchedApp> => {
  if (!existsSync(path.resolve('dist/app'))) {
    throw new Error('Expected dist/app to exist. Run `bun run test:e2e:prepare` before the keybindings E2E suite.');
  }

  // The app's E2E probe presses the chords appended here, so a scenario can
  // press one exactly when it is ready to. A file rather than standard input:
  // Electron on Windows has no console and never delivers piped input.
  const pressRequestsPath = path.join(environment.tempHome, 'shortcut-requests.txt');
  await fs.writeFile(pressRequestsPath, '', 'utf8');

  let output = '';
  const child: ChildProcess = spawn(process.execPath, developmentAppLaunchArgs, {
    cwd: process.cwd(),
    env: {
      ...environment.env,
      ELECTRONMON_LOGLEVEL: 'error',
      RUN_E2E: '1',
      VELOCETTY_E2E_PRESS_FILE: pressRequestsPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  /** Polls captured output for a marker, failing fast if Electron exits first. */
  const waitFor = async ({description, matcher, timeoutMs = markerTimeoutMs}: MarkerWait): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = matcher.exec(output);
      if (match !== null) {
        return match[0];
      }
      if (child.exitCode !== null) {
        throw new Error(`Electron exited with code ${child.exitCode} before ${description}. Output:\n${output}`);
      }
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${description}. Output:\n${output}`);
  };

  /** Counts captured lines that match, so a scenario can wait for a later one. */
  const count = (matcher: RegExp): number => output.split('\n').filter((line) => matcher.test(line)).length;

  let requestOrdinal = 0;

  return {
    count,
    output: () => output,
    send: (line: string) => {
      requestOrdinal += 1;
      appendFileSync(pressRequestsPath, `#${requestOrdinal}\t${line}\n`, 'utf8');
      return requestOrdinal;
    },
    /** Terminates the app, escalating to SIGKILL if it ignores SIGTERM. */
    stop: async () => {
      child.kill('SIGTERM');
      try {
        await withTimeout(exited, stopTimeoutMs);
      } catch {
        child.kill('SIGKILL');
      }
    },
    waitFor
  };
};

/** Lists the configuration files present in a tree, sorted for stable assertions. */
export const configFilesIn = async ({directory}: Readonly<{directory: string}>): Promise<string[]> => {
  try {
    const entries = await fs.readdir(directory);
    return entries.filter((entry) => configFileNames.has(entry)).toSorted();
  } catch {
    return [];
  }
};

/** The `[e2e]` line the app emits when it applies or keeps a shortcut. */
export const probeMarker = ({shortcut, status}: ProbeMarkerRequest) =>
  new RegExp(`\\[e2e\\] keymaps-active status=${status} window:new=${shortcut.replaceAll('+', String.raw`\+`)}`);

/** The `[e2e]` line a command handler prints when the lane has driven it. */
export const commandExecutedMarker = (command: string) => new RegExp(`\\[e2e\\] command-executed ${command}`);

const pressAttempts = 20;
const pressIntervalMs = 1000;

/** The probe's verdict on one request. */
type ProbeVerdict = 'pressed' | 'rejected' | 'failed' | 'unanswered';

/** The `[e2e]` line the probe emits once it has handled the request with this ordinal. */
const probeOutcomeMarker = (ordinal: number) =>
  new RegExp(`\\[e2e\\] shortcut-probe (?:pressed|rejected|failed) #${ordinal} `);

/**
 * Waits for the probe's reply to one request.
 *
 * A reply names the request's ordinal, so a stale reply to an earlier press of
 * the same chord can never stand in for this one. The wait is per attempt and
 * bounded: an unanswered request is reported to the caller rather than ending
 * the run, so a caller that retries can try again.
 */
const awaitProbeOutcome = async ({
  app,
  ordinal,
  timeoutMs = markerTimeoutMs
}: Readonly<{
  app: LaunchedApp;
  ordinal: number;
  timeoutMs?: number;
}>): Promise<ProbeVerdict> => {
  try {
    const marker = await app.waitFor({
      description: `the probe's reply to request #${ordinal}`,
      matcher: probeOutcomeMarker(ordinal),
      timeoutMs
    });
    if (marker.includes(' rejected ')) {
      return 'rejected';
    }
    return marker.includes(' failed ') ? 'failed' : 'pressed';
  } catch (error) {
    // A timeout is the one failure a caller may retry; an app that exited is
    // not, so its error keeps its message and its stack.
    if (error instanceof Error && error.message.startsWith('Timed out')) {
      return 'unanswered';
    }
    throw error;
  }
};

type PressAndAwaitRequest = Readonly<{
  app: LaunchedApp;
  shortcuts: readonly string[];
}>;

/**
 * Sends chords and waits until the probe has pressed every one.
 *
 * Each request is answered individually, so the assertion that follows tests
 * the chord that was just sent rather than any earlier press of the same
 * chord. A request the probe could not press fails the scenario: a rejected or
 * failed press never reached the page, so treating it as handled would let a
 * "the old shortcut no longer runs" assertion pass without testing the binding.
 */
export const pressAndAwaitProbe = async ({app, shortcuts}: PressAndAwaitRequest): Promise<void> => {
  const ordinals = shortcuts.map((shortcut) => app.send(shortcut));
  const verdicts = await Promise.all(ordinals.map((ordinal) => awaitProbeOutcome({app, ordinal})));
  const unpressed = verdicts.flatMap((verdict, index) =>
    verdict === 'pressed' ? [] : [`${shortcuts[index] ?? ''} was ${verdict} (request #${ordinals[index] ?? 0})`]
  );
  if (unpressed.length > 0) {
    throw new Error(`The probe could not press ${unpressed.join('; ')}. Output:\n${app.output()}`);
  }
};

type PressRequest = Readonly<{
  app: LaunchedApp;
  command: string;
  shortcut: string;
}>;

/**
 * Presses a chord until the command handler prints a marker that was not there
 * before.
 *
 * The renderer binds its key listeners asynchronously after a reload, so the
 * first press can arrive before anything is listening. Repeating the press
 * until the marker count grows makes the scenario deterministic without
 * guessing a delay, and it stops as soon as the command has run.
 *
 * Each attempt waits for the probe's reply to that attempt before the next
 * one, so the helper never returns with an earlier press still in flight. The
 * next helper's negative assertion therefore cannot be satisfied by a late
 * reply to work this helper started.
 */
export const pressUntilExecuted = async ({app, command, shortcut}: PressRequest): Promise<void> => {
  const matcher = commandExecutedMarker(command);
  const before = app.count(matcher);
  let lastVerdict: ProbeVerdict = 'unanswered';
  for (let attempt = 0; attempt < pressAttempts; attempt += 1) {
    const ordinal = app.send(shortcut);
    lastVerdict = await awaitProbeOutcome({app, ordinal, timeoutMs: pressIntervalMs});
    if (lastVerdict === 'pressed' && app.count(matcher) > before) {
      return;
    }
  }
  throw new Error(
    `The ${shortcut} shortcut never executed ${command} (last press ${lastVerdict}). Output:\n${app.output()}`
  );
};

/** The bundled keymap whose defaults the suite compares against on this platform. */
const platformKeymapFile = (): string => {
  switch (process.platform) {
    case 'darwin': {
      return 'darwin.json';
    }
    case 'win32': {
      return 'win32.json';
    }
    default: {
      return 'linux.json';
    }
  }
};

/** The shortcut the platform keymap gives `window:new`, normalized like `mapKeys`. */
export const platformDefaultShortcut = async (): Promise<string> => {
  const platformFile = platformKeymapFile();
  const parsed: unknown = JSON.parse(await fs.readFile(path.resolve('app/keymaps', platformFile), 'utf8'));
  if (!isJsonObject(parsed)) {
    throw new TypeError(`Expected ${platformFile} to hold a JSON object`);
  }
  const binding = parsed['window:new'];
  const shortcuts = Array.isArray(binding) ? binding : [binding];
  const shortcut = shortcuts.at(0);
  if (!isString(shortcut)) {
    throw new TypeError(`Expected ${platformFile} to define window:new`);
  }
  return shortcut.replaceAll('cmd', 'command');
};

/**
 * A legacy Hyper configuration.
 *
 * The plugin settings equal the golden-path plugin's defaults, so a runtime
 * plugin that persists defaults writes the file back unchanged.
 */
export const legacyHyperConfig = ({keymaps}: Readonly<{keymaps: string}>): string => `{
  config: {
    defaultProfile: 'default',
    profiles: [{name: 'default', config: {}}],
    plugins: {
      'velocetty.golden-path-demo': {enabled: true, message: 'Golden path plugin command invoked.', tabPrefix: 'GP'}
    }
  },
  plugins: [],
  localPlugins: [],
  keymaps: ${keymaps}
}`;

const retriableReplaceCodes = new Set(['EACCES', 'EBUSY', 'EPERM']);

/** Reads the errno code a filesystem rejection carries, if it has one. */
const errorCode = (error: unknown): string | undefined => {
  if (!isObject(error) || !('code' in error)) {
    return undefined;
  }
  const {code} = error;
  return isString(code) ? code : undefined;
};

/** True when another rename attempt is worthwhile: attempts remain and the code is transient. */
const isRetriableRenameFailure = (error: unknown, attempt: number): boolean => {
  const code = errorCode(error);
  if (attempt >= maxReplaceAttempts) {
    return false;
  }
  if (code === undefined) {
    return false;
  }
  return retriableReplaceCodes.has(code);
};

/** Replaces a file through a temporary sibling, retrying Windows lock errors. */
export const replaceFileAtomically = async ({contents, filePath}: Readonly<{contents: string; filePath: string}>) => {
  const temporaryPath = `${filePath}.e2e-tmp`;
  await fs.writeFile(temporaryPath, contents, 'utf8');
  for (let attempt = 1; attempt <= maxReplaceAttempts; attempt += 1) {
    try {
      await fs.rename(temporaryPath, filePath);
      return;
    } catch (error) {
      if (!isRetriableRenameFailure(error, attempt)) {
        throw error;
      }
      await sleep(attempt * 100);
    }
  }
};
