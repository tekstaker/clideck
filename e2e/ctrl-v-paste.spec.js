// Ctrl+V paste — full-stack E2E.
//
// The Vitest suite in tests/hotkeys-paste.test.js exercises the dispatcher
// against a happy-dom KeyboardEvent on the document. That proves the
// registry wiring. It does NOT prove:
//
//   - That xterm.js's attachCustomKeyEventHandler path correctly routes a
//     real Chromium keydown through dispatch() once the terminal has
//     focus (xterm puts a hidden textarea between the user and the
//     dispatcher, and the unit test bypasses it).
//   - That the resulting state.ws.send actually reaches the WebSocket.
//   - That a real navigator.clipboard.readText, with real permissions,
//     returns the text we just wrote.
//
// This test fills those gaps. It hooks WebSocket.prototype.send via an
// addInitScript that runs before any page module loads, drives a create
// message to spawn a real Shell session, focuses the rendered xterm
// instance, writes a known string to the OS clipboard via
// navigator.clipboard.writeText, presses Ctrl+V, and asserts the input
// frame the server receives matches the clipboard text byte-for-byte.

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
        try { w.__sentMessages.push(JSON.parse(data)); }
        catch { w.__sentMessages.push(String(data)); }
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

test.describe('Ctrl+V paste — full stack', () => {
  test('Ctrl+V in a focused terminal sends clipboard text over the WebSocket', async ({ page, context }) => {
    // Belt and braces — Playwright config already grants these, but
    // clipboard permissions in headless Chromium have been known to drop
    // when the origin changes, so we re-grant against the live origin.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:4099',
    });

    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    // Spawn a real Shell session via the same WebSocket the app uses.
    // commandId omitted on purpose: sessions.create() falls back to
    // cfg.commands[0] (the default Shell) when the id doesn't match.
    await page.evaluate(() => {
      /** @type {any} */ const w = window;
      w.__ws.send(JSON.stringify({ type: 'create', cols: 80, rows: 24 }));
    });

    // Wait for the server to confirm the spawn.
    const sessionId = await page.evaluate(async () => {
      /** @type {any} */ const w = window;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const created = w.__rxMessages.find((m) => m.type === 'created');
        if (created) return created.id;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    });
    expect(sessionId, 'server should have broadcast a created message').toBeTruthy();

    // Wait for xterm to render. The terminals.js attachToTerminal path
    // runs on receipt of 'created', which constructs an xterm Terminal
    // and calls term.open() — that injects .xterm into the DOM.
    const xterm = page.locator('.xterm').first();
    await expect(xterm).toBeVisible({ timeout: 5_000 });

    const PASTE_TEXT = 'echo hello from E2E';

    // Write to the OS clipboard. With clipboard-write granted to the
    // context this resolves immediately; without the grant Chromium
    // would block until a user gesture.
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, PASTE_TEXT);

    // Focus the terminal so the keydown lands on xterm's hidden
    // helper-textarea — which is exactly the route the unit tests
    // could not exercise.
    await xterm.click();
    await page.keyboard.press('Control+V');

    // The wire-level assertion: state.ws.send was called with an input
    // frame whose data is precisely what we put on the clipboard.
    await expect.poll(
      async () => page.evaluate((id) => {
        /** @type {any} */ const w = window;
        return w.__sentMessages.filter(
          (m) => m && m.type === 'input' && m.id === id
        );
      }, sessionId),
      { timeout: 5_000, intervals: [50, 100, 250] }
    ).toEqual([
      { type: 'input', id: sessionId, data: PASTE_TEXT },
    ]);
  });

});
