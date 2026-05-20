// Unread-dot / working-indicator mutex — E2E regression net.
//
// Before the 2026-05-19 session-polish phase, the sidebar unread dot
// fired on every output chunk regardless of whether the session was
// "working" (bouncing dot + green pill-status on the left). The result
// was a row that simultaneously said "I'm busy" AND "I'm waiting for
// your attention" — visually contradictory.
//
// The fix relocated the primary `markUnread` trigger from the WebSocket
// `output` handler to the working→idle transition inside `setStatus`,
// gated by `id !== state.active`. A fallback `markUnread` remains in
// the output handler but is now gated by `entry.working === false` so
// passive (non-agent) sessions like a `tail -f` Shell still surface
// unread activity.
//
// This spec drives the client-side state machine by:
//   1. Spawning a real Shell session via the same WebSocket the app uses.
//   2. Switching focus to OTHER session(s) so the original is no longer
//      `state.active` — markUnread's `id === state.active` guard
//      otherwise short-circuits and we'd be testing the wrong path.
//   3. Synthesising `session.status` MessageEvents on the WebSocket to
//      drive working/idle transitions deterministically (no real agent
//      needed — telemetry-bridge would normally send these, but the
//      client doesn't care where the frame came from).
//   4. Asserting on the `.unread-dot.hidden` class state at each phase.

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

async function spawnSession(page) {
  await page.evaluate(() => {
    /** @type {any} */ const w = window;
    w.__ws.send(JSON.stringify({ type: 'create', cols: 80, rows: 24 }));
  });
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

// Drive the client's onmessage handler by dispatching a synthetic
// MessageEvent on the live WebSocket. This is the same path real
// server frames take into the client.
async function dispatchSessionStatus(page, id, working) {
  await page.evaluate(({ id, working }) => {
    /** @type {any} */ const w = window;
    const evt = new MessageEvent('message', {
      data: JSON.stringify({ type: 'session.status', id, working }),
    });
    w.__ws.dispatchEvent(evt);
  }, { id, working });
}

async function dispatchOutput(page, id, data) {
  await page.evaluate(({ id, data }) => {
    /** @type {any} */ const w = window;
    const evt = new MessageEvent('message', {
      data: JSON.stringify({ type: 'output', id, data }),
    });
    w.__ws.dispatchEvent(evt);
  }, { id, data });
}

async function isDotHidden(page, id) {
  return page.evaluate((id) => {
    const dot = document.querySelector(`.group[data-id="${id}"] .unread-dot`);
    return !dot || dot.classList.contains('hidden');
  }, id);
}

test.describe('session indicator mutex', () => {

  test('working session does NOT show unread dot while busy', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const a = await spawnSession(page);
    const b = await spawnSession(page);
    // Make B the active session so A's dot tests aren't short-circuited
    // by the `id === state.active` guard in markUnread.
    await page.locator(`.group[data-id="${b}"]`).click();

    // A enters working state, then receives output.
    await dispatchSessionStatus(page, a, true);
    await dispatchOutput(page, a, 'building...\r\n');

    // No unread dot while A is working — even with output flowing.
    expect(await isDotHidden(page, a)).toBe(true);
  });

  test('working → idle transition surfaces the unread dot', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const a = await spawnSession(page);
    const b = await spawnSession(page);
    await page.locator(`.group[data-id="${b}"]`).click();

    await dispatchSessionStatus(page, a, true);
    await dispatchOutput(page, a, 'working...\r\n');
    expect(await isDotHidden(page, a)).toBe(true);

    // Transition A back to idle — dot should appear because A isn't active.
    await dispatchSessionStatus(page, a, false);
    expect(await isDotHidden(page, a)).toBe(false);
  });

  test('active session never gets an unread dot', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const a = await spawnSession(page);
    // A is active by default (most recent create selects).

    await dispatchSessionStatus(page, a, true);
    await dispatchOutput(page, a, 'busy output\r\n');
    await dispatchSessionStatus(page, a, false);

    // Active throughout — dot must stay hidden regardless of transitions.
    expect(await isDotHidden(page, a)).toBe(true);
  });

  test('passive output (no working state) still surfaces unread', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const a = await spawnSession(page);
    const b = await spawnSession(page);
    await page.locator(`.group[data-id="${b}"]`).click();

    // A never enters working state — simulates a passive shell (tail -f
    // style). The fallback path in the output handler must still fire.
    await dispatchOutput(page, a, 'tail line\r\n');
    expect(await isDotHidden(page, a)).toBe(false);
  });

  test('selecting an unread session clears its dot', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const a = await spawnSession(page);
    const b = await spawnSession(page);
    await page.locator(`.group[data-id="${b}"]`).click();

    await dispatchOutput(page, a, 'tail line\r\n');
    expect(await isDotHidden(page, a)).toBe(false);

    // Select A — its dot must clear (select() owns that state transition).
    await page.locator(`.group[data-id="${a}"]`).click();
    expect(await isDotHidden(page, a)).toBe(true);
  });

  test('idle→working hides any stale dot from a prior cycle', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const a = await spawnSession(page);
    const b = await spawnSession(page);
    await page.locator(`.group[data-id="${b}"]`).click();

    // Set dot via passive output first.
    await dispatchOutput(page, a, 'tail line\r\n');
    expect(await isDotHidden(page, a)).toBe(false);

    // A starts working — the prior dot should hide. Contract is "dot
    // means an idle session has output you haven't seen"; a working
    // session is not idle, so the dot's meaning no longer applies.
    await dispatchSessionStatus(page, a, true);
    expect(await isDotHidden(page, a)).toBe(true);
  });
});
