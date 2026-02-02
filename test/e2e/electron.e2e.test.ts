/**
 * @file End-to-end smoke tests for packaged Electron builds.
 * Purpose: Validate that packaged Electron binaries can launch and respond.
 * Usage: Set RUN_E2E=1, optionally E2E_DRIVER=playwright|spawn, E2E_DEBUG=1,
 * or E2E_CAPTURE=1 for extra diagnostics.
 */
// Native
import {spawn} from 'node:child_process';
import path from 'node:path';

// Packages
import {expect, test} from 'bun:test';
import fs from 'fs-extra';
import {_electron} from 'playwright';
import type {ElectronApplication} from 'playwright';

const shouldRunE2E = process.env.RUN_E2E === '1';
const e2eTest = shouldRunE2E ? test : test.skip;
const e2eTimeoutMs = 30_000;
const launchTimeoutMs = 15_000;
const windowTimeoutMs = 10_000;
const closeTimeoutMs = 5_000;
const shouldCapture = process.env.E2E_CAPTURE === '1';
const isCi =
  process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== '0' && process.env.CI !== 'false';
const shouldWaitForWindow = !isCi;
const debugE2E = process.env.E2E_DEBUG === '1';
const driverOverride = process.env.E2E_DRIVER;
const validDrivers = new Set(['playwright', 'spawn']);
if (shouldRunE2E && driverOverride && !validDrivers.has(driverOverride)) {
  throw new Error(`E2E_DRIVER must be "playwright" or "spawn", received "${driverOverride}".`);
}
const shouldUsePlaywright = driverOverride ? driverOverride === 'playwright' : !isCi;

/**
 * Returns a promise that rejects when the timeout elapses.
 *
 * # Parameters
 * - `promise`: Work to race against the timeout.
 * - `ms`: Timeout in milliseconds.
 *
 * # Returns
 * The resolved value of `promise` if it finishes in time.
 *
 * # Examples
 *
 * ```ts
 * await withTimeout(Promise.resolve('ok'), 500);
 * ```
 */
const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (didTimeout) {
      void promise.catch(() => {});
    }
  }
};

/**
 * Resolves the packaged Electron binary path and platform-specific arguments.
 *
 * # Returns
 * An object shaped as `{pathToBinary: string, launchArgs: string[]}` with the
 * resolved binary path and any required launch arguments for the current
 * platform.
 *
 * # Platform support
 * - `linux`: `dist/linux-unpacked/hyper`
 * - `darwin`: `dist/mac/Hyper.app/Contents/MacOS/Hyper`
 * - `win32`: `dist/win-unpacked/Hyper.exe`
 *
 * On Linux, when `CI='true'` or `ELECTRON_DISABLE_SANDBOX='1'`, the function
 * adds `--no-sandbox` and `--disable-setuid-sandbox` to `launchArgs`. It throws
 * an `Error` for unsupported platforms.
 *
 * # Examples
 *
 * ```ts
 * const {pathToBinary, launchArgs} = resolveLaunchConfig();
 * ```
 */
const resolveLaunchConfig = () => {
  let pathToBinary: string;
  const launchArgs: string[] = [];

  switch (process.platform) {
    case 'linux':
      pathToBinary = path.join(__dirname, '../../dist/linux-unpacked/hyper');
      break;

    case 'darwin':
      pathToBinary = path.join(__dirname, '../../dist/mac/Hyper.app/Contents/MacOS/Hyper');
      break;

    case 'win32':
      pathToBinary = path.join(__dirname, '../../dist/win-unpacked/Hyper.exe');
      break;

    default:
      throw new Error(
        'Path to the built binary needs to be defined for this platform in test/e2e/electron.e2e.test.ts'
      );
  }

  if (process.platform === 'linux' && (process.env.CI === 'true' || process.env.ELECTRON_DISABLE_SANDBOX === '1')) {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return {pathToBinary, launchArgs};
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
    let spawnOutput = '';
    let outputWatchers: Array<{matcher: RegExp; resolve: () => void}> = [];
    const notifyOutputWatchers = () => {
      outputWatchers.forEach((watcher) => {
        if (watcher.matcher.test(spawnOutput)) {
          watcher.resolve();
        }
      });
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
            timeout: launchTimeoutMs
          }),
          launchTimeoutMs
        );
        log('Electron launch completed.');
        if (shouldWaitForWindow) {
          log('Waiting for first window.');
          const window = await withTimeout(app.firstWindow(), windowTimeoutMs);
          expect(window).toBeDefined();
          log('First window resolved.');
        } else {
          const process = app.process();
          expect(process).toBeDefined();
          log(`Electron process PID: ${process?.pid ?? 'unknown'}.`);
        }
      } else {
        spawned = spawn(pathToBinary, launchArgs, {
          env: {...process.env},
          stdio: ['ignore', 'pipe', 'pipe']
        });
        spawned.stdout?.on('data', (data) => {
          const chunk = data.toString();
          spawnOutput += chunk;
          notifyOutputWatchers();
          if (debugE2E) {
            process.stdout.write(chunk);
          }
        });
        spawned.stderr?.on('data', (data) => {
          const chunk = data.toString();
          spawnOutput += chunk;
          notifyOutputWatchers();
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
        await waitForSpawnOutput(/running in prod mode|electron will open/i, windowTimeoutMs);
        if (spawned.exitCode != null) {
          throw new Error(`Electron exited early with code ${spawned.exitCode}. Output:\n${spawnOutput}`);
        }
      }
    } finally {
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
    }
  },
  e2eTimeoutMs
);
