// Phase 16 — Wave 0 RED-state Playwright spec for the end-to-end pair flow.
//
// AC mapping:
//   - AC1 (fresh load is gated — empty localStorage navigates to /pair, no WS)
//   - AC2 (successful pair persists — valid OTP → token persisted, dashboard reloads)
//   - AC3 (known device reconnects silently — valid token in localStorage → direct dashboard)
//   - AC7 (owner bootstrap path works — reads bootstrap.otp written by server boot)
//
// RED reason (expected today):
//   - GET /pair route does not exist on main.
//   - /pair/redeem route does not exist.
//   - The WS subprotocol auth gate does not exist.
//   - public/js/app.js does not check localStorage.clideck.deviceToken at boot.
//   - public/js/app.js does not handle WS close 4401.
//   - No bootstrap.otp is written by the server (no bootstrapIfNeeded()).
//   Result: every test in this file fails today, by design.
//
// PATTERNS §1 row 19 flags this as the FIRST standalone-page (non-app-shell)
// Playwright spec in clideck. The form-driven flow is novel-for-clideck;
// the installWsRecorder helper is reused verbatim from e2e/smoke.spec.js.
//
// Per CLAUDE.md §13 — the OTP and device token are not echoed to stdout
// from this test. They live only in the test process's local
// variables and the playwright HOME tempdir. The TEST_HOME path comes
// from playwright.config.js's mkdtempSync trick (HOME / USERPROFILE
// pointed at a per-run tempdir so the server's ~/.clideck/ never
// collides with the user's real one).
//
// playwright.config.js exposes TEST_HOME via process.env.HOME in the
// webServer.env block; the test process inherits process.env.HOME from
// the playwright runner, NOT the webServer block. We must therefore
// derive the bootstrap.otp path from the same logic the server uses:
// either CLIDECK_DATA_DIR (if set) or os.homedir() + '/.clideck/'.
// The playwright config does NOT set CLIDECK_DATA_DIR for the runner,
// only HOME — so this test reads from process.env.HOME +
// '/.clideck/bootstrap.otp' which matches the server's data dir.

const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

async function installWsRecorder(page) {
  await page.addInitScript(() => {
    /** @type {any} */ const w = window;
    w.__rxTypes = new Set();
    w.__rxMessages = [];
    w.__sentMessages = [];
    const OrigWS = w.WebSocket;
    function PatchedWS(...args) {
      const ws = new OrigWS(...args);
      const origSend = ws.send.bind(ws);
      ws.send = function (data) {
        try { w.__sentMessages.push(JSON.parse(data)); } catch { w.__sentMessages.push(String(data)); }
        return origSend(data);
      };
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          w.__rxTypes.add(msg.type);
          w.__rxMessages.push(msg);
        } catch {}
      });
      w.__ws = ws;
      return ws;
    }
    PatchedWS.prototype = OrigWS.prototype;
    PatchedWS.CONNECTING = OrigWS.CONNECTING;
    PatchedWS.OPEN = OrigWS.OPEN;
    PatchedWS.CLOSING = OrigWS.CLOSING;
    PatchedWS.CLOSED = OrigWS.CLOSED;
    w.WebSocket = PatchedWS;
  });
}

async function waitForAppReady(page) {
  await expect.poll(
    async () => page.evaluate(() => Array.from(/** @type {any} */ (window).__rxTypes || [])),
    { timeout: 10_000, intervals: [100, 200, 500] }
  ).toEqual(expect.arrayContaining(['config', 'sessions', 'presets']));
}

// Mirror server-side paths.js logic. The playwright runner inherits the
// runner-process HOME, but the SERVER (started by playwright.config.js
// webServer) gets a tempdir HOME. The bootstrap file lives in the
// server's data dir, derivable here from the same HOME the webServer
// env block sets — but the runner process doesn't see it. So we ALSO
// fall back to scanning for any '.clideck' under common tmpdir prefixes
// if the canonical path is empty.
const { e2eDataDir } = require('./paths');
function dataDirFromEnv() {
  // Deterministic shared path (e2e/paths.js) — identical in the server's
  // process and this worker, so bootstrap.otp is read where the server wrote
  // it. CLIDECK_DATA_DIR override wins if a real shell sets it. (2026-06-09)
  return process.env.CLIDECK_DATA_DIR || e2eDataDir();
}

test.describe('pair flow — bootstrap + dashboard reconnect (AC1, AC2, AC3, AC7)', () => {
  let capturedToken = null;

  // CHANGED 2026-06-09 (localhost-trust): the e2e server runs on loopback,
  // and the owner at the machine is now trusted by locality — a fresh local
  // browser must NOT be bounced to /pair. It connects tokenless and loads the
  // dashboard directly. (The remote/untrusted "→ /pair" gate is covered by
  // the verifyClient unit tests in tests/loopback-trust.test.js, which can
  // synthesise a non-loopback peer that Playwright-on-localhost cannot.)
  test('AC1 — empty localStorage on loopback loads the dashboard directly (no /pair redirect)', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    // Stays on /, does NOT redirect to /pair.
    await expect(page).not.toHaveURL(/\/pair$/);
    // Tokenless loopback connection comes up and the app hydrates.
    await waitForAppReady(page);
    const hasToken = await page.evaluate(() => localStorage.getItem('clideck.deviceToken'));
    expect(hasToken).toBeNull(); // connected with no paired token — pure loopback trust
  });

  test('AC2 + AC7 — bootstrap OTP end-to-end: read bootstrap.otp → fill /pair form → submit → dashboard with live WS', async ({ page }) => {
    // Wait for the server to write the bootstrap OTP (first boot of the
    // tempdir HOME means devices.json is empty → bootstrapIfNeeded() runs).
    await expect.poll(
      () => existsSync(join(dataDirFromEnv(), 'bootstrap.otp')),
      { timeout: 5_000, intervals: [100, 200, 500] }
    ).toBe(true);
    const bootstrapOtp = readFileSync(join(dataDirFromEnv(), 'bootstrap.otp'), 'utf8').trim();
    // Do NOT echo bootstrapOtp to stdout — CLAUDE.md §13.

    await installWsRecorder(page);
    await page.goto('/pair');
    await page.locator('#otp').fill(bootstrapOtp);
    await page.locator('#label').fill('E2E Test Phone');
    await page.locator('#pair-submit').click();

    // After redeem, app.js stores localStorage.clideck.deviceToken and
    // navigates back to /. Assert post-pair the token is a 43-char
    // base64url string (256-bit token per RESEARCH §2).
    await expect.poll(
      () => page.evaluate(() => localStorage.getItem('clideck.deviceToken')),
      { timeout: 10_000 }
    ).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(page).toHaveURL(/\/(?:$|#)/, { timeout: 10_000 });
    await waitForAppReady(page);

    // Persist for AC3 reuse.
    capturedToken = await page.evaluate(() => localStorage.getItem('clideck.deviceToken'));
    expect(capturedToken).toBeTruthy();
  });

  test('AC3 — known device with valid token reconnects silently (no /pair redirect)', async ({ page }) => {
    // Sanity: AC2 must have completed first.
    test.skip(!capturedToken, 'AC2 must run first to capture a device token');
    await installWsRecorder(page);
    // Seed the localStorage BEFORE navigation so the boot-time check finds it.
    await page.goto('/'); // first navigation gives us a context to set localStorage on
    await page.evaluate((tok) => localStorage.setItem('clideck.deviceToken', tok), capturedToken);
    await page.goto('/');
    // Stay on /, do NOT redirect to /pair.
    await expect(page).not.toHaveURL(/\/pair$/);
    await expect(page.locator('#nav-rail')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#session-list')).toBeVisible();
    await waitForAppReady(page);
  });
});
