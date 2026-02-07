/**
 * @file Deep E2E assertion for packaged Electron terminal interaction.
 * Purpose: Validate renderer readiness plus one interactive terminal command
 * path with deterministic failure artefacts.
 */
import fs from 'node:fs/promises';

import {_electron} from 'playwright';
import {expect, test} from 'playwright/test';

import {
  createIsolatedE2EEnvironment,
  readActiveTerminalBuffer,
  resolveLaunchConfig,
  startRendererConsoleMonitor,
  waitForRendererReady,
  withTimeout
} from '../e2e/electron-e2e-helpers';

const launchTimeoutMs = 20_000;
const windowTimeoutMs = 10_000;
const rendererReadyTimeoutMs = 12_000;
const commandOutputTimeoutMs = 12_000;
const closeTimeoutMs = 5_000;

test('renders command output after terminal input', async ({page: _page}, testInfo) => {
  const {pathToBinary, launchArgs} = resolveLaunchConfig();
  await fs.access(pathToBinary);
  const isolatedEnvironment = await createIsolatedE2EEnvironment();

  const app = await withTimeout(
    _electron.launch({
      executablePath: pathToBinary,
      args: launchArgs,
      env: isolatedEnvironment.env,
      timeout: launchTimeoutMs
    }),
    launchTimeoutMs
  );

  const process = app.process();
  let stdoutLog = '';
  let stderrLog = '';
  const rendererConsoleLog: string[] = [];
  process?.stdout?.on('data', (chunk) => {
    stdoutLog += chunk.toString();
  });
  process?.stderr?.on('data', (chunk) => {
    stderrLog += chunk.toString();
  });

  let monitor: ReturnType<typeof startRendererConsoleMonitor> | null = null;
  let mainWindow: Awaited<ReturnType<typeof app.firstWindow>> | null = null;

  try {
    mainWindow = await withTimeout(app.firstWindow(), windowTimeoutMs);
    monitor = startRendererConsoleMonitor(mainWindow);
    mainWindow.on('console', (message) => {
      rendererConsoleLog.push(`[${message.type()}] ${message.text()}`);
    });

    await waitForRendererReady(mainWindow, rendererReadyTimeoutMs);
    await mainWindow.evaluate(() => {
      if (typeof window.focusActiveTerm === 'function') {
        window.focusActiveTerm();
      }
    });
    await mainWindow.locator('.xterm-helper-textarea').first().focus();

    const sentinel = `E2E_SENTINEL_${Date.now()}`;
    await mainWindow.keyboard.type(`echo ${sentinel}`);
    await mainWindow.keyboard.press('Enter');

    await expect
      .poll(async () => (await readActiveTerminalBuffer(mainWindow)).join('\n'), {
        timeout: commandOutputTimeoutMs
      })
      .toContain(sentinel);

    expect(monitor.criticalErrors).toHaveLength(0);
  } finally {
    monitor?.stop();

    await testInfo.attach('electron-stdout.log', {
      body: stdoutLog || 'No stdout output captured.',
      contentType: 'text/plain'
    });
    await testInfo.attach('electron-stderr.log', {
      body: stderrLog || 'No stderr output captured.',
      contentType: 'text/plain'
    });
    await testInfo.attach('renderer-console.log', {
      body: rendererConsoleLog.join('\n') || 'No renderer console output captured.',
      contentType: 'text/plain'
    });

    if (mainWindow && testInfo.status !== testInfo.expectedStatus) {
      const screenshot = await mainWindow.screenshot({fullPage: true});
      await testInfo.attach('renderer-failure.png', {
        body: screenshot,
        contentType: 'image/png'
      });
    }

    try {
      await withTimeout(app.close(), closeTimeoutMs);
    } catch {
      process?.kill('SIGKILL');
    }
    await isolatedEnvironment.cleanup();
  }
});
