import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/.artifacts',
  globalSetup: './e2e/global-setup.js',

  use: {
    baseURL: BASE_URL,
    // Locally, drive the installed Chrome so no browser bundle is downloaded.
    // CI has no system Chrome, so it installs Playwright's Chromium and sets
    // PLAYWRIGHT_BROWSER=chromium to select it.
    ...(process.env.PLAYWRIGHT_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  // The build happens in globalSetup; this only serves it. `vite preview`
  // binds to localhost only unless told otherwise, which the 127.0.0.1 health
  // probe would never reach.
  webServer: {
    command: `npx vite preview --config vite.demo.config.js --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
