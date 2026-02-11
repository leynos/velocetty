/**
 * @file End-to-end smoke tests for packaged Electron builds.
 * Purpose: Validate that packaged Electron binaries can launch and respond.
 * Usage: Set RUN_E2E=1, optionally E2E_DRIVER=playwright|spawn, E2E_DEBUG=1,
 * or E2E_CAPTURE=1 for extra diagnostics.
 */
// Native
import {spawn} from 'node:child_process';

// Packages
import {expect, test} from 'bun:test';
import fs from 'fs-extra';
import {_electron} from 'playwright';
import type {ElectronApplication} from 'playwright';

import {
  createIsolatedE2EEnvironment,
  extractRendererErrorMessage,
  isNonCriticalRendererError,
  resolveLaunchConfig,
  startRendererConsoleMonitor,
  waitForRendererReady,
  withTimeout
} from './electron-e2e-helpers';

const shouldRunE2E = process.env.RUN_E2E === '1';
const e2eTest = shouldRunE2E ? test : test.skip;
const e2eTimeoutMs = 30_000;
const launchTimeoutMs = 20_000;
const windowTimeoutMs = 10_000;
const rendererReadyTimeoutMs = 12_000;
const developmentRendererReadyTimeoutMs = 20_000;
const closeTimeoutMs = 5_000;
const spawnStabilityTimeoutMs = 1_000;
const developmentAppLaunchArgs =
  process.platform === 'linux' && (process.env.CI === 'true' || process.env.ELECTRON_DISABLE_SANDBOX === '1')
    ? ['node_modules/electron/cli.js', '--no-sandbox', '--disable-setuid-sandbox', 'target']
    : ['node_modules/electron/cli.js', 'target'];
const shouldCapture = process.env.E2E_CAPTURE === '1';
const debugE2E = process.env.E2E_DEBUG === '1';
const driverOverride = process.env.E2E_DRIVER;
const validDrivers = new Set(['playwright', 'spawn']);
if (shouldRunE2E && driverOverride && !validDrivers.has(driverOverride)) {
  throw new Error(`E2E_DRIVER must be "playwright" or "spawn", received "${driverOverride}".`);
}
const shouldUsePlaywright = driverOverride === 'playwright';

const createSpawnOutputTracker = () => {
  let spawnOutput = '';
  let outputWatchers: Array<{matcher: RegExp; resolve: () => void}> = [];

  const notifyOutputWatchers = () => {
    outputWatchers.forEach((watcher) => {
      if (watcher.matcher.test(spawnOutput)) {
        watcher.resolve();
      }
    });
  };

  const appendOutputChunk = (chunk: string) => {
    spawnOutput += chunk;
    notifyOutputWatchers();
  };

  const waitForSpawnOutput = async (matcher: RegExp, timeoutMs: number) =>
    await withTimeout(
      new Promise<void>((resolve) => {
        if (matcher.test(spawnOutput)) {
          resolve();
          return;
        }
        const watcher = {
          matcher,
          resolve: () => {
            outputWatchers = outputWatchers.filter((entry) => entry !== watcher);
            resolve();
          }
        };
        outputWatchers.push(watcher);
      }),
      timeoutMs
    );

  const extractCriticalRendererErrors = () =>
    spawnOutput
      .split('\n')
      .filter((line) => line.includes('[e2e][renderer-error]') && line.trim().length > 0)
      .map((line) => extractRendererErrorMessage(line))
      .filter((message) => !isNonCriticalRendererError(message));

  return {
    appendOutputChunk,
    extractCriticalRendererErrors,
    getOutput: () => spawnOutput,
    waitForSpawnOutput
  };
};

const setupSpawnOutputHandlers = (
  spawned: ReturnType<typeof spawn>,
  outputTracker: ReturnType<typeof createSpawnOutputTracker>
) => {
  spawned.stdout?.on('data', (data) => {
    const chunk = data.toString();
    outputTracker.appendOutputChunk(chunk);
    if (debugE2E) {
      process.stdout.write(chunk);
    }
  });
  spawned.stderr?.on('data', (data) => {
    const chunk = data.toString();
    outputTracker.appendOutputChunk(chunk);
    if (debugE2E) {
      process.stderr.write(chunk);
    }
  });
};

const waitForSpawnLaunch = async (spawned: ReturnType<typeof spawn>, timeoutMs: number) =>
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      if (spawned.pid) {
        resolve();
        return;
      }
      const onError = (error: Error) => {
        spawned.off('spawn', onSpawn);
        reject(error);
      };
      const onSpawn = () => {
        spawned.off('error', onError);
        resolve();
      };
      spawned.once('error', onError);
      spawned.once('spawn', onSpawn);
    }),
    timeoutMs
  );

const waitForStability = async (durationMs: number) =>
  await withTimeout(
    new Promise<void>((resolve) => {
      setTimeout(() => resolve(), durationMs);
    }),
    // Add a small buffer so the outer timeout does not race the inner delay.
    durationMs + 100
  );

const buildDevelopmentTimeoutDiagnostics = (
  spawned: ReturnType<typeof spawn> | null,
  outputTracker: ReturnType<typeof createSpawnOutputTracker>,
  timeoutMs: number,
  error: unknown
) => {
  const output = outputTracker.getOutput();
  const markers = [
    ['running in dev mode', /running in dev mode/i],
    ['electron will open', /electron will open/i],
    ['[e2e] renderer-ready', /\[e2e\] renderer-ready/i]
  ] as const;
  const markerStatus = markers.map(([label, matcher]) => `${label}: ${matcher.test(output) ? 'seen' : 'missing'}`);
  const waitError = error instanceof Error ? error.message : String(error);
  const spawnState = spawned
    ? `pid=${spawned.pid ?? 'unknown'} exitCode=${spawned.exitCode ?? 'null'} signalCode=${spawned.signalCode ?? 'null'} killed=${spawned.killed}`
    : 'spawned process: null';
  const outputTail = output.split('\n').slice(-120).join('\n').slice(-16_000);
  const lines = [
    `Development Electron did not emit [e2e] renderer-ready within ${timeoutMs}ms.`,
    `Underlying wait error: ${waitError}`,
    `Spawn state: ${spawnState}`,
    `Marker status: ${markerStatus.join(', ')}`,
    'Output tail (last 120 lines, max 16000 chars):',
    outputTail
  ];
  return lines.join('\n');
};

interface TestContext {
  isolatedEnvironment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>;
  outputTracker: ReturnType<typeof createSpawnOutputTracker>;
  app: ElectronApplication | null;
  spawned: ReturnType<typeof spawn> | null;
  rendererConsoleMonitor: ReturnType<typeof startRendererConsoleMonitor> | null;
  log: (message: string) => void;
}

const setupTestContext = async (): Promise<TestContext> => {
  const startTime = Date.now();
  const log = (message: string) => {
    if (!debugE2E) {
      return;
    }
    const elapsedMs = Date.now() - startTime;
    console.log(`[e2e ${elapsedMs}ms] ${message}`);
  };

  return {
    isolatedEnvironment: await createIsolatedE2EEnvironment(),
    outputTracker: createSpawnOutputTracker(),
    app: null,
    spawned: null,
    rendererConsoleMonitor: null,
    log
  };
};

const launchWithPlaywright = async (
  pathToBinary: string,
  launchArgs: readonly string[],
  isolatedEnvironment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>,
  log: (message: string) => void
) => {
  const app = await withTimeout(
    _electron.launch({
      executablePath: pathToBinary,
      args: launchArgs,
      env: isolatedEnvironment.env,
      timeout: launchTimeoutMs
    }),
    launchTimeoutMs
  );
  log('Electron launch completed.');
  log('Waiting for first window.');
  const window = await withTimeout(app.firstWindow(), windowTimeoutMs);
  expect(window).toBeDefined();
  const rendererConsoleMonitor = startRendererConsoleMonitor(window);
  log('Waiting for renderer readiness markers.');
  await waitForRendererReady(window, rendererReadyTimeoutMs);
  expect(rendererConsoleMonitor.criticalErrors).toHaveLength(0);
  log('First window resolved.');
  return {app, rendererConsoleMonitor};
};

const launchWithSpawn = async (
  pathToBinary: string,
  launchArgs: readonly string[],
  isolatedEnvironment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>,
  outputTracker: ReturnType<typeof createSpawnOutputTracker>,
  log: (message: string) => void
) => {
  const spawned = spawn(pathToBinary, launchArgs, {
    env: isolatedEnvironment.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  setupSpawnOutputHandlers(spawned, outputTracker);
  await waitForSpawnLaunch(spawned, launchTimeoutMs);
  log(`Spawned Electron PID: ${spawned.pid ?? 'unknown'}.`);
  await outputTracker.waitForSpawnOutput(/running in prod mode|electron will open/i, windowTimeoutMs);
  await outputTracker.waitForSpawnOutput(/\[e2e\] renderer-ready/i, rendererReadyTimeoutMs);
  await waitForStability(spawnStabilityTimeoutMs);
  if (spawned.exitCode != null) {
    throw new Error(`Electron exited early with code ${spawned.exitCode}. Output:\n${outputTracker.getOutput()}`);
  }

  expect(outputTracker.extractCriticalRendererErrors()).toHaveLength(0);
  return spawned;
};

const captureE2EScreenshot = async (app: ElectronApplication) => {
  try {
    const encodedImage = await withTimeout(
      app.evaluate(async ({BrowserWindow}) => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) {
          return null;
        }
        const image = await focusedWindow.capturePage();
        return image.toPNG().toString('base64');
      }),
      2_000
    );
    if (encodedImage) {
      await fs.writeFile(`dist/tmp/${process.platform}_test.png`, Buffer.from(encodedImage, 'base64'));
    }
  } catch (error) {
    console.warn('Skipping E2E screenshot capture:', error);
  }
};

const cleanupElectronApp = async (app: ElectronApplication | null, log: (message: string) => void) => {
  if (!app) {
    return;
  }
  if (shouldCapture) {
    await captureE2EScreenshot(app);
  }
  try {
    log('Closing Electron.');
    await withTimeout(app.close(), closeTimeoutMs);
    log('Electron closed.');
  } catch (error) {
    const process = app.process();
    if (process && !process.killed) {
      process.kill('SIGKILL');
    }
    console.warn('E2E cleanup timed out; force-killed Electron.', error);
  }
};

const cleanupSpawnedProcess = async (spawned: ReturnType<typeof spawn> | null) => {
  if (!spawned) {
    return;
  }
  spawned.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (spawned.exitCode == null) {
    spawned.kill('SIGKILL');
  }
};

const cleanupTestContext = async (context: TestContext) => {
  context.rendererConsoleMonitor?.stop();
  await cleanupElectronApp(context.app, context.log);
  await cleanupSpawnedProcess(context.spawned);
  await context.isolatedEnvironment.cleanup();
};

e2eTest(
  'launches the packaged app',
  async () => {
    const context = await setupTestContext();
    try {
      const {pathToBinary, launchArgs} = resolveLaunchConfig();
      if (!(await fs.pathExists(pathToBinary))) {
        throw new Error(`Expected packaged app binary at ${pathToBinary}. Run bun run dist first.`);
      }
      context.log(`CI=${process.env.CI ?? 'unset'} driver=${shouldUsePlaywright ? 'playwright' : 'spawn'}`);
      context.log(`Launching ${pathToBinary} with args: ${launchArgs.join(' ') || '(none)'}`);

      if (shouldUsePlaywright) {
        const {app, rendererConsoleMonitor} = await launchWithPlaywright(
          pathToBinary,
          launchArgs,
          context.isolatedEnvironment,
          context.log
        );
        context.app = app;
        context.rendererConsoleMonitor = rendererConsoleMonitor;
      } else {
        context.spawned = await launchWithSpawn(
          pathToBinary,
          launchArgs,
          context.isolatedEnvironment,
          context.outputTracker,
          context.log
        );
      }
    } finally {
      await cleanupTestContext(context);
    }
  },
  e2eTimeoutMs
);

e2eTest(
  'launches the development target without critical renderer errors',
  async () => {
    // This lane needs custom spawn env fields and no packaged-app fields.
    // Keep it separate from TestContext to avoid unused state plumbing.
    const isolatedEnvironment = await createIsolatedE2EEnvironment();
    const outputTracker = createSpawnOutputTracker();
    let spawned: ReturnType<typeof spawn> | null = null;
    try {
      spawned = spawn(process.execPath, developmentAppLaunchArgs, {
        cwd: process.cwd(),
        env: {
          ...isolatedEnvironment.env,
          RUN_E2E: '1',
          ELECTRONMON_LOGLEVEL: 'error'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      setupSpawnOutputHandlers(spawned, outputTracker);
      await waitForSpawnLaunch(spawned, launchTimeoutMs);
      try {
        await outputTracker.waitForSpawnOutput(/\[e2e\] renderer-ready/i, developmentRendererReadyTimeoutMs);
      } catch (error) {
        throw new Error(
          buildDevelopmentTimeoutDiagnostics(spawned, outputTracker, developmentRendererReadyTimeoutMs, error)
        );
      }
      await waitForStability(spawnStabilityTimeoutMs);

      if (spawned.exitCode != null) {
        throw new Error(
          `Development Electron exited early with code ${spawned.exitCode}. Output:\n${outputTracker.getOutput()}`
        );
      }

      expect(outputTracker.extractCriticalRendererErrors()).toHaveLength(0);
    } finally {
      await cleanupSpawnedProcess(spawned);
      await isolatedEnvironment.cleanup();
    }
  },
  e2eTimeoutMs
);
