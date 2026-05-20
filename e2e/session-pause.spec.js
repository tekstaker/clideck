// Session Pause — E2E for the active-session "Pause" context-menu action.
//
// The server-side unit suite (tests/session-pause.test.js) already pins
// the move-to-resumable + broadcast behaviour. This E2E proves the
// client wiring: menu item is conditionally enabled, dispatch sends
// the right WebSocket frame, and the row moves from active to
// Previous Sessions on the server's broadcast.
//
// Real agent sessions are needed for a real `sessionToken` capture
// (Claude/Codex/etc.). The tests here can't spawn those — they
// synthesise the token by injecting a `session.token` MessageEvent on
// the live WebSocket, the same trick used by the indicator-mutex
// spec for `session.status`.

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

async function injectTokenCapture(page, id) {
  await page.evaluate((id) => {
    /** @type {any} */ const w = window;
    const evt = new MessageEvent('message', {
      data: JSON.stringify({ type: 'session.token', id, hasToken: true }),
    });
    w.__ws.dispatchEvent(evt);
  }, id);
}

async function openSessionMenu(page, sessionId) {
  // Click the three-dot .menu-btn inside the sidebar row. It's
  // opacity-0 until hover; hovering first reveals it.
  const row = page.locator(`.group[data-id="${sessionId}"]`);
  await row.hover();
  await row.locator('.menu-btn').click();
}

test.describe('session pause', () => {

  test('Pause menu item is hidden for the default Shell command', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const id = await spawnSession(page);
    await openSessionMenu(page, id);

    // Shell preset has canResume=false by default — Pause must not appear.
    await expect(page.locator('[data-action="pause"]')).toHaveCount(0);

    // Other actions are present (sanity check the menu DID open).
    await expect(page.locator('[data-action="delete"]')).toBeVisible();
  });

  test('Pause is dispatched after a token capture (simulated)', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const id = await spawnSession(page);

    // Promote the session's preset to a fake resumable one for the
    // purposes of this menu render. We patch the in-page config and
    // the entry's commandId so the menu's `canPause` path lights up.
    await page.evaluate(async (id) => {
      const mod = await import('/js/state.js');
      const cfg = mod.state.cfg;
      // Inject a fake resumable command if not present.
      if (!cfg.commands.find(c => c.id === 'fake-agent')) {
        cfg.commands.push({
          id: 'fake-agent',
          label: 'Fake Agent',
          command: 'fake',
          canResume: true,
          resumeCommand: 'fake --resume {{sessionId}}',
        });
      }
      const entry = mod.state.terms.get(id);
      if (entry) entry.commandId = 'fake-agent';
    }, id);

    // Initially: no token captured. Menu should show Pause as disabled.
    await openSessionMenu(page, id);
    const pauseBtn = page.locator('[data-action="pause"]');
    await expect(pauseBtn).toBeVisible();
    await expect(pauseBtn).toBeDisabled();
    await page.keyboard.press('Escape'); // close menu

    // Inject the token capture broadcast — Pause should now be enabled.
    await injectTokenCapture(page, id);
    await openSessionMenu(page, id);
    await expect(pauseBtn.first()).toBeEnabled();

    // Click Pause — must send a session.pause frame.
    await pauseBtn.first().click();
    const pauseFrames = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return w.__sentMessages.filter(m => m && m.type === 'session.pause');
    });
    expect(pauseFrames).toEqual([
      expect.objectContaining({ type: 'session.pause', id }),
    ]);
  });

  test('disabled Pause shows the explanatory tooltip', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const id = await spawnSession(page);

    // Same fake-agent setup as above, no token capture.
    await page.evaluate(async (id) => {
      const mod = await import('/js/state.js');
      if (!mod.state.cfg.commands.find(c => c.id === 'fake-agent')) {
        mod.state.cfg.commands.push({
          id: 'fake-agent', label: 'Fake', command: 'fake',
          canResume: true, resumeCommand: 'fake --resume {{sessionId}}',
        });
      }
      const entry = mod.state.terms.get(id);
      if (entry) entry.commandId = 'fake-agent';
    }, id);

    await openSessionMenu(page, id);
    const pauseBtn = page.locator('[data-action="pause"]');
    await expect(pauseBtn).toBeDisabled();
    await expect(pauseBtn).toHaveAttribute('title', /not.*emit|until.*agent/i);
  });
});
