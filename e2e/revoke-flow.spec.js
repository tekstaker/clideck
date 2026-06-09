// Phase 16 — Wave 0 RED-state Playwright spec for the Settings → Linked
// devices → Revoke flow.
//
// AC mapping:
//   - AC5 (revoke closes live sockets — observed via WS close 4401 → /pair)
//   - AC6 (revoked device can re-pair — covered by pair-flow.spec.js on
//     re-run; this spec proves the SOURCE of revoke)
//   - D-06 (two confirm-modal copy variants: other-device vs this-device)
//
// RED reason (expected today):
//   - There is no Settings → Linked devices panel (Wave 3 plan 16-07
//     adds it: nav button `data-cat="devices"` + #settings-devices panel).
//   - There is no device.list broadcast (Wave 3 plan 16-07).
//   - There is no device.revoke message arm (Wave 2 plan 16-05 +
//     Wave 3 plan 16-07).
//   - public/js/app.js does not handle WS close 4401 with localStorage
//     clear + /pair redirect (Wave 2 plan 16-06).
//   Every assertion in this file fails today.
//
// PATTERNS §1 row 24 / §1 row 36 — extends the e2e/session-pause.spec.js
// `injectMessageEvent` trick (synthesise WS MessageEvents to drive the
// UI without depending on server-side device.list machinery being ready).
//
// Per CLAUDE.md §13 — the bootstrap OTP and device token are not echoed
// to test stdout. They're consumed in-process.

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

const { e2eDataDir } = require('./paths');
function dataDirFromEnv() {
  // Deterministic shared path (e2e/paths.js) — identical in the server's
  // process and this worker, so bootstrap.otp is read where the server wrote
  // it. CLIDECK_DATA_DIR override wins if a real shell sets it. (2026-06-09)
  return process.env.CLIDECK_DATA_DIR || e2eDataDir();
}

async function pairBootstrap(page) {
  // Bootstrap-pair flow shared with pair-flow.spec.js.
  await expect.poll(
    () => existsSync(join(dataDirFromEnv(), 'bootstrap.otp')),
    { timeout: 5_000, intervals: [100, 200, 500] }
  ).toBe(true);
  const bootstrapOtp = readFileSync(join(dataDirFromEnv(), 'bootstrap.otp'), 'utf8').trim();
  // Do NOT echo bootstrapOtp.
  await page.goto('/pair');
  await page.locator('#otp').fill(bootstrapOtp);
  await page.locator('#label').fill('This Device');
  await page.locator('#pair-submit').click();
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('clideck.deviceToken')),
    { timeout: 10_000 }
  ).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await waitForAppReady(page);
}

// Synthesise a server → client MessageEvent on the live WS. Mirrors
// e2e/session-pause.spec.js:75-83.
async function injectMessageEvent(page, msgObj) {
  await page.evaluate((data) => {
    /** @type {any} */ const w = window;
    const evt = new MessageEvent('message', { data: JSON.stringify(data) });
    w.__ws.dispatchEvent(evt);
  }, msgObj);
}

test.describe('revoke flow — Settings → Linked devices → Revoke (AC5, AC6, D-06)', () => {

  test('other-device revoke: open panel, inject device.list, click Revoke, confirm modal text, click confirm → device.revoke sent', async ({ page }) => {
    await installWsRecorder(page);
    await pairBootstrap(page);

    // Open Settings → Linked devices.
    await page.locator('#rail-settings').click();
    await page.locator('[data-cat="devices"]').click();
    await expect(page.locator('#settings-devices')).toBeVisible();

    // Wait for the server's REAL device.list to land first. 16-07 shipped the
    // live broadcast (handlers send it on WS handshake), so if we inject our
    // synthetic list before the real one arrives, the real render lands AFTER
    // our injection and detaches the row we're about to click — a DOM-detach
    // flake. Waiting here makes our injection the LAST render. (2026-06-09)
    await expect(page.locator('#settings-devices [data-device-id]').first()).toBeVisible();

    // Inject a synthetic device.list that adds a second device. The real
    // server broadcast lands in Wave 3 plan 16-07; this spec proves the
    // client-side render path independently.
    await injectMessageEvent(page, {
      type: 'device.list',
      list: [
        { id: 'dev_self_for_test', label: 'This Device', paired_at: '2026-06-05T12:00:00Z', last_seen: '2026-06-05T12:00:00Z', live: true },
        { id: 'dev_other', label: 'Other Phone', paired_at: '2026-06-05T11:00:00Z', last_seen: '2026-06-05T11:30:00Z', live: false },
      ],
    });

    // Both rows render.
    await expect(page.locator('#settings-devices [data-device-id="dev_other"]')).toBeVisible();
    await expect(page.locator('#settings-devices [data-device-id="dev_self_for_test"]')).toBeVisible();

    // Click Revoke on the OTHER device. D-06 confirm modal opens with the
    // other-device copy variant (mentions the label, "signed out
    // immediately", offers re-pair).
    await page.locator('#settings-devices [data-device-id="dev_other"] [data-action="revoke"]').click();
    const ccMessage = page.locator('#cc-message');
    await expect(ccMessage).toBeVisible();
    await expect(ccMessage).toContainText(/will be signed out immediately/);
    await expect(ccMessage).toContainText(/Other Phone/);

    // Confirm.
    await page.locator('#cc-confirm').click();

    // The client sends a device.revoke frame over the WS.
    const revokeFrames = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return w.__sentMessages.filter(m => m && m.type === 'device.revoke');
    });
    expect(revokeFrames).toEqual([
      expect.objectContaining({ type: 'device.revoke', deviceId: 'dev_other' }),
    ]);
  });

  test('self-revoke: D-06 stronger warning, confirm → device.revoke + simulated WS 4401 close → /pair redirect, localStorage cleared', async ({ page }) => {
    await installWsRecorder(page);
    await pairBootstrap(page);

    await page.locator('#rail-settings').click();
    await page.locator('[data-cat="devices"]').click();
    await expect(page.locator('#settings-devices')).toBeVisible();

    // Inject a device.list that includes THIS device's id. We synthesise
    // a 'dev_self_for_test' id that the test will also claim as state.deviceId.
    await injectMessageEvent(page, {
      type: 'device.list',
      list: [
        { id: 'dev_self_for_test', label: 'This Device', paired_at: '2026-06-05T12:00:00Z', last_seen: '2026-06-05T12:00:00Z', live: true },
      ],
    });
    // Patch in-page state.deviceId so settings.js treats dev_self_for_test
    // as the current device — exercises the D-06 stronger-warning branch.
    await page.evaluate(async () => {
      const mod = await import('/js/state.js');
      mod.state.deviceId = 'dev_self_for_test';
    });

    await page.locator('#settings-devices [data-device-id="dev_self_for_test"] [data-action="revoke"]').click();
    const ccMessage = page.locator('#cc-message');
    await expect(ccMessage).toBeVisible();
    // D-06 self-revoke copy: stronger warning about being signed out of
    // THIS browser and the active session list closing.
    await expect(ccMessage).toContainText(/signed out of this browser immediately/);
    await expect(ccMessage).toContainText(/active session list will close/);

    await page.locator('#cc-confirm').click();

    // Client sent a device.revoke frame for itself.
    const revokeFrames = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return w.__sentMessages.filter(m => m && m.type === 'device.revoke');
    });
    expect(revokeFrames).toEqual([
      expect.objectContaining({ type: 'device.revoke', deviceId: 'dev_self_for_test' }),
    ]);

    // Simulate the server's response: close the WS with 4401, 'revoked'.
    // (In production, sessions.closeDevice from Wave 2 plan 16-05 fires
    // ws.close(4401, 'revoked') on the matching ws.) The client's
    // onclose-handler (Wave 2 plan 16-06) must clear localStorage and
    // redirect to /pair.
    await page.evaluate(() => {
      /** @type {any} */ const w = window;
      // Use the synthetic 'close' event since the runner doesn't have
      // direct control over the server's close frame timing.
      w.__ws.close(4401, 'revoked');
    });

    await expect(page).toHaveURL(/\/pair$/, { timeout: 10_000 });
    const tokenAfter = await page.evaluate(() => localStorage.getItem('clideck.deviceToken'));
    expect(tokenAfter).toBeNull();
  });
});
