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
import type {ElectronApplication, Page} from 'playwright';
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

const terminalSizePattern = /^\d{1,3} \d{1,3}$/;
// `lib/components/term.tsx` debounces its ResizeObserver by 500ms before it
// refits xterm, so a baseline read any sooner can predate the resize.
const sizeSettleDelayMs = 2000;
const sizeSettleIntervalMs = 750;

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

/** Distinguishes one `stty size` request from responses left in scrollback. */
let terminalSizeSequence = 0;

/**
 * Types a uniquely marked `stty size` command and reads its `rows cols` line.
 *
 * The marker ties each read to its own command, because an earlier response
 * stays in the scrollback and would otherwise be matched again. The PTY
 * answers with the size it was given, so this is the closest observable proxy
 * for "the terminal was not resized".
 */
const readTerminalSize = async (window: Page) => {
  terminalSizeSequence += 1;
  const marker = `__size-${terminalSizeSequence}-${Date.now()}__`;
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type(`echo '${marker}'; stty size`);
  await window.keyboard.press('Enter');
  let size = '';
  await expect
    .poll(
      async () => {
        const bufferLines = await readActiveTerminalBuffer(window);
        const lines = bufferLines.map((line) => line.trim());
        // The shell echoes the typed command, and that echo contains the marker
        // as a substring. Only a line that is exactly the marker is this
        // command's output, so the size is the first size-shaped line after it.
        const markerIndex = lines.lastIndexOf(marker);
        const response =
          markerIndex === -1 ? undefined : lines.slice(markerIndex + 1).find((line) => terminalSizePattern.test(line));
        size = response ?? '';
        return size;
      },
      {timeout: commandOutputTimeoutMs}
    )
    .not.toBe('');
  return size;
};

/**
 * Reads the terminal size until two commands taken at least one fit interval
 * apart agree.
 *
 * The renderer debounces its ResizeObserver by 500 ms before refitting xterm
 * and telling the PTY the new geometry (`lib/components/term.tsx`), so two
 * readings taken immediately after the viewport changes can both report the
 * old size. Waiting longer than that debounce before the first reading, then
 * sampling until the value stops moving, keeps the baseline out of the resize
 * window.
 */
const readSettledTerminalSize = async (window: Page): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, sizeSettleDelayMs));
  let settled = await readTerminalSize(window);
  const deadline = Date.now() + commandOutputTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, sizeSettleIntervalMs));
    const current = await readTerminalSize(window);
    if (current === settled) {
      return current;
    }
    settled = current;
  }
  throw new Error(`Terminal size did not settle within ${commandOutputTimeoutMs}ms`);
};

/**
 * Gives the window a normal desktop size and waits for the renderer to see it.
 *
 * Headless ozone gives the window a very small content box in which the
 * Settings tab sits at the edge, so the pointer round trip needs a larger
 * window. Resizing before the baseline is read keeps the later comparison to
 * settings activation alone.
 */
const resizeWindowForSettings = async (window: Page, app: ElectronApplication): Promise<void> => {
  const readViewport = (): Promise<string> =>
    window.evaluate(() => `${globalThis.innerWidth}x${globalThis.innerHeight}`);
  const viewportBefore = await readViewport();
  await app.evaluate(({BrowserWindow}) => {
    const [main] = BrowserWindow.getAllWindows();
    main.setSize(1000, 800);
  });
  await expect.poll(readViewport, {timeout: windowTimeoutMs}).not.toBe(viewportBefore);
};

/** Opens settings, verifies the terminal size survived, and reopens them. */
const openSettingsAndVerifyTerminalSize = async (window: Page, sizeBefore: string): Promise<void> => {
  const preferencesShortcut = process.platform === 'darwin' ? 'Meta+,' : 'Control+,';
  const settingsTab = window.locator('header li', {hasText: 'Settings'});
  const searchInput = window.locator('input[type="search"]');
  // The key bindings register asynchronously at start-up, so press until the
  // search box actually holds focus; a visible tab alone is not proof that the
  // activation reached the renderer.
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
  await searchInput.click();

  // Opening settings never resized the running terminal.
  await window.locator('header li').first().click();
  const sizeAfterVisit = await readTerminalSize(window);
  expect(sizeAfterVisit).toBe(sizeBefore);
  // The settings layer stays mounted but inactive, and `inert` must keep its
  // controls out of the tab order and unable to take focus.
  const inactiveFocus = await window.locator('#core-fontSize-control').evaluate((node) => {
    node.focus();
    return {hasInertAncestor: node.closest('[inert]') !== null, focused: document.activeElement === node};
  });
  expect(inactiveFocus).toEqual({hasInertAncestor: true, focused: false});
  await openSettings();
  await expect(settingsTab).toBeVisible();
};

/** Exercises the seeded field: edit, invalid value, and reset. */
const exerciseEdits = async (window: Page, configPath: string, seededText: string): Promise<void> => {
  // Browsing shows the seeded value from the file.
  await expect(window.locator('#core-fontSize-control')).toHaveValue('14');

  // A valid edit is written and the sentinel comment survives. The parsed
  // document is asserted exactly, not by a substring: the writer must change
  // only the edited value.
  await window.locator('#core-fontSize-control').fill('16');
  await window.locator('#core-fontSize-control').press('Enter');
  await expect.poll(async () => readConfig(configPath), {timeout: fileTimeoutMs}).toContain('fontSize: 16');
  const afterEdit = await readConfig(configPath);
  // Exact text: the writer may change only the edited value.
  expect(afterEdit).toBe(seededText.replace('fontSize: 14', 'fontSize: 16'));
  expect(JSON5.parse(afterEdit)).toEqual(expectedConfig(16));
  expect(afterEdit).toContain(SENTINEL);

  // An invalid value shows an inline error and leaves the file untouched.
  const beforeInvalid = await readConfig(configPath);
  await window.locator('#core-fontSize-control').fill('abc');
  await window.locator('#core-fontSize-control').press('Enter');
  await expect(window.locator('#core-fontSize-errors')).toContainText('Enter a number');
  await expect(window.locator('#core-fontSize-control')).toHaveAttribute('aria-invalid', 'true');
  expect(await readConfig(configPath)).toBe(beforeInvalid);

  // The plan's observable-success scenario also names scrollback: an invalid
  // value there is refused the same way and leaves the file untouched.
  const scrollback = window.locator('#core-scrollback-control');
  await scrollback.fill('abc');
  await scrollback.press('Enter');
  await expect(window.locator('#core-scrollback-errors')).toContainText('Enter a number');
  expect(await readConfig(configPath)).toBe(beforeInvalid);

  const resetButton = window.getByRole('button', {name: 'Reset Font size to default'});
  const restoreAndReset = async (activate: () => Promise<void>): Promise<void> => {
    await window.locator('#core-fontSize-control').fill('16');
    await window.locator('#core-fontSize-control').press('Enter');
    await expect.poll(async () => readConfig(configPath), {timeout: fileTimeoutMs}).toContain('fontSize: 16');
    await activate();
    await expect.poll(async () => readConfig(configPath), {timeout: fileTimeoutMs}).not.toContain('fontSize');
  };

  // The keyboard reaches the button from its control, activates it, and the
  // control takes focus back afterwards.
  await restoreAndReset(async () => {
    await window.locator('#core-fontSize-control').focus();
    await window.keyboard.press('Tab');
    await expect(resetButton).toBeFocused();
    await window.keyboard.press('Enter');
  });
  await expect(window.locator('#core-fontSize-control')).toBeFocused();
  const afterReset = await readConfig(configPath);
  // Exact text: the key's value is removed and nothing else changes. The
  // removal leaves the line's indentation behind, as the edit core specifies.
  expect(afterReset).toBe(seededText.replace('    fontSize: 14,', '    '));
  expect(JSON5.parse(afterReset)).toEqual(expectedConfig());
  expect(afterReset).toContain(SENTINEL);

  // A pointer can also reach the button: scroll it into view in the real
  // viewport and click it, so a fixed header covering the row would fail.
  // The second insertion changes the layout around the key, so this pass
  // asserts the parsed document and the surviving comment, not exact text.
  await restoreAndReset(async () => {
    await resetButton.scrollIntoViewIfNeeded();
    await expect(resetButton).toBeInViewport();
    await resetButton.click();
  });
  const afterPointerReset = await readConfig(configPath);
  expect(JSON5.parse(afterPointerReset)).toEqual(expectedConfig());
  expect(afterPointerReset).toContain(SENTINEL);
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
    // The resize is part of the baseline: the comparison below must isolate
    // settings activation, not a geometry change.
    await resizeWindowForSettings(window, app);
    const sizeBefore = await readSettledTerminalSize(window);

    // The preferences shortcut opens the settings tab. The key bindings are
    // registered asynchronously at start-up, so the press is repeated until the
    // tab appears rather than assuming the first one was bound.
    await openSettingsAndVerifyTerminalSize(window, sizeBefore);

    const seededAtStart = await readConfig(configPath);
    expect(seededAtStart).toContain('fontSize: 14');
    await exerciseEdits(window, configPath, seededAtStart);

    expect(monitor.criticalErrors).toHaveLength(0);
  } finally {
    monitor?.stop();
    // A failed screenshot must not skip shutdown: when the window is already
    // gone, `screenshot` rejects, so cleanup sits in a nested `finally`.
    try {
      await attachRunArtefacts(testInfo, logs);

      if (mainWindow && testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await mainWindow.screenshot({fullPage: true});
        await testInfo.attach('settings-tab-failure.png', {body: screenshot, contentType: 'image/png'});
      }
    } finally {
      try {
        await withTimeout(app.close(), closeTimeoutMs);
      } catch {
        electronProcess.kill('SIGKILL');
      }
      await isolatedEnvironment.cleanup();
    }
  }
});
