/**
 * @file Launch, marker, and file helpers shared by the keybindings E2E suite.
 *
 * The suite itself stays focused on the scenarios; this module owns how an
 * Electron run is started, how its `[e2e]` marker stream is read, and how the
 * configuration files around it are seeded and replaced. Keeping it separate
 * also keeps both files inside the repository's 400-line limit.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
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
}>;

/** The probe marker a keymap should emit for a shortcut. */
type ProbeMarkerRequest = Readonly<{
  readonly shortcut: string;
  readonly status: 'applied' | 'kept';
}>;

type LaunchedApp = {
  readonly output: () => string;
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

  let output = '';
  const child: ChildProcess = spawn(process.execPath, developmentAppLaunchArgs, {
    cwd: process.cwd(),
    env: {...environment.env, ELECTRONMON_LOGLEVEL: 'error', RUN_E2E: '1'},
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

  const waitFor = async ({description, matcher}: MarkerWait): Promise<string> => {
    const deadline = Date.now() + markerTimeoutMs;
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

  return {
    output: () => output,
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
