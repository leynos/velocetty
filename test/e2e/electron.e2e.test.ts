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
const closeTimeoutMs = 5_000;
const spawnStabilityTimeoutMs = 1_000;
const developmentAppLaunchArgs = ['node_modules/electron/cli.js', 'target'];
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

const setupSpawnWithOutputTracking = (
  spawned: ReturnType<typeof spawn>,
  outputTracker: ReturnType<typeof createSpawnOutputTracker>
) => {
  spawned.stdout?.on('data', (data) => {
    outputTracker.appendOutputChunk(data.toString());
  });
  spawned.stderr?.on('data', (data) => {
    outputTracker.appendOutputChunk(data.toString());
  });
};

const waitForSpawnLaunch = async (spawned: ReturnType<typeof spawn>, timeoutMs: number) =>
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      if (spawned.pid) {
        resolve();
        return;
      }
      spawned.once('error', reject);
      spawned.once('spawn', () => resolve());
    }),
    timeoutMs
  );

const waitForStability = async (durationMs: number) =>
  await withTimeout(
    new Promise<void>((resolve) => {
      setTimeout(() => resolve(), durationMs);
    }),
    durationMs + 100
  );

const cleanupSpawnProcess = async (spawned: ReturnType<typeof spawn>) => {
  spawned.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (spawned.exitCode == null) {
    spawned.kill('SIGKILL');
  }
};

interface TestContext {
  isolatedEnvironment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>;
  outputTracker: ReturnType<typeof createSpawnOutputTracker>;
  app: ElectronApplication | null;
  spawned: ReturnType<typeof spawn> | null;
  rendererConsoleMonitor: ReturnType<typeof startRendererConsoleMonitor> | null;
  log: (message: string) => void;
  startTime: number;
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
    log,
    startTime
  };
};

const launchAndVerifyWithPlaywright = async (
  context: TestContext,
  pathToBinary: string,
  launchArgs: readonly string[]
) => {
  context.app = await withTimeout(
    _electron.launch({
      executablePath: pathToBinary,
      args: launchArgs,
      env: context.isolatedEnvironment.env,
      timeout: launchTimeoutMs
    }),
    launchTimeoutMs
  );
  context.log('Electron launch completed.');
  context.log('Waiting for first window.');

  const window = await withTimeout(context.app.firstWindow(), windowTimeoutMs);
  expect(window).toBeDefined();
  context.rendererConsoleMonitor = startRendererConsoleMonitor(window);
  context.log('Waiting for renderer readiness markers.');
  await waitForRendererReady(window, rendererReadyTimeoutMs);
  expect(context.rendererConsoleMonitor.criticalErrors).toHaveLength(0);
  context.log('First window resolved.');
};

const launchAndVerifyWithSpawn = async (context: TestContext, pathToBinary: string, launchArgs: readonly string[]) => {
  context.spawned = spawn(pathToBinary, launchArgs, {
    env: context.isolatedEnvironment.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  setupSpawnWithOutputTracking(context.spawned, context.outputTracker);

  if (debugE2E) {
    context.spawned.stdout?.on('data', (data) => {
      process.stdout.write(data.toString());
    });
    context.spawned.stderr?.on('data', (data) => {
      process.stderr.write(data.toString());
    });
  }

  await waitForSpawnLaunch(context.spawned, launchTimeoutMs);

  context.log(`Spawned Electron PID: ${context.spawned.pid ?? 'unknown'}.`);
  await context.outputTracker.waitForSpawnOutput(/running in prod mode|electron will open/i, windowTimeoutMs);
  await context.outputTracker.waitForSpawnOutput(/\[e2e\] renderer-ready/i, rendererReadyTimeoutMs);
  await waitForStability(spawnStabilityTimeoutMs);

  if (context.spawned.exitCode != null) {
    throw new Error(
      `Electron exited early with code ${context.spawned.exitCode}. Output:\n${context.outputTracker.getOutput()}`
    );
  }

  expect(context.outputTracker.extractCriticalRendererErrors()).toHaveLength(0);
};

const captureScreenshotIfNeeded = async (app: ElectronApplication | null) => {
  if (!app || !shouldCapture) {
    return;
  }

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

const cleanupTestContext = async (context: TestContext) => {
  context.rendererConsoleMonitor?.stop();
  await captureScreenshotIfNeeded(context.app);

  if (context.app) {
    try {
      context.log('Closing Electron.');
      await withTimeout(context.app.close(), closeTimeoutMs);
      context.log('Electron closed.');
    } catch (error) {
      const process = context.app.process();
      if (process && !process.killed) {
        process.kill('SIGKILL');
      }
      console.warn('E2E cleanup timed out; force-killed Electron.', error);
    }
  }

  if (context.spawned) {
    await cleanupSpawnProcess(context.spawned);
  }

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
        await launchAndVerifyWithPlaywright(context, pathToBinary, launchArgs);
      } else {
        await launchAndVerifyWithSpawn(context, pathToBinary, launchArgs);
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

      setupSpawnWithOutputTracking(spawned, outputTracker);

      await waitForSpawnLaunch(spawned, launchTimeoutMs);

      await outputTracker.waitForSpawnOutput(/running in dev mode|electron will open/i, windowTimeoutMs);
      await outputTracker.waitForSpawnOutput(/\[e2e\] renderer-ready/i, rendererReadyTimeoutMs);
      await waitForStability(spawnStabilityTimeoutMs);

      if (spawned.exitCode != null) {
        throw new Error(
          `Development Electron exited early with code ${spawned.exitCode}. Output:\n${outputTracker.getOutput()}`
        );
      }

      expect(outputTracker.extractCriticalRendererErrors()).toHaveLength(0);
    } finally {
      if (spawned) {
        await cleanupSpawnProcess(spawned);
      }
      await isolatedEnvironment.cleanup();
    }
  },
  e2eTimeoutMs
);
