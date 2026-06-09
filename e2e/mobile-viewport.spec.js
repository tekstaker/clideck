// Phase 15 R6 — phone-viewport responsive: no page-body overflow + walkthrough.
//
// SPEC R6: "Responsive layout: dashboard is operable on a phone viewport
// (≤ 480px width). The terminal, session list, sidebar nav, and primary
// controls all function on a phone." Acceptance: at 375×667 (iPhone-ish)
// Chromium DevTools mobile emulation, manual walkthrough of `[load → switch
// session → type into terminal → open sidebar → close sidebar → create new
// session → delete session]` completes with every control reachable and no
// visible layout overflow on the page body.
//
// CONTEXT D-16 + UI-SPEC "Phone-viewport responsive contract": EXTEND the
// existing `@media (max-width: 960px)` block in public/index.html — do NOT
// add a new ≤480px breakpoint tier. The 960px overlay already covers
// sidebar + nav-toggle; the only phase-15 additions are
// `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }`
// inside that media query.
//
// This spec asserts the SPEC R6 contract from the verification side:
//   1. At iPhone 12 (390×844) — bigger than 375 but within the same
//      breakpoint regime — `document.body.scrollWidth === window.innerWidth`
//      (the page itself does not horizontally scroll; the terminal inside
//      it may, that's expected).
//   2. The walkthrough: spawn session → tap #mobile-nav-toggle → assert
//      `body.mobile-nav-open` is present → tap #mobile-nav-close → assert
//      it is gone → re-assert no page-body overflow.
//
// This spec is authored RED per CLAUDE.md §2 (TDD-first):
//   - Today (before Plan 04 lands the deletion + 04/05 land the responsive
//     CSS) the page MAY already render at 375×667 within budget OR may
//     overflow depending on whether the deleted rail icons / Phase-16
//     additions are pushing the body wide. RED-vs-green here depends on
//     where exactly the failure lands; per CLAUDE.md §1 we don't predict,
//     we just document the actual outcome in the SUMMARY.
//
// Analog: e2e/session-indicator-mutex.spec.js for the WS recorder +
// spawnSession; mobile-context shape from 15-PATTERNS.md §15. Helpers
// inlined per Shared 7.
//
// Wave 3 verification concern (Phase 16 interaction): Phase 16 added a
// fifth "Linked devices" section to the Settings panel. The 960px
// responsive block (public/index.html: roughly @media (max-width: 960px)
// at the top of the file) hasn't been re-audited against that addition,
// so the walkthrough may surface a Phase 16 overflow in a section that
// wasn't visible in pre-PR-#8 main. Surface as a Wave-3 finding if so.

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

test.describe('Phase 15 R6 — phone-viewport responsive', () => {

  test('iPhone 12 viewport: no horizontal page-body overflow on load', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 12'] });
    const page = await ctx.newPage();

    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    // The page body itself must NOT horizontally scroll — that's the
    // chrome-overflows-the-screen failure mode SPEC R6 explicitly forbids.
    // (The terminal pane INSIDE the body is allowed to scroll horizontally
    // when the locked PTY width exceeds the viewport — that's the per
    // CONTEXT D-16 / UI-SPEC "Terminal pane overflow" decision.)
    const bodyOverflows = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth
    );
    expect(bodyOverflows).toBe(false);

    // The mobile-nav-toggle is the entry point to the sidebar at this
    // breakpoint. Verify it's visible (the @media (max-width: 960px) rule
    // toggles its display).
    await expect(page.locator('#mobile-nav-toggle')).toBeVisible();

    await ctx.close();
  });

  test('iPhone 12 walkthrough: create → sidebar open → sidebar close → no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 12'] });
    const page = await ctx.newPage();

    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    // Step 1 — create a session, terminal mounts.
    const sessionId = await spawnSession(page);
    await expect(page.locator(`.group[data-id="${sessionId}"]`)).toBeVisible();

    // Step 2 — open the sidebar via the mobile toggle. The toggle adds
    // `body.mobile-nav-open` (public/js/app.js:632) which slides the
    // sidebar overlay in via the existing CSS rules in the 960px block.
    await page.locator('#mobile-nav-toggle').tap();
    await expect(page.locator('body.mobile-nav-open')).toHaveCount(1);

    // Step 3 — close the sidebar via the in-overlay close button.
    await page.locator('#mobile-nav-close').tap();
    await expect(page.locator('body.mobile-nav-open')).toHaveCount(0);

    // Step 4 — re-assert no horizontal page overflow after the chrome
    // state has been exercised. Catches regressions where opening then
    // closing the sidebar leaves a transient inline-style on body that
    // pushes the page wide.
    const bodyOverflows = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth
    );
    expect(bodyOverflows).toBe(false);

    await ctx.close();
  });
});
