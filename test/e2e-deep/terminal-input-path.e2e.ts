/**
 * @file Deep E2E assertion for packaged Electron terminal interaction.
 * Purpose: Validate renderer readiness plus one interactive terminal command
 * path with deterministic failure artefacts.
 */
import fs from 'node:fs/promises';

import type {Page} from 'playwright';
import {_electron} from 'playwright';
import {expect, test} from 'playwright/test';

import {
  createIsolatedE2EEnvironment,
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

const readActiveTerminalBuffer = async (windowPage: Page) =>
  await windowPage.evaluate(() => {
    const termWrapper = document.querySelector('.term_wrapper');
    if (!termWrapper) {
      return [];
    }

    const fiberKey = Object.getOwnPropertyNames(termWrapper).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) {
      return [];
    }

    let node: unknown = (termWrapper as Record<string, unknown>)[fiberKey];
    let termComponent: {
      term?: {buffer?: {active?: {_buffer?: {lines?: {length?: number; get?: (index: number) => any}}}}};
    } | null = null;
    for (let i = 0; i < 50 && node; i += 1) {
      const currentNode = node as {stateNode?: unknown; return?: unknown};
      if (
        currentNode.stateNode &&
        typeof currentNode.stateNode === 'object' &&
        'term' in currentNode.stateNode &&
        (currentNode.stateNode as {term?: unknown}).term
      ) {
        termComponent = currentNode.stateNode as typeof termComponent;
        break;
      }
      node = currentNode.return;
    }

    const lines = termComponent?.term?.buffer?.active?._buffer?.lines;
    if (!lines || typeof lines.length !== 'number' || typeof lines.get !== 'function') {
      return [];
    }

    const output: string[] = [];
    const start = Math.max(0, lines.length - 40);
    for (let index = start; index < lines.length; index += 1) {
      const line = lines.get(index) as {translateToString?: (trimRight?: boolean) => string} | undefined;
      output.push(line?.translateToString?.(true) ?? '');
    }
    return output;
  });

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
