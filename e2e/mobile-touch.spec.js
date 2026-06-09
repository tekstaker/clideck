// Phase 15 R3 — touch baseline: tap-to-focus + soft keyboard work on phone.
//
// SPEC R3: "Touch baseline: tap-to-focus + soft keyboard work on phone.
// Minimum bar for 'usable on phone' is unblocked typing into a session." The
// acceptance criterion is that tapping the terminal pane raises the native
// soft keyboard; in a scripted Playwright context the analogous assertion
// is that `document.activeElement` becomes the xterm-helper-textarea (the
// element xterm.js sinks keystrokes through).
//
// CONTEXT D-13 / D-14: "Lean on xterm.js textarea — verify only, no new code
// unless verification fails." Phase 11's wider focus-on-click target should
// already route taps through to the helper-textarea. This spec is the
// verification gate; if it goes RED in Wave 3 against a real Playwright
// run, D-15 contingency (an explicit `touchstart` -> `entry.term.focus()`)
// kicks in. For Wave 0 we author the gate against the locked contract.
//
// This spec is authored RED today only insofar as the surrounding work
// (sidebar-collapses-on-mobile, indicator markup, etc.) hasn't landed.
// The tap-to-focus assertion itself MAY pass against current main if Phase
// 11's focus restoration already covers touch — in which case this becomes
// a regression net rather than a TDD red. Per CLAUDE.md §1 we document
// either outcome honestly in the SUMMARY rather than pretending one or
// the other.
//
// Analog: e2e/session-indicator-mutex.spec.js (full WS recorder + spawnSession);
// the mobile-context shape is derived from Playwright docs since this repo
// has no prior mobile-context E2E (15-PATTERNS.md §13). Helpers inlined
// per 15-PATTERNS.md Shared 7.
//
// Wave 3 verification concern (Phase 16 interaction): Playwright's mobile
// contexts go through the same WS upgrade path. Bootstrap-mode TEST_HOME
// (empty devices.json) keeps the upgrade open; if a future test setup
// pre-populates devices.json the mobile-context WS hits clideck-device-token
// auth-rejection instead of the focus assertion.

const { test, expect, devices } = require('@playwright/test');

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

test.describe('Phase 15 R3 — mobile tap-to-focus baseline', () => {

  test('iPhone 12: tap on .term-wrap focuses the xterm-helper-textarea', async ({ browser }) => {
    // iPhone 12 = 390×844, isMobile: true, hasTouch: true. This is the
    // Playwright preset that most closely matches a modern smartphone in
    // portrait. The 'has touch' bit is what makes .tap() route through
    // the real PointerEvent path rather than the synthetic-click fallback.
    const ctx = await browser.newContext({ ...devices['iPhone 12'] });
    const page = await ctx.newPage();

    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const sessionId = await spawnSession(page);

    // Two taps: first the row (to make it active), then the terminal pane
    // (the focus target). The session-row tap routes through select() which
    // mounts the term-wrap; we then wait for it to be visible before tapping.
    await page.locator(`.group[data-id="${sessionId}"]`).tap();
    await expect(page.locator('.term-wrap').first()).toBeVisible();
    await page.locator('.term-wrap').first().tap();

    // The contract: the active element is xterm's hidden textarea. That's
    // what raises the soft keyboard on real iOS/Android and is what
    // routes typed characters into the PTY.
    const focused = await page.evaluate(() =>
      document.activeElement?.classList?.contains('xterm-helper-textarea')
    );
    expect(focused).toBe(true);

    await ctx.close();
  });
});
