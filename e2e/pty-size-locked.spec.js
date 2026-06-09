// Phase 15 R2 — server-side PTY-resize lock end-to-end.
//
// SPEC R2: "PTY size is locked at session creation; later `resize` messages
// are ignored." Per CONTEXT D-04 this is a server-side no-op — the change is
// in sessions.js (function resize) which today still does the passthrough.
// Plan 15-02 makes resize a no-op so concurrent clients at different
// viewports stop fighting over the PTY's cols/rows.
//
// This spec is the E2E counterpart to tests/sessions-resize.test.js
// (the unit-level R2 gate). It spawns a real session at 120×30, sends a
// hand-crafted `{type:'resize', id, cols: 40, rows: 10}` over the live
// WebSocket (the same path a malicious or old-fork client would use), and
// polls the xterm `term.cols` / `term.rows` properties — proving the PTY
// width was NOT reshaped.
//
// This spec is authored RED per CLAUDE.md §2 (TDD-first). It will FAIL today
// because sessions.js resize() still calls pty.resize(40, 10), which propagates
// back to the client as the new locked size. Plan 15-02 turns this green.
//
// Analog: e2e/session-indicator-mutex.spec.js — same installWsRecorder +
// waitForAppReady + spawnSession idiom, extended to accept cols/rows.
// Helpers inlined per 15-PATTERNS.md Shared 7.
//
// Wave 3 verification concern (Phase 16 interaction): under playwright.config.js,
// devices.json starts empty in TEST_HOME → bootstrap mode → the WS upgrade
// path is not gated by clideck-device-token. If a future test-environment
// change starts the server with pre-populated devices.json, this spec hits
// auth-rejection instead of testing the resize lock; document as a Wave 3
// gap if so.

const { test, expect } = require('@playwright/test');

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

async function spawnSession(page, opts = {}) {
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  await page.evaluate(({ cols, rows }) => {
    /** @type {any} */ const w = window;
    w.__ws.send(JSON.stringify({ type: 'create', cols, rows }));
  }, { cols, rows });
  const sessionId = await page.evaluate(async () => {
    /** @type {any} */ const w = window;
    const seen = new Set(w.__rxMessages.filter((m) => m.type === 'created').map((m) => m.id));
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const next = w.__rxMessages.find((m) => m.type === 'created' && !seen.has(m.id));
      if (next) return next.id;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });
  expect(sessionId, 'server should broadcast a created message').toBeTruthy();
  await expect(page.locator(`.group[data-id="${sessionId}"]`)).toBeVisible({ timeout: 5_000 });
  return sessionId;
}

test.describe('Phase 15 R2 — PTY size locked at create-time', () => {

  test('sending a resize message after create does NOT shrink term.cols / term.rows', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    // Spawn a session at the larger desktop-ish size — 120×30 was the
    // example pinned in SPEC R2 ("with a session created from desktop
    // (e.g. 120×30)"). The PTY locks to these dimensions for life.
    const sessionId = await spawnSession(page, { cols: 120, rows: 30 });

    // Hand-craft the malicious shrink — same wire shape a phone client
    // would send via the existing client-side fit listener that D-05
    // intentionally leaves untouched.
    await page.evaluate(({ id }) => {
      /** @type {any} */ const w = window;
      w.__ws.send(JSON.stringify({ type: 'resize', id, cols: 40, rows: 10 }));
    }, { id: sessionId });

    // Give the server a generous window to (incorrectly) round-trip the
    // resize. The polling timeout exceeds any realistic broadcast latency
    // on localhost — if the server is going to reshape the PTY it will
    // do so well within 2s. The poll asserts the cols/rows STAY at the
    // creator-locked value the entire time.
    await expect.poll(
      async () => page.evaluate(async ({ id }) => {
        const { state } = await import('/js/state.js');
        const entry = state.terms.get(id);
        return entry ? { cols: entry.term.cols, rows: entry.term.rows } : null;
      }, { id: sessionId }),
      { timeout: 2_000, intervals: [100, 250, 500, 1_000] }
    ).toEqual({ cols: 120, rows: 30 });
  });
});
