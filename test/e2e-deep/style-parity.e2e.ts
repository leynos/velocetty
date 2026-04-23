/**
 * @file Deep E2E assertion for CSS Modules parity after styled-jsx removal.
 * Purpose: Validate a live packaged renderer still preserves themed new-tab
 * styling plus legacy terminal compatibility classes.
 */
import fs from 'node:fs/promises';

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
const closeTimeoutMs = 5_000;

test('preserves CSS Modules style parity for themed new-tab UI and terminal compatibility classes', async ({
  page: _page
}, testInfo) => {
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
      const newTabButton = document.querySelector<HTMLButtonElement>(
        'button[title="New Tab"], button[aria-label="New Tab"]'
      );
      if (!newTabButton) {
        throw new Error('[e2e] style parity check failed: missing New Tab button');
      }
      newTabButton.click();
    });
    await expect
      .poll(async () => await mainWindow?.evaluate(() => document.querySelector('[role="menu"]') !== null), {
        timeout: rendererReadyTimeoutMs
      })
      .toBe(true);

    const styleParity = await mainWindow.evaluate(() => {
      const fail = (message: string): never => {
        throw new Error(`[e2e] style parity check failed: ${message}`);
      };

      const resolveCssColor = (value: string) => {
        const probe = document.createElement('div');
        probe.style.color = value;
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };

      const newTabButton = document.querySelector<HTMLButtonElement>('button[aria-label="New Tab"]');
      if (!newTabButton) {
        fail('missing New Tab button');
      }

      const newTabWrapper = newTabButton.parentElement;
      if (!newTabWrapper) {
        fail('missing New Tab wrapper');
      }

      const dropdown = document.querySelector<HTMLElement>('[role="menu"]');
      if (!dropdown) {
        fail('missing profile dropdown after opening the New Tab menu');
      }

      const dropdownItem = document.querySelector<HTMLElement>('[role="menuitem"]');
      if (!dropdownItem) {
        fail('missing profile dropdown item');
      }

      const termFit = document.querySelector<HTMLElement>('.term_fit');
      if (!termFit) {
        fail('missing `.term_fit` legacy compatibility class');
      }

      const termWrapper = document.querySelector<HTMLElement>('.term_wrapper');
      if (!termWrapper) {
        fail('missing `.term_wrapper` legacy compatibility class');
      }

      const wrapperStyle = getComputedStyle(newTabWrapper);
      const dropdownStyle = getComputedStyle(dropdown);
      const dropdownItemStyle = getComputedStyle(dropdownItem);
      const expectedBorderColor = resolveCssColor(wrapperStyle.getPropertyValue('--new-tab-border').trim());
      const expectedBackgroundColor = resolveCssColor(wrapperStyle.getPropertyValue('--new-tab-bg').trim());

      return {
        newTabButtonClassName: newTabButton.className,
        dropdownClassName: dropdown.className,
        dropdownItemClassName: dropdownItem.className,
        termFitClassName: termFit.className,
        termWrapperClassName: termWrapper.className,
        newTabBorderVar: wrapperStyle.getPropertyValue('--new-tab-border').trim(),
        newTabBackgroundVar: wrapperStyle.getPropertyValue('--new-tab-bg').trim(),
        dropdownPosition: dropdownStyle.position,
        dropdownTop: dropdownStyle.top,
        dropdownZIndex: dropdownStyle.zIndex,
        dropdownBackgroundColor: dropdownStyle.backgroundColor,
        dropdownBorderColor: dropdownStyle.borderLeftColor,
        dropdownItemLineHeight: dropdownItemStyle.lineHeight,
        dropdownItemBorderColor: dropdownItemStyle.borderBottomColor,
        expectedBorderColor,
        expectedBackgroundColor
      };
    });

    expect(styleParity.newTabButtonClassName).not.toBe('');
    expect(styleParity.dropdownClassName).not.toBe('');
    expect(styleParity.dropdownItemClassName).not.toBe('');
    expect(styleParity.newTabBorderVar).not.toBe('');
    expect(styleParity.newTabBackgroundVar).not.toBe('');
    expect(styleParity.dropdownPosition).toBe('absolute');
    expect(styleParity.dropdownTop).toBe('33px');
    expect(styleParity.dropdownZIndex).toBe('1000');
    expect(styleParity.dropdownBackgroundColor).toBe(styleParity.expectedBackgroundColor);
    expect(styleParity.dropdownBorderColor).toBe(styleParity.expectedBorderColor);
    expect(styleParity.dropdownItemBorderColor).toBe(styleParity.expectedBorderColor);
    expect(styleParity.dropdownItemLineHeight).toBe('34px');
    expect(styleParity.termFitClassName).toContain('term_fit');
    expect(styleParity.termWrapperClassName).toContain('term_wrapper');
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
