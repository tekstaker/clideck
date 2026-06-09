// Phase 15 R4 + R5 — two-context concurrent input + indicator visibility.
//
// SPEC R4: "Same-session concurrency works for both viewing AND input. Both
// clients see the same output and either client's keystrokes reach the PTY."
// SPEC R5: "When ≥2 WS clients are present on the server, every session row
// shows a small visual indicator."
//
// CONTEXT D-08 (server-wide count) + D-09 (broadcast on connect/close):
// handlers.js gains the `sessions.broadcast({type:'clients.count', count})`
// push, and public/js/app.js gains a `case 'clients.count':` arm that calls
// `updateOtherClientIndicator(msg.count)`. Both server hook and client arm
// land in Plans 03 + 05 respectively.
//
// This spec drives two parallel browser contexts inside ONE Playwright
// worker (playwright.config.js: workers=1, fullyParallel=false), which is
// what makes them observably share the same `node server.js` process and
// therefore the same `sessions.clients` Set. That sharedness is the whole
// load-bearing assumption — without it the R5 test can't tell whether the
// indicator-toggle is real or a coincidence.
//
// This spec is authored RED per CLAUDE.md §2 (TDD-first):
//   - R4 test: today `sessions.broadcast` already fans output to every
//     client (sessions.js:53), and the input handler is a passthrough,
//     so R4 MAY pass on current main. Lance considers R4 "already works
//     in principle but never exercised" (SPEC R4 background). This spec
//     is a regression net — it locks the existing-but-unverified
//     behaviour so any future change that breaks it surfaces immediately.
//   - R5 test: today `.other-client-indicator` does not exist in the DOM
//     (Plan 05 adds the markup) and the `clients.count` broadcast is not
//     sent (Plan 03 adds the server hook). The test will fail with a
//     locator-timeout because the selector matches zero elements. Plans
//     03 + 05 turn it green.
//
// Analog: e2e/session-indicator-mutex.spec.js (single-context spawnSession
// + WS recorder), extended to two `browser.newContext()` calls per
// 15-PATTERNS.md §14b derivation. Helpers inlined per Shared 7.
//
// Wave 3 verification concern (Phase 16 interaction): both contexts go
// through clideck-device-token WS verifyClient. Bootstrap-mode TEST_HOME
// (empty devices.json) keeps both upgrades open. Note the SECOND context
// counts toward `sessions.clients.size` only if its upgrade succeeds —
// if Phase 16 ever rejects the second context's WS (e.g. if Tab A's
// connection somehow gets credited and Tab B's is denied), the R5 test
// fails with a true positive: no `clients.count` rises to >1, indicator
// stays hidden. Document the failure mode in Wave 3 VERIFICATION.md if so.

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

test.describe('Phase 15 R4 + R5 — two-client concurrent attach', () => {

  test('R4 — two contexts both observe each other\'s echo output on the same session', async ({ browser }) => {
    // Open two parallel browser contexts — analogous to a desktop browser
    // tab and a phone browser tab attached at the same time.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await installWsRecorder(pageA);
    await installWsRecorder(pageB);
    await pageA.goto('/');
    await pageB.goto('/');
    await waitForAppReady(pageA);
    await waitForAppReady(pageB);

    // Context A creates the session. The created broadcast goes to BOTH
    // clients via sessions.broadcast, so B sees the row appear too.
    const sessionId = await spawnSession(pageA);
    await expect(pageB.locator(`.group[data-id="${sessionId}"]`)).toBeVisible({ timeout: 5_000 });

    // Both contexts click into the session so the term mounts on each.
    await pageA.locator(`.group[data-id="${sessionId}"]`).click();
    await pageB.locator(`.group[data-id="${sessionId}"]`).click();

    // Inject input via the live WebSocket — bypasses any xterm focus race
    // (only one context can hold native focus at a time but both can drive
    // input over the wire). Send sentinel strings the test can grep for in
    // the output stream.
    await pageA.evaluate(({ id }) => {
      /** @type {any} */ const w = window;
      w.__ws.send(JSON.stringify({ type: 'input', id, data: 'echo A\r' }));
    }, { id: sessionId });
    await pageB.evaluate(({ id }) => {
      /** @type {any} */ const w = window;
      w.__ws.send(JSON.stringify({ type: 'input', id, data: 'echo B\r' }));
    }, { id: sessionId });

    // Each context should observe both 'A' and 'B' in its output stream
    // within the polling window. Use \bA\b / \bB\b to avoid false-positives
    // on e.g. the literal 'echo A' command echo.
    for (const p of [pageA, pageB]) {
      await expect.poll(async () => p.evaluate(() => {
        /** @type {any} */ const w = window;
        const outs = w.__rxMessages.filter(m => m.type === 'output').map(m => m.data || '').join('');
        return { hasA: /\bA\b/.test(outs), hasB: /\bB\b/.test(outs) };
      }), { timeout: 5_000, intervals: [100, 250, 500, 1_000] }).toEqual({ hasA: true, hasB: true });
    }

    await ctxA.close();
    await ctxB.close();
  });

  test('R5 — indicator on Tab A appears when Tab B connects, disappears when Tab B closes', async ({ browser }) => {
    // Tab A boots alone. The server's broadcast on its connect counts
    // exactly 1 client — indicator stays hidden.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await installWsRecorder(pageA);
    await pageA.goto('/');
    await waitForAppReady(pageA);
    const sessionId = await spawnSession(pageA);

    // The indicator is rendered on the row by the addTerminal template
    // with the default `.hidden` class (UI-SPEC DOM contract). Before B
    // connects, it stays hidden on A's view.
    await expect(
      pageA.locator(`.group[data-id="${sessionId}"] .other-client-indicator`)
    ).toHaveClass(/\bhidden\b/);

    // Tab B connects. The server-side connect handler broadcasts
    // `{type:'clients.count', count: 2}`. Within the broadcast latency
    // (effectively instant on localhost) Tab A's WS handler clears
    // .hidden on every .other-client-indicator span — the indicator
    // appears within the SPEC R5 5-second budget.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await installWsRecorder(pageB);
    await pageB.goto('/');
    await waitForAppReady(pageB);

    await expect(
      pageA.locator(`.group[data-id="${sessionId}"] .other-client-indicator`)
    ).not.toHaveClass(/\bhidden\b/, { timeout: 5_000 });

    // Tab B closes. The server's ws.on('close') broadcasts the new count.
    // The indicator returns to hidden on Tab A within the SPEC R5
    // 10-second budget.
    await ctxB.close();
    await expect(
      pageA.locator(`.group[data-id="${sessionId}"] .other-client-indicator`)
    ).toHaveClass(/\bhidden\b/, { timeout: 10_000 });

    await ctxA.close();
  });
});
