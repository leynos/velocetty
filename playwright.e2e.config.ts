/** @file Playwright Test configuration for deep packaged Electron E2E coverage. */
import {defineConfig} from 'playwright/test';

const isCi =
  process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== '0' && process.env.CI !== 'false';

export default defineConfig({
  testDir: './test/e2e-deep',
  testMatch: ['**/*.e2e.ts'],
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  retries: isCi ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results/e2e-deep',
  reporter: [['list'], ['html', {open: 'never', outputFolder: 'playwright-report/e2e-deep'}]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});
