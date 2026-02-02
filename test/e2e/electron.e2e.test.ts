/** @file End-to-end smoke tests for packaged Electron builds. */
// Native
import path from 'node:path';

// Packages
import {expect, test} from 'bun:test';
import fs from 'fs-extra';
import {_electron} from 'playwright';
import type {ElectronApplication} from 'playwright';

const shouldRunE2E = process.env.RUN_E2E === '1';
const e2eTest = shouldRunE2E ? test : test.skip;
const e2eTimeoutMs = 30_000;
const windowTimeoutMs = 10_000;
const closeTimeoutMs = 5_000;
const shouldCapture = process.env.E2E_CAPTURE === '1';

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
    let app: ElectronApplication | null = null;
    try {
      const {pathToBinary, launchArgs} = resolveLaunchConfig();
      app = await _electron.launch({
        executablePath: pathToBinary,
        args: launchArgs
      });
      const window = await withTimeout(app.firstWindow(), windowTimeoutMs);
      expect(window).toBeDefined();
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
          await withTimeout(app.close(), closeTimeoutMs);
        } catch (error) {
          const process = app.process();
          if (process && !process.killed) {
            process.kill('SIGKILL');
          }
          console.warn('E2E cleanup timed out; force-killed Electron.', error);
        }
      }
    }
  },
  e2eTimeoutMs
);
