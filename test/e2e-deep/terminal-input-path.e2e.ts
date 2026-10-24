/**
 * @file Deep E2E assertion for packaged Electron terminal interaction.
 * Purpose: Validate renderer readiness plus one interactive terminal command
 * path with deterministic failure artefacts.
 */
import fs from 'node:fs/promises';

import {_electron} from 'playwright';
import {expect, test} from 'playwright/test';
import type {TestInfo} from 'playwright/test';

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
const closeTimeoutMs = 5000;

/** Streamed Electron output, accumulated for failure artefacts. */
type RunLogs = {
  stdout: string;
  stderr: string;
  rendererConsole: string[];
};

/** Launches the packaged binary against an isolated config environment. */
const launchPackagedApp = async (isolatedEnvironment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>) => {
  const {pathToBinary, launchArgs} = resolveLaunchConfig();
  await fs.access(pathToBinary);
  return withTimeout(
    _electron.launch({
      executablePath: pathToBinary,
      args: [...launchArgs],
      env: isolatedEnvironment.env,
      timeout: launchTimeoutMs
    }),
    launchTimeoutMs
  );
};

/**
 * Starts collecting process and renderer output.
 *
 * The listeners are attached before anything can fail so that a launch-time
 * crash still leaves a readable log to attach.
 */
const startRunLogCapture = (app: Awaited<ReturnType<typeof _electron.launch>>): RunLogs => {
  const logs: RunLogs = {stdout: '', stderr: '', rendererConsole: []};
  const electronProcess = app.process();
  electronProcess.stdout?.on('data', (chunk) => {
    logs.stdout += chunk.toString();
  });
  electronProcess.stderr?.on('data', (chunk) => {
    logs.stderr += chunk.toString();
  });
  return logs;
};

const attachRunArtefacts = async (testInfo: TestInfo, logs: RunLogs): Promise<void> => {
  await testInfo.attach('electron-stdout.log', {
    body: logs.stdout || 'No stdout output captured.',
    contentType: 'text/plain'
  });
  await testInfo.attach('electron-stderr.log', {
    body: logs.stderr || 'No stderr output captured.',
    contentType: 'text/plain'
  });
  await testInfo.attach('renderer-console.log', {
    body: logs.rendererConsole.join('\n') || 'No renderer console output captured.',
    contentType: 'text/plain'
  });
};

test('renders command output after terminal input', async ({page: _page}, testInfo) => {
  const isolatedEnvironment = await createIsolatedE2EEnvironment();
  const app = await launchPackagedApp(isolatedEnvironment);
  const logs = startRunLogCapture(app);
  const electronProcess = app.process();

  let monitor: ReturnType<typeof startRendererConsoleMonitor> | null = null;
  let mainWindow: Awaited<ReturnType<typeof app.firstWindow>> | null = null;

  try {
    // Bound once to a `const`: the `finally` block still needs the nullable
    // `mainWindow`, while the body below wants the narrowed window.
    const window = await withTimeout(app.firstWindow(), windowTimeoutMs);
    mainWindow = window;
    monitor = startRendererConsoleMonitor(window);
    window.on('console', (message) => {
      logs.rendererConsole.push(`[${message.type()}] ${message.text()}`);
    });

    await waitForRendererReady(window, rendererReadyTimeoutMs);
    await window.evaluate(() => {
      // This callback is serialized and evaluated in the renderer, so it can
      // only reference globals. A module import here would not exist there.
      globalThis.focusActiveTerm?.();
    });
    await window.locator('.xterm-helper-textarea').first().focus();

    const sentinel = `E2E_SENTINEL_${Date.now()}`;
    await window.keyboard.type(`echo ${sentinel}`);
    await window.keyboard.press('Enter');

    await expect
      .poll(
        async () => {
          const activeTerminalBuffer = await readActiveTerminalBuffer(window);
          return activeTerminalBuffer.join('\n');
        },
        {
          timeout: commandOutputTimeoutMs
        }
      )
      .toContain(sentinel);

    expect(monitor.criticalErrors).toHaveLength(0);
  } finally {
    monitor?.stop();

    await attachRunArtefacts(testInfo, logs);

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
      electronProcess.kill('SIGKILL');
    }
    await isolatedEnvironment.cleanup();
  }
});
