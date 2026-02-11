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

e2eTest(
  'launches the packaged app',
  async () => {
    const startTime = Date.now();
    const log = (message: string) => {
      if (!debugE2E) {
        return;
      }
      const elapsedMs = Date.now() - startTime;
      console.log(`[e2e ${elapsedMs}ms] ${message}`);
    };
    let app: ElectronApplication | null = null;
    let spawned: ReturnType<typeof spawn> | null = null;
    let rendererConsoleMonitor: ReturnType<typeof startRendererConsoleMonitor> | null = null;
    const isolatedEnvironment = await createIsolatedE2EEnvironment();
    const outputTracker = createSpawnOutputTracker();
    try {
      const {pathToBinary, launchArgs} = resolveLaunchConfig();
      if (!(await fs.pathExists(pathToBinary))) {
        throw new Error(`Expected packaged app binary at ${pathToBinary}. Run bun run dist first.`);
      }
      log(`CI=${process.env.CI ?? 'unset'} driver=${shouldUsePlaywright ? 'playwright' : 'spawn'}`);
      log(`Launching ${pathToBinary} with args: ${launchArgs.join(' ') || '(none)'}`);
      if (shouldUsePlaywright) {
        app = await withTimeout(
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
        rendererConsoleMonitor = startRendererConsoleMonitor(window);
        log('Waiting for renderer readiness markers.');
        await waitForRendererReady(window, rendererReadyTimeoutMs);
        expect(rendererConsoleMonitor.criticalErrors).toHaveLength(0);
        log('First window resolved.');
      } else {
        spawned = spawn(pathToBinary, launchArgs, {
          env: isolatedEnvironment.env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
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
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            if (spawned?.pid) {
              resolve();
              return;
            }
            spawned?.once('error', reject);
            spawned?.once('spawn', () => resolve());
          }),
          launchTimeoutMs
        );
        log(`Spawned Electron PID: ${spawned.pid ?? 'unknown'}.`);
        await outputTracker.waitForSpawnOutput(/running in prod mode|electron will open/i, windowTimeoutMs);
        await outputTracker.waitForSpawnOutput(/\[e2e\] renderer-ready/i, rendererReadyTimeoutMs);
        await withTimeout(
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), spawnStabilityTimeoutMs);
          }),
          spawnStabilityTimeoutMs + 100
        );
        if (spawned.exitCode != null) {
          throw new Error(`Electron exited early with code ${spawned.exitCode}. Output:\n${outputTracker.getOutput()}`);
        }
        expect(outputTracker.extractCriticalRendererErrors()).toHaveLength(0);
      }
    } finally {
      rendererConsoleMonitor?.stop();
      if (app && shouldCapture) {
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
      }
      if (app) {
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
      }
      if (spawned) {
        spawned.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (spawned.exitCode == null) {
          spawned.kill('SIGKILL');
        }
      }
      await isolatedEnvironment.cleanup();
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

      spawned.stdout?.on('data', (data) => {
        outputTracker.appendOutputChunk(data.toString());
      });
      spawned.stderr?.on('data', (data) => {
        outputTracker.appendOutputChunk(data.toString());
      });

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          if (spawned?.pid) {
            resolve();
            return;
          }
          spawned?.once('error', reject);
          spawned?.once('spawn', () => resolve());
        }),
        launchTimeoutMs
      );

      await outputTracker.waitForSpawnOutput(/running in dev mode|electron will open/i, windowTimeoutMs);
      await outputTracker.waitForSpawnOutput(/\[e2e\] renderer-ready/i, rendererReadyTimeoutMs);
      await withTimeout(
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), spawnStabilityTimeoutMs);
        }),
        spawnStabilityTimeoutMs + 100
      );

      if (spawned.exitCode != null) {
        throw new Error(
          `Development Electron exited early with code ${spawned.exitCode}. Output:\n${outputTracker.getOutput()}`
        );
      }

      expect(outputTracker.extractCriticalRendererErrors()).toHaveLength(0);
    } finally {
      if (spawned) {
        spawned.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (spawned.exitCode == null) {
          spawned.kill('SIGKILL');
        }
      }
      await isolatedEnvironment.cleanup();
    }
  },
  e2eTimeoutMs
);
