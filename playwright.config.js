const { defineConfig, devices } = require('@playwright/test');
const { mkdtempSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

// Isolated home directory for the test server. clideck stores config and
// sessions under os.homedir() + '/.clideck/', so we point os.homedir() at a
// fresh tempdir for the test run. This keeps the user's real ~/.clideck/
// untouched and gives every CI/local run a clean default config.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'clideck-e2e-'));

// Non-standard port — avoids clashes with the user's real clideck running on
// 4000 and with most dev-server defaults (Vite 5173, Next 3000, etc.).
const PORT = Number(process.env.CLIDECK_E2E_PORT) || 4099;

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server.js',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      CLIDECK_PORT: String(PORT),
      // Override the home directory so paths.js's DATA_DIR lands in a
      // fresh tempdir and never writes to the user's real ~/.clideck/.
      USERPROFILE: TEST_HOME,
      HOME: TEST_HOME,
    },
  },
});
