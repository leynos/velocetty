/** @file End-to-end smoke tests for packaged Electron builds. */
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
const shouldUsePlaywright = driverOverride ? driverOverride === 'playwright' : !isCi;

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timed out after ${ms}ms`));
        }, ms);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

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
    try {
      const {pathToBinary, launchArgs} = resolveLaunchConfig();
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
          if (debugE2E) {
            process.stdout.write(chunk);
          }
        });
        spawned.stderr?.on('data', (data) => {
          const chunk = data.toString();
          spawnOutput += chunk;
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
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (spawned.exitCode != null) {
          throw new Error(`Electron exited early with code ${spawned.exitCode}. Output:\n${spawnOutput}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      if (app && shouldCapture) {
        try {
          const imageBuffer = await withTimeout(
            app
              .evaluate(({BrowserWindow}) =>
                BrowserWindow.getFocusedWindow()
                  ?.capturePage()
                  .then((img) => img.toPNG().toString('base64'))
              )
              .then((img) => Buffer.from(img || '', 'base64')),
            2_000
          );
          if (imageBuffer) {
            await fs.writeFile(`dist/tmp/${process.platform}_test.png`, imageBuffer);
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
