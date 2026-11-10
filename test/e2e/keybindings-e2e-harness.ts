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
/** How often captured output is re-read while a wait is outstanding. */
const pollIntervalMs = 50;
const maxReplaceAttempts = 5;
const configFileNames = new Set([
  'config.json5',
  'hyper.json',
  'keybindings.json5',
  'schema.json',
  'keybindings.schema.json'
]);

/** Waits for `ms` before resolving, so a poll loop can yield. */
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
      await sleep(pollIntervalMs);
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

/**
 * The pause between presses that reached no page.
 *
 * A rejected press means the window's document was not ready, and the renderer
 * needs about two seconds from launch to load. Pausing between attempts spreads
 * twenty of them over five seconds, so a slow start does not exhaust the budget
 * before there is anything to press on.
 */
const retryIntervalMs = 250;

/**
 * The probe's verdict on one request.
 *
 * `pressed` means the page accepted the press and emitted a command while the
 * key event was dispatched, and names that command; `unbound` means the page
 * accepted the press and emitted none. Both are the probe's own observation of
 * the press itself, so a scenario never has to infer which press produced a
 * command from a marker count.
 */
type ProbeReply =
  | Readonly<{verdict: 'pressed'; command: string}>
  | Readonly<{verdict: 'unbound'}>
  | Readonly<{verdict: 'rejected'}>
  | Readonly<{verdict: 'failed'}>
  | Readonly<{verdict: 'unanswered'}>;

/** A reply the probe has actually sent, so no request is left in flight. */
type AnsweredReply = Exclude<ProbeReply, Readonly<{verdict: 'unanswered'}>>;

/**
 * The `[e2e]` line the probe emits once it has handled the request with this
 * ordinal.
 *
 * The whole line is matched, up to and including its newline, so the reply's
 * trailing command is captured and a line that has not been written in full yet
 * is never accepted.
 */
const probeOutcomeMarker = (ordinal: number) =>
  new RegExp(`\\[e2e\\] shortcut-probe (?:pressed|unbound|rejected|failed) #${ordinal} [^\\n]*\\n`);

/** The command a `pressed` reply attributes to the press that produced it. */
const replyCommand = (marker: string): string | undefined => /\bcommand=(\S+)\s*$/.exec(marker)?.[1];

/**
 * Classifies one reply line as the verdict it reports.
 *
 * A pressed reply always names its command, so a reply without one means the
 * probe and this harness disagree about the protocol rather than that the
 * press was unbound.
 */
const classifyProbeReply = (marker: string, ordinal: number): ProbeReply => {
  if (marker.includes(' unbound ')) {
    return {verdict: 'unbound'};
  }
  if (marker.includes(' rejected ')) {
    return {verdict: 'rejected'};
  }
  if (marker.includes(' failed ')) {
    return {verdict: 'failed'};
  }
  const command = replyCommand(marker);
  if (command === undefined) {
    throw new Error(`The probe's reply to request #${ordinal} named no command: ${marker}`);
  }
  return {verdict: 'pressed', command};
};

/**
 * Reports a wait that timed out as retryable, and rethrows anything else.
 *
 * A timeout is the one failure a caller may retry; an app that exited is not,
 * so its error keeps its message and its stack.
 */
const unansweredOnTimeout = (error: unknown): ProbeReply => {
  if (error instanceof Error && error.message.startsWith('Timed out')) {
    return {verdict: 'unanswered'};
  }
  throw error;
};

/**
 * Waits for the probe's reply to one request.
 *
 * A reply names the request's ordinal, so a stale reply to an earlier press of
 * the same chord can never stand in for this one. The wait is bounded and an
 * unanswered request is reported rather than thrown, so the caller can keep
 * waiting for that same request instead of sending another.
 */
const awaitProbeOutcome = async ({
  app,
  ordinal,
  timeoutMs = markerTimeoutMs
}: Readonly<{
  app: LaunchedApp;
  ordinal: number;
  timeoutMs?: number;
}>): Promise<ProbeReply> => {
  try {
    const reply = await app.waitFor({
      description: `the probe's reply to request #${ordinal}`,
      matcher: probeOutcomeMarker(ordinal),
      timeoutMs
    });
    return classifyProbeReply(reply.trimEnd(), ordinal);
  } catch (error) {
    return unansweredOnTimeout(error);
  }
};

/**
 * Waits for the probe's reply to one request, however long the probe takes.
 *
 * A request is appended to the probe's file and the probe presses the file's
 * lines in order, so a request without a reply is a press that has not happened
 * yet rather than one that was lost. The wait is therefore extended for that
 * same request instead of sending another: a repeated request would press the
 * chord twice, and one shortcut would then run its command twice. A request
 * that still does not answer fails the scenario, because returning would leave
 * a press in flight for the next assertion to trip over.
 *
 * @param ordinal - The request's ordinal, which its reply names.
 * @param shortcut - The chord, used in the failure message.
 * @returns The reply, which is never `unanswered`.
 */
const awaitAnsweredPress = async ({
  app,
  ordinal,
  shortcut
}: Readonly<{app: LaunchedApp; ordinal: number; shortcut: string}>): Promise<AnsweredReply> => {
  const first = await awaitProbeOutcome({app, ordinal, timeoutMs: pressIntervalMs});
  const reply = first.verdict === 'unanswered' ? await awaitProbeOutcome({app, ordinal}) : first;
  if (reply.verdict === 'unanswered') {
    throw new Error(
      `The probe never answered request #${ordinal} for ${shortcut}, so that press may still run. Output:\n${app.output()}`
    );
  }
  return reply;
};

type PressAndAwaitRequest = Readonly<{
  app: LaunchedApp;
  shortcuts: readonly string[];
}>;

/**
 * Presses one chord until the probe reports that a live page took the press.
 *
 * A chord the probe rejects is retried, because the newest window may still be
 * loading its first document: `window:new` spawns a window that has no body
 * for a while, and the probe cannot press into one. The pause between attempts
 * gives that document time to load. The loop stops at the first verdict that
 * reached a page, which is `pressed` or `unbound`.
 *
 * @returns The last reply, which reached a page unless every attempt was
 * rejected. A request the probe never answers fails the run rather than being
 * reported here.
 */
const pressUntilProbed = async ({
  app,
  shortcut
}: Readonly<{app: LaunchedApp; shortcut: string}>): Promise<ProbeReply> => {
  let lastReply: ProbeReply = {verdict: 'unanswered'};
  for (let attempt = 0; attempt < pressAttempts; attempt += 1) {
    const ordinal = app.send(shortcut);
    lastReply = await awaitAnsweredPress({app, ordinal, shortcut});
    if (lastReply.verdict === 'pressed' || lastReply.verdict === 'unbound') {
      break;
    }
    await sleep(retryIntervalMs);
  }
  return lastReply;
};

/**
 * Sends chords and requires that pressing each one runs no command.
 *
 * The probe captures commands emitted while the key event is dispatched, so
 * `unbound` is its own observation that the page took this press and emitted
 * nothing. That makes this a direct test that a binding is gone: it cannot be
 * satisfied by a command that some earlier press left behind, because that
 * command was attributed to the press that emitted it.
 */
export const pressWithoutCommand = async ({app, shortcuts}: PressAndAwaitRequest): Promise<void> => {
  for (const shortcut of shortcuts) {
    const reply = await pressUntilProbed({app, shortcut});
    if (reply.verdict !== 'unbound') {
      const failure =
        reply.verdict === 'pressed' ? `still ran ${reply.command}` : `could not be pressed (${reply.verdict})`;
      throw new Error(`The ${shortcut} shortcut ${failure}. Output:\n${app.output()}`);
    }
  }
};

type PressRequest = Readonly<{
  app: LaunchedApp;
  command: string;
  shortcut: string;
}>;

/**
 * Presses a chord until the press itself emits the expected command.
 *
 * The renderer binds its key listeners asynchronously after a reload, so the
 * first press can arrive before anything is listening and report `unbound`.
 * Repeating the press until the probe reports `pressed` makes the scenario
 * deterministic without guessing a delay.
 *
 * Attribution does not depend on timing: the probe records the command emitted
 * while the key event is dispatched, so a reply names the command *this* press
 * produced. A press that produced some other command is a failure rather than
 * a retry, because the binding under test is then simply wrong, and a command
 * that an earlier press emitted late is attributed to that earlier press or to
 * none at all. One press therefore cannot run its command twice, and the
 * marker it printed is already in the captured output, because the probe's
 * reply is written after it on the same stream.
 */
export const pressUntilExecuted = async ({app, command, shortcut}: PressRequest): Promise<void> => {
  let lastVerdict: ProbeReply['verdict'] = 'unanswered';
  for (let attempt = 0; attempt < pressAttempts; attempt += 1) {
    const ordinal = app.send(shortcut);
    const reply = await awaitAnsweredPress({app, ordinal, shortcut});
    lastVerdict = reply.verdict;
    if (reply.verdict === 'pressed' && reply.command !== command) {
      throw new Error(`The ${shortcut} shortcut ran ${reply.command}, not ${command}. Output:\n${app.output()}`);
    }
    if (reply.verdict === 'pressed') {
      return;
    }
    await sleep(retryIntervalMs);
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
