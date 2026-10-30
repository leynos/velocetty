/**
 * @file E2E-KB-0 to E2E-KB-4: keybindings storage, migration, and reload.
 * Usage: set RUN_E2E=1 after `bun run test:e2e:prepare` has built `dist/app`.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {expect, test} from 'bun:test';

import {E2E_PROBE_SHORTCUT} from '../../app/config/e2e-keymap-probe';
import {isJsonObject, isObject, isString} from '../../app/utils/runtime-guards';
import {createIsolatedE2EEnvironment, withTimeout} from './electron-e2e-helpers';

const shouldRunE2E = process.env.RUN_E2E === '1';
const e2eTest = shouldRunE2E ? test : test.skip;
const markerTimeoutMs = 10_000;
const scenarioTimeoutMs = 90_000;
const noRecreationWaitMs = 2000;
const stopTimeoutMs = 5000;
const maxReplaceAttempts = 5;
const configFileNames = new Set([
  'config.json5',
  'hyper.json',
  'keybindings.json5',
  'schema.json',
  'keybindings.schema.json'
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
const launchApp = async (
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
const configFilesIn = async ({directory}: Readonly<{directory: string}>): Promise<string[]> => {
  try {
    const entries = await fs.readdir(directory);
    return entries.filter((entry) => configFileNames.has(entry)).toSorted();
  } catch {
    return [];
  }
};

/** The `[e2e]` line the app emits when it applies or keeps a shortcut. */
const probeMarker = ({shortcut, status}: ProbeMarkerRequest) =>
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
const platformDefaultShortcut = async (): Promise<string> => {
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
const legacyHyperConfig = ({keymaps}: Readonly<{keymaps: string}>): string => `{
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
const replaceFileAtomically = async ({contents, filePath}: Readonly<{contents: string; filePath: string}>) => {
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

e2eTest(
  'E2E-KB-0 a fresh install creates both files in the Velocetty tree only',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    try {
      const app = await launchApp(environment);
      try {
        await app.waitFor({description: 'the config watcher', matcher: /\[e2e\] config-watcher-ready/});
        expect(existsSync(path.join(environment.velocettyConfigDir, 'config.json5'))).toBe(true);
        expect(existsSync(path.join(environment.velocettyConfigDir, 'keybindings.json5'))).toBe(true);
        expect(await configFilesIn({directory: environment.hyperConfigDir})).toEqual([]);
      } finally {
        await app.stop();
      }
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);

e2eTest(
  'E2E-KB-1 migrates legacy Hyper keymaps without touching the Hyper tree',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    try {
      const hyperConfigPath = await environment.seedFile({
        configDir: environment.hyperConfigDir,
        contents: legacyHyperConfig({keymaps: `{'window:new': '${E2E_PROBE_SHORTCUT}'}`}),
        fileName: 'config.json5'
      });
      const hyperBytesBefore = await fs.readFile(hyperConfigPath);

      const app = await launchApp(environment);
      try {
        const keybindingsLine = await app.waitFor({
          description: 'the keybindings path marker',
          matcher: /\[e2e\] keybindings-path .+/
        });
        expect(keybindingsLine).toBe(
          `[e2e] keybindings-path ${path.join(environment.velocettyConfigDir, 'keybindings.json5')}`
        );
        const configPathLine = await app.waitFor({
          description: 'the config path marker',
          matcher: /\[e2e\] config-path .+/
        });
        expect(configPathLine).toBe(`[e2e] config-path ${hyperConfigPath}`);
        await app.waitFor({
          description: 'the migrated keymap',
          matcher: probeMarker({shortcut: E2E_PROBE_SHORTCUT, status: 'applied'})
        });

        const seeded = await fs.readFile(path.join(environment.velocettyConfigDir, 'keybindings.json5'), 'utf8');
        expect(seeded).toContain(E2E_PROBE_SHORTCUT);
        expect(await configFilesIn({directory: environment.hyperConfigDir})).toEqual(['config.json5']);
        const hyperBytesAfter = await fs.readFile(hyperConfigPath);
        expect(hyperBytesAfter.equals(hyperBytesBefore)).toBe(true);
      } finally {
        await app.stop();
      }
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);

e2eTest(
  'E2E-KB-2 to E2E-KB-4 hot reload, invalid files, and deletion',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    const keybindingsPath = path.join(environment.velocettyConfigDir, 'keybindings.json5');
    try {
      await environment.seedFile({
        configDir: environment.hyperConfigDir,
        contents: legacyHyperConfig({keymaps: `{'window:new': '${E2E_PROBE_SHORTCUT}'}`}),
        fileName: 'config.json5'
      });

      const app = await launchApp(environment);
      try {
        await app.waitFor({description: 'the config watcher', matcher: /\[e2e\] config-watcher-ready/});
        await app.waitFor({
          description: 'the seeded keymap',
          matcher: probeMarker({shortcut: E2E_PROBE_SHORTCUT, status: 'applied'})
        });

        await fs.writeFile(keybindingsPath, `{'window:new': 'ctrl+alt+shift+m'}`, 'utf8');
        await app.waitFor({
          description: 'the first hot reload',
          matcher: probeMarker({shortcut: 'ctrl+alt+shift+m', status: 'applied'})
        });

        await replaceFileAtomically({contents: `{'window:new': 'ctrl+alt+shift+k'}`, filePath: keybindingsPath});
        await app.waitFor({
          description: 'the atomic-replace reload',
          matcher: probeMarker({shortcut: 'ctrl+alt+shift+k', status: 'applied'})
        });

        await fs.writeFile(keybindingsPath, `{'window:new':`, 'utf8');
        await app.waitFor({
          description: 'the last-known-good reload',
          matcher: probeMarker({shortcut: 'ctrl+alt+shift+k', status: 'kept'})
        });

        await fs.rm(keybindingsPath);
        const defaultShortcut = await platformDefaultShortcut();
        await app.waitFor({
          description: 'the deletion reload',
          matcher: probeMarker({shortcut: defaultShortcut, status: 'applied'})
        });

        await sleep(noRecreationWaitMs);
        expect(existsSync(keybindingsPath)).toBe(false);
      } finally {
        await app.stop();
      }
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);

e2eTest(
  'a relaunch reads the persisted edit and rewrites nothing',
  async () => {
    // The legacy value differs from the persisted one, so a relaunch that
    // re-migrated instead of reading the file could not pass by coincidence.
    const legacyShortcut = 'ctrl+alt+shift+j';
    const editedShortcut = 'ctrl+alt+shift+q';
    const environment = await createIsolatedE2EEnvironment();
    try {
      const hyperConfigPath = await environment.seedFile({
        configDir: environment.hyperConfigDir,
        contents: legacyHyperConfig({keymaps: `{'window:new': '${legacyShortcut}'}`}),
        fileName: 'config.json5'
      });
      const keybindingsPath = await environment.seedFile({
        configDir: environment.velocettyConfigDir,
        contents: `{'window:new': '${E2E_PROBE_SHORTCUT}'}`,
        fileName: 'keybindings.json5'
      });
      const configBefore = await fs.readFile(hyperConfigPath);

      const firstLaunch = await launchApp(environment);
      try {
        await firstLaunch.waitFor({
          description: 'the restored keymap',
          matcher: probeMarker({shortcut: E2E_PROBE_SHORTCUT, status: 'applied'})
        });
      } finally {
        await firstLaunch.stop();
      }

      await replaceFileAtomically({contents: `{'window:new': '${editedShortcut}'}`, filePath: keybindingsPath});
      const keybindingsAfterEdit = await fs.readFile(keybindingsPath);

      const secondLaunch = await launchApp(environment);
      try {
        await secondLaunch.waitFor({
          description: 'the persisted edit',
          matcher: probeMarker({shortcut: editedShortcut, status: 'applied'})
        });
      } finally {
        await secondLaunch.stop();
      }

      const keybindingsStatBeforeThirdLaunch = await fs.stat(keybindingsPath);
      const thirdLaunch = await launchApp(environment);
      try {
        await thirdLaunch.waitFor({
          description: 'the persisted edit after a relaunch',
          matcher: probeMarker({shortcut: editedShortcut, status: 'applied'})
        });
      } finally {
        await thirdLaunch.stop();
      }

      const keybindingsAfterThirdLaunch = await fs.readFile(keybindingsPath);
      const keybindingsStatAfter = await fs.stat(keybindingsPath);
      const configAfter = await fs.readFile(hyperConfigPath);
      expect(keybindingsAfterThirdLaunch.equals(keybindingsAfterEdit)).toBe(true);
      expect(keybindingsStatAfter.mtimeMs).toBe(keybindingsStatBeforeThirdLaunch.mtimeMs);
      expect(configAfter.equals(configBefore)).toBe(true);
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs * 2
);
