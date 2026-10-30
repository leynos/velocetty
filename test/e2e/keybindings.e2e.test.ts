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

type LaunchedApp = {
  readonly output: () => string;
  readonly waitFor: (matcher: RegExp, description: string) => Promise<string>;
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

  const waitFor = async (matcher: RegExp, description: string): Promise<string> => {
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
const configFilesIn = async (directory: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(directory);
    return entries.filter((entry) => configFileNames.has(entry)).toSorted();
  } catch {
    return [];
  }
};

/** Escapes a shortcut so it matches literally inside a regular expression. */
const escapeShortcut = (shortcut: string) => shortcut.replaceAll('+', String.raw`\+`);

const probeMarker = (status: 'applied' | 'kept', shortcut: string) =>
  new RegExp(`\\[e2e\\] keymaps-active status=${status} window:new=${escapeShortcut(shortcut)}`);

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
const legacyHyperConfig = (keymaps: string): string => `{
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

/** Replaces a file through a temporary sibling, retrying Windows lock errors. */
const replaceFileAtomically = async (filePath: string, contents: string) => {
  const temporaryPath = `${filePath}.e2e-tmp`;
  await fs.writeFile(temporaryPath, contents, 'utf8');
  for (let attempt = 1; attempt <= maxReplaceAttempts; attempt += 1) {
    try {
      await fs.rename(temporaryPath, filePath);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (attempt === maxReplaceAttempts || code === undefined || !retriableReplaceCodes.has(code)) {
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
        await app.waitFor(/\[e2e\] config-watcher-ready/, 'the config watcher');
        expect(existsSync(path.join(environment.velocettyConfigDir, 'config.json5'))).toBe(true);
        expect(existsSync(path.join(environment.velocettyConfigDir, 'keybindings.json5'))).toBe(true);
        expect(await configFilesIn(environment.hyperConfigDir)).toEqual([]);
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
      const hyperConfigPath = await environment.seedFile(
        environment.hyperConfigDir,
        'config.json5',
        legacyHyperConfig(`{'window:new': '${E2E_PROBE_SHORTCUT}'}`)
      );
      const hyperBytesBefore = await fs.readFile(hyperConfigPath);

      const app = await launchApp(environment);
      try {
        const keybindingsLine = await app.waitFor(/\[e2e\] keybindings-path .+/, 'the keybindings path marker');
        expect(keybindingsLine).toBe(
          `[e2e] keybindings-path ${path.join(environment.velocettyConfigDir, 'keybindings.json5')}`
        );
        const configPathLine = await app.waitFor(/\[e2e\] config-path .+/, 'the config path marker');
        expect(configPathLine).toBe(`[e2e] config-path ${hyperConfigPath}`);
        await app.waitFor(probeMarker('applied', E2E_PROBE_SHORTCUT), 'the migrated keymap');

        const seeded = await fs.readFile(path.join(environment.velocettyConfigDir, 'keybindings.json5'), 'utf8');
        expect(seeded).toContain(E2E_PROBE_SHORTCUT);
        expect(await configFilesIn(environment.hyperConfigDir)).toEqual(['config.json5']);
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
      await environment.seedFile(
        environment.hyperConfigDir,
        'config.json5',
        legacyHyperConfig(`{'window:new': '${E2E_PROBE_SHORTCUT}'}`)
      );

      const app = await launchApp(environment);
      try {
        await app.waitFor(/\[e2e\] config-watcher-ready/, 'the config watcher');
        await app.waitFor(probeMarker('applied', E2E_PROBE_SHORTCUT), 'the seeded keymap');

        await fs.writeFile(keybindingsPath, `{'window:new': 'ctrl+alt+shift+m'}`, 'utf8');
        await app.waitFor(probeMarker('applied', 'ctrl+alt+shift+m'), 'the first hot reload');

        await replaceFileAtomically(keybindingsPath, `{'window:new': 'ctrl+alt+shift+k'}`);
        await app.waitFor(probeMarker('applied', 'ctrl+alt+shift+k'), 'the atomic-replace reload');

        await fs.writeFile(keybindingsPath, `{'window:new':`, 'utf8');
        await app.waitFor(probeMarker('kept', 'ctrl+alt+shift+k'), 'the last-known-good reload');

        await fs.rm(keybindingsPath);
        const defaultShortcut = await platformDefaultShortcut();
        await app.waitFor(probeMarker('applied', defaultShortcut), 'the deletion reload');

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
  'a second launch leaves the keybindings and config bytes untouched',
  async () => {
    const environment = await createIsolatedE2EEnvironment();
    try {
      const hyperConfigPath = await environment.seedFile(
        environment.hyperConfigDir,
        'config.json5',
        legacyHyperConfig(`{'window:new': '${E2E_PROBE_SHORTCUT}'}`)
      );
      const keybindingsPath = await environment.seedFile(
        environment.velocettyConfigDir,
        'keybindings.json5',
        `{'window:new': '${E2E_PROBE_SHORTCUT}'}`
      );
      const keybindingsBefore = await fs.readFile(keybindingsPath);
      const keybindingsStatBefore = await fs.stat(keybindingsPath);
      const configBefore = await fs.readFile(hyperConfigPath);

      const app = await launchApp(environment);
      try {
        await app.waitFor(probeMarker('applied', E2E_PROBE_SHORTCUT), 'the restored keymap');
      } finally {
        await app.stop();
      }

      const keybindingsAfter = await fs.readFile(keybindingsPath);
      const keybindingsStatAfter = await fs.stat(keybindingsPath);
      const configAfter = await fs.readFile(hyperConfigPath);
      expect(keybindingsAfter.equals(keybindingsBefore)).toBe(true);
      expect(keybindingsStatAfter.mtimeMs).toBe(keybindingsStatBefore.mtimeMs);
      expect(configAfter.equals(configBefore)).toBe(true);
    } finally {
      await environment.cleanup();
    }
  },
  scenarioTimeoutMs
);
