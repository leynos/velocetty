/**
 * @file Deep E2E assertion for the settings tab.
 *
 * Opens the packaged application against an isolated config directory, opens
 * settings from the preferences shortcut, changes and resets a value, enters an
 * invalid one, and asserts the exact config file each time — including a
 * sentinel comment that must survive every write. The terminal's reported size
 * is recorded before settings opens and after returning to it, because a tab
 * that resized the PTY would have broken a running session.
 */
import fs from 'node:fs/promises';
import JSON5 from 'json5';
import path from 'node:path';

import {_electron} from 'playwright';
import type {Page} from 'playwright';
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
const fileTimeoutMs = 15_000;
const closeTimeoutMs = 5000;

const SENTINEL = '// velocetty-e2e-sentinel: keep this comment';
// The golden-path plugin persists its defaults at start-up, so the exact
// document includes that namespace alongside the core setting.
const GOLDEN_PATH_SETTINGS = {
  enabled: true,
  message: 'Golden path plugin command invoked.',
  tabPrefix: 'GP'
};
const expectedConfig = (fontSize?: number) => {
  const plugins = {'velocetty.golden-path-demo': GOLDEN_PATH_SETTINGS};
  if (fontSize === undefined) {
    return {config: {plugins}};
  }
  return {config: {fontSize, plugins}};
};
const SEEDED_CONFIG = `{
  ${SENTINEL}
  config: {
    fontSize: 14
  }
}
`;

/** Streamed Electron output, accumulated for failure artefacts. */
type RunLogs = {stdout: string; stderr: string; rendererConsole: string[]};

const launchPackagedApp = async (isolatedEnvironment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>) => {
  const {pathToBinary, launchArgs} = resolveLaunchConfig();
  // A developer can run this lane without a display; CI supplies one.
  const headlessArgs = process.env.E2E_OZONE_HEADLESS === '1' ? ['--ozone-platform=headless'] : [];
  await fs.access(pathToBinary);
  return withTimeout(
    _electron.launch({
      executablePath: pathToBinary,
      args: [...launchArgs, ...headlessArgs],
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
  await testInfo.attach('electron-stdout.log', {body: logs.stdout || 'No stdout output.', contentType: 'text/plain'});
  await testInfo.attach('electron-stderr.log', {body: logs.stderr || 'No stderr output.', contentType: 'text/plain'});
  await testInfo.attach('renderer-console.log', {
    body: logs.rendererConsole.join('\n') || 'No renderer console output.',
    contentType: 'text/plain'
  });
};

const configPathFor = (environment: Awaited<ReturnType<typeof createIsolatedE2EEnvironment>>): string =>
  path.join(environment.env.XDG_CONFIG_HOME, 'Hyper', 'config.json5');

const readConfig = (configPath: string): Promise<string> => fs.readFile(configPath, 'utf8');

/**
 * Types `stty size` in the terminal and reads the `rows cols` line it prints.
 *
 * The PTY answers with the size it was given, so this is the closest observable
 * proxy for "the terminal was not resized".
 */
const readTerminalSize = async (window: Page) => {
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('stty size');
  await window.keyboard.press('Enter');
  let size = '';
  await expect
    .poll(
      async () => {
        const lines = await readActiveTerminalBuffer(window);
        const buffer = lines.join('\n');
        const match = /\b(\d{1,3}) (\d{1,3})\b/g;
        const matches = [...buffer.matchAll(match)];
        size = matches.at(-1)?.[0] ?? '';
        return size;
      },
      {timeout: commandOutputTimeoutMs}
    )
    .not.toBe('');
  return size;
};

/** Exercises the seeded field: edit, invalid value, and reset. */
const exerciseEdits = async (window: Page, configPath: string): Promise<void> => {
  // Browsing shows the seeded value from the file.
  await expect(window.locator('#core-fontSize-control')).toHaveValue('14');

  // A valid edit is written and the sentinel comment survives. The parsed
  // document is asserted exactly, not by a substring: the writer must change
  // only the edited value.
  await window.locator('#core-fontSize-control').fill('16');
  await window.locator('#core-fontSize-control').press('Enter');
  await expect.poll(async () => readConfig(configPath), {timeout: fileTimeoutMs}).toContain('fontSize: 16');
  const afterEdit = await readConfig(configPath);
  expect(JSON5.parse(afterEdit)).toEqual(expectedConfig(16));
  expect(afterEdit).toContain(SENTINEL);

  // An invalid value shows an inline error and leaves the file untouched.
  const beforeInvalid = await readConfig(configPath);
  await window.locator('#core-fontSize-control').fill('abc');
  await window.locator('#core-fontSize-control').press('Enter');
  await expect(window.locator('#core-fontSize-errors')).toContainText('Enter a number');
  await expect(window.locator('#core-fontSize-control')).toHaveAttribute('aria-invalid', 'true');
  expect(await readConfig(configPath)).toBe(beforeInvalid);

  // Reset removes the key and keeps the comment. A pointer click proves the
  // results area is not covered by the fixed header; the row control's
  // keyboard path is covered by the unit suite.
  const resetButton = window.getByRole('button', {name: 'Reset Font size to default'});
  await resetButton.scrollIntoViewIfNeeded();
  await expect(resetButton).toBeInViewport();
  await resetButton.click();
  await expect.poll(async () => readConfig(configPath), {timeout: fileTimeoutMs}).not.toContain('fontSize');
  const afterReset = await readConfig(configPath);
  expect(JSON5.parse(afterReset)).toEqual(expectedConfig());
  expect(afterReset).toContain(SENTINEL);
};

test('settings tab edits, validates, and resets the config file', async ({page: _page}, testInfo) => {
  const isolatedEnvironment = await createIsolatedE2EEnvironment();
  const configPath = configPathFor(isolatedEnvironment);
  await fs.mkdir(path.dirname(configPath), {recursive: true});
  await fs.writeFile(configPath, SEEDED_CONFIG);

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
    const sizeBefore = await readTerminalSize(window);

    // The preferences shortcut opens the settings tab. The key bindings are
    // registered asynchronously at start-up, so the press is repeated until the
    // tab appears rather than assuming the first one was bound.
    const preferencesShortcut = process.platform === 'darwin' ? 'Meta+,' : 'Control+,';
    const settingsTab = window.locator('header li', {hasText: 'Settings'});
    const searchInput = window.locator('input[type="search"]');
    // The key bindings register asynchronously at start-up, so press until the
    // search box actually holds focus; a visible tab alone is not proof that
    // the activation reached the renderer.
    const openSettings = async (): Promise<void> => {
      await expect
        .poll(
          async () => {
            if ((await searchInput.count()) === 0) {
              await window.keyboard.press(preferencesShortcut);
              return false;
            }
            if (!(await searchInput.evaluate((node) => node === document.activeElement))) {
              await window.keyboard.press(preferencesShortcut);
              return false;
            }
            return true;
          },
          {timeout: 15_000, intervals: [500]}
        )
        .toBe(true);
    };
    await openSettings();
    await expect(settingsTab).toBeVisible();

    // Headless ozone gives the window a very small content box in which the
    // Settings tab itself sits at the edge. Use a normal desktop size for the
    // pointer round trip; the panel scrolls either way.
    await app.evaluate(({BrowserWindow}) => {
      const [main] = BrowserWindow.getAllWindows();
      main.setSize(1000, 800);
    });
    await searchInput.click();

    // Opening settings never resized the running terminal.
    await window.locator('header li').first().click();
    const sizeAfterVisit = await readTerminalSize(window);
    expect(sizeAfterVisit).toBe(sizeBefore);
    await openSettings();
    await expect(settingsTab).toBeVisible();

    await exerciseEdits(window, configPath);

    expect(monitor.criticalErrors).toHaveLength(0);
  } finally {
    monitor?.stop();
    await attachRunArtefacts(testInfo, logs);

    if (mainWindow && testInfo.status !== testInfo.expectedStatus) {
      const screenshot = await mainWindow.screenshot({fullPage: true});
      await testInfo.attach('settings-tab-failure.png', {body: screenshot, contentType: 'image/png'});
    }

    try {
      await withTimeout(app.close(), closeTimeoutMs);
    } catch {
      electronProcess.kill('SIGKILL');
    }
    await isolatedEnvironment.cleanup();
  }
});
