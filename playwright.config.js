const { defineConfig, devices } = require('@playwright/test');
const { e2eHome, e2eDataDir } = require('./e2e/paths');

// Isolated home directory for the test server. clideck stores config and
// sessions under os.homedir() + '/.clideck/', so we point os.homedir() at a
// dedicated tempdir for the test run. This keeps the user's real ~/.clideck/
// untouched.
//
// CRITICAL (2026-06-09): the path must be DETERMINISTIC, not mkdtempSync().
// Playwright evaluates this config module SEPARATELY in the main process AND
// in every worker process. A random per-evaluation tempdir meant the server
// (spawned from main) and the spec helpers (running in a worker) computed
// DIFFERENT dirs — so a worker reading `bootstrap.otp` never found the
// server's file. THAT was the "e2e fixture-bug deferred" from Phase 16. A
// fixed path (e2e/paths.js, shared by config + specs) makes every process
// agree. A globalSetup wipes it ONCE per run for a clean slate.
const TEST_HOME = e2eHome();
const DATA_DIR = e2eDataDir();
// The clean-slate wipe happens in e2e/serve.js (the webServer command), in the
// server's own process immediately before boot — see that file for why it
// can't live here or in a globalSetup.

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
    command: 'node e2e/serve.js',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      CLIDECK_PORT: String(PORT),
      // Override the home directory so paths.js's DATA_DIR lands in the
      // dedicated tempdir and never writes to the user's real ~/.clideck/.
      USERPROFILE: TEST_HOME,
      HOME: TEST_HOME,
      // Explicit data dir — the deterministic path from e2e/paths.js, the same
      // value the specs compute, so bootstrap.otp is written and read in one place.
      CLIDECK_DATA_DIR: DATA_DIR,
    },
  },
});
