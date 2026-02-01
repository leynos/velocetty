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
  'see if dev tools are open',
  async () => {
    let app: ElectronApplication | null = null;
    try {
      const {pathToBinary, launchArgs} = resolveLaunchConfig();
      app = await _electron.launch({
        executablePath: pathToBinary,
        args: launchArgs
      });
      await app.firstWindow();
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const isDevToolsOpen = await app.evaluate(
        ({webContents}) => !!webContents.getFocusedWebContents()?.isDevToolsOpened()
      );
      expect(isDevToolsOpen).toBe(false);
    } finally {
      if (app) {
        await app
          .evaluate(({BrowserWindow}) =>
            BrowserWindow.getFocusedWindow()
              ?.capturePage()
              .then((img) => img.toPNG().toString('base64'))
          )
          .then((img) => Buffer.from(img || '', 'base64'))
          .then(async (imageBuffer) => {
            await fs.writeFile(`dist/tmp/${process.platform}_test.png`, imageBuffer);
          });
        await app.close();
      }
    }
  },
  e2eTimeoutMs
);
