/**
 * @file Deep E2E assertion for the frontend command dispatcher.
 *
 * Purpose: prove the three promises roadmap item 4.1.1 makes, against the
 * packaged application, through the real renderer:
 *
 * 1. A keybinding opens the search box, which means the shortcut reached the
 *    dispatcher and its handler ran.
 * 2. The search box close button closes it, which means the first UI control
 *    routed through the dispatcher works.
 * 3. With the box closed, Escape reaches the terminal, which means a shortcut
 *    that is refused at admission still delivers its key to xterm.
 *
 * Step 3 is the regression guard for the Escape bug: binding
 * `editor:search-close` to a schema that rejected a missing argument would
 * swallow every Escape press.
 *
 * Usage:
 * - `bun run test:e2e:deep` (CI runs it under Xvfb; locally add
 *   `--ozone-platform=headless`, see `docs/developers-guide.md`).
 *
 * Related modules:
 * - `electron-e2e-helpers.ts` supplies launch, buffer, and monitor helpers.
 * - `lib/command-dispatch/inbound/keybinding.ts` implements the pass-through.
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
const searchBoxTimeoutMs = 15_000;
const commandOutputTimeoutMs = 12_000;
const closeTimeoutMs = 5000;
const shortcutAttempts = 10;

/** The search shortcut bound in `app/keymaps/linux.json`. */
const SEARCH_SHORTCUT = 'Control+Shift+F';

/** Labels the search box and its close button render. */
const SEARCH_INPUT_LABEL = 'Search';
const SEARCH_CLOSE_LABEL = 'Close';

/** Streamed Electron output, accumulated for failure artefacts. */
interface RunLogs {
  stdout: string;
  stderr: string;
  rendererConsole: string[];
}

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

test('a shortcut, a UI control, and Escape all travel through the dispatcher', async ({page: _page}, testInfo) => {
  const isolatedEnvironment = await createIsolatedE2EEnvironment();
  const app = await launchPackagedApp(isolatedEnvironment);
  const logs = startRunLogCapture(app);
  const electronProcess = app.process();

  let monitor: ReturnType<typeof startRendererConsoleMonitor> | null = null;
  let mainWindow: Awaited<ReturnType<typeof app.firstWindow>> | null = null;

  try {
    const window = await withTimeout(app.firstWindow(), windowTimeoutMs);
    mainWindow = window;
    monitor = startRendererConsoleMonitor(window);
    window.on('console', (message) => {
      logs.rendererConsole.push(`[${message.type()}] ${message.text()}`);
    });

    await waitForRendererReady(window, rendererReadyTimeoutMs);
    await window.evaluate(() => {
      // Serialized into the renderer: only globals exist there.
      globalThis.focusActiveTerm?.();
    });
    await window.locator('.xterm-helper-textarea').first().focus();

    // 1. The keybinding opens the search box. Bindings attach asynchronously,
    //    so each attempt is retried inside the deadline and every attempt is
    //    logged.
    const searchInput = window.locator(`input[aria-label="${SEARCH_INPUT_LABEL}"]`).first();
    const opened = await (async () => {
      for (let attempt = 1; attempt <= shortcutAttempts; attempt += 1) {
        await window.keyboard.press(SEARCH_SHORTCUT);
        try {
          await searchInput.waitFor({state: 'visible', timeout: searchBoxTimeoutMs / shortcutAttempts});
          return true;
        } catch {
          testInfo.annotations.push({
            type: 'search-shortcut-attempt',
            description: `Attempt ${attempt} did not open the search box yet`
          });
        }
      }
      return false;
    })();
    expect(opened).toBe(true);

    // 2. The close button closes it, through `editor:search-close`.
    await window.locator(`button[aria-label="${SEARCH_CLOSE_LABEL}"]`).first().click();
    await expect(searchInput).toBeHidden({timeout: searchBoxTimeoutMs});

    // 3. Escape must still reach the terminal. `cat -v` renders a literal ESC
    //    as `^[`, which is observable in the buffer.
    await window.locator('.xterm-helper-textarea').first().focus();
    const sentinel = `E2E_DISPATCH_${Date.now()}`;
    await window.keyboard.type(`cat -v # ${sentinel}`);
    await window.keyboard.press('Enter');
    await window.keyboard.press('Escape');
    await window.keyboard.press('Enter');

    await expect
      .poll(
        async () => {
          const buffer = await readActiveTerminalBuffer(window);
          return buffer.join('\n');
        },
        {timeout: commandOutputTimeoutMs}
      )
      .toContain('^[');

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
