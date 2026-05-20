// Drag-to-reorder sessions within a group — E2E regression net.
//
// Spawns three sessions (ungrouped — no project), drags the third one
// to the first position, asserts the sidebar DOM order changed, checks
// that the client emitted a `session.reorder` frame with the new
// sequence, and confirms the order survives a page reload (server is
// the source of truth — Map iteration order is preserved by the
// existing save path).

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
  const sessionId = await page.evaluate(async () => {
    /** @type {any} */ const w = window;
    const seen = new Set(w.__rxMessages.filter((m) => m.type === 'created').map((m) => m.id));
    w.__ws.send(JSON.stringify({ type: 'create', cols: 80, rows: 24 }));
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const next = w.__rxMessages.find((m) => m.type === 'created' && !seen.has(m.id));
      if (next) return next.id;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });
  expect(sessionId).toBeTruthy();
  await expect(page.locator(`.group[data-id="${sessionId}"]`)).toBeVisible({ timeout: 5_000 });
  return sessionId;
}

async function sidebarSessionIds(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#session-list .group[data-id]')].map(el => el.dataset.id)
  );
}

async function dragSessionToPosition(page, srcId, dstId) {
  const src = page.locator(`.group[data-id="${srcId}"]`);
  const dst = page.locator(`.group[data-id="${dstId}"]`);
  const sBox = await src.boundingBox();
  const dBox = await dst.boundingBox();
  if (!sBox || !dBox) throw new Error('boundingBox unavailable');

  // Start the pointer on the src row, move several times to clear the
  // 5px drag threshold, then over the top half of dst (= drop above dst).
  await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
  await page.mouse.down();
  // Two intermediate moves so the dragState transitions past the
  // threshold before we approach the target.
  await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2 + 12, { steps: 4 });
  await page.mouse.move(dBox.x + dBox.width / 2, dBox.y + 4, { steps: 8 });
  await page.mouse.up();
}

test.describe.configure({ mode: 'serial' });

// Playwright reuses the dev server across specs; sessions from prior
// tests would otherwise leak into our assertions on global sidebar
// order. Close every visible session before each test.
async function clearAllSessions(page) {
  await page.evaluate(async () => {
    /** @type {any} */ const w = window;
    const ids = [...document.querySelectorAll('#session-list .group[data-id]')].map(el => el.dataset.id);
    for (const id of ids) {
      w.__ws.send(JSON.stringify({ type: 'close', id }));
    }
    // Wait for the server to drain — `sessions.resumable` and `closed`
    // broadcasts land, the rows leave the DOM.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const remaining = document.querySelectorAll('#session-list .group[data-id]').length;
      if (remaining === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  // Also clear any persisted resumables — close on a resumable id removes it.
  await page.evaluate(async () => {
    /** @type {any} */ const w = window;
    const resumableMsg = [...w.__rxMessages].reverse().find(m => m.type === 'sessions.resumable');
    if (!resumableMsg?.list) return;
    for (const r of resumableMsg.list) {
      w.__ws.send(JSON.stringify({ type: 'close', id: r.id }));
    }
    await new Promise((r) => setTimeout(r, 200));
  });
}

test.describe('session drag-to-reorder', () => {

  test.beforeEach(async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);
    await clearAllSessions(page);
  });

  test('dragging a session above another reorders the sidebar', async ({ page }) => {
    const a = await spawnSession(page);
    const b = await spawnSession(page);
    const c = await spawnSession(page);

    expect(await sidebarSessionIds(page)).toEqual([a, b, c]);

    await dragSessionToPosition(page, c, a);

    // C should now sit above A. B unchanged.
    await expect.poll(() => sidebarSessionIds(page))
      .toEqual([c, a, b]);

    // Client emitted a session.reorder frame with the new full sequence.
    const reorderFrames = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return w.__sentMessages.filter(m => m && m.type === 'session.reorder');
    });
    expect(reorderFrames.length).toBeGreaterThan(0);
    expect(reorderFrames[reorderFrames.length - 1].ids).toEqual([c, a, b]);
  });

  test('order survives a page reload (server-persisted)', async ({ page }) => {
    const a = await spawnSession(page);
    const b = await spawnSession(page);
    const c = await spawnSession(page);

    await dragSessionToPosition(page, c, a);
    await expect.poll(() => sidebarSessionIds(page))
      .toEqual([c, a, b]);

    // Reload — the server holds the canonical order in its sessions Map,
    // and the initial `sessions` broadcast on reconnect uses Map iteration
    // order, so the new sequence should re-render unchanged.
    await page.reload();
    await waitForAppReady(page);

    await expect.poll(() => sidebarSessionIds(page))
      .toEqual([c, a, b]);
  });

  test('dropping in the same slot is a no-op', async ({ page }) => {
    const a = await spawnSession(page);
    const b = await spawnSession(page);

    // Drag A onto itself — should not produce a reorder frame.
    await dragSessionToPosition(page, a, a);

    // Order unchanged.
    expect(await sidebarSessionIds(page)).toEqual([a, b]);

    const reorderFrames = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return w.__sentMessages.filter(m => m && m.type === 'session.reorder');
    });
    expect(reorderFrames.length).toBe(0);
  });
});
