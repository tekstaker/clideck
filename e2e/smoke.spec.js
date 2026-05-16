// Smoke tests — broadest possible regression net for the app shell.
//
// These don't exercise terminals or PTYs. They prove the page boots, the
// chrome renders, the websocket connects, and the basic UI hooks wire up.
// If any of these fail, something foundational broke and every other test
// in the suite is irrelevant.
//
// Readiness model: clideck's frontend modules are ES modules and don't
// attach state to window. To know "the app is ready", we hook
// WebSocket.prototype.message-events via addInitScript and watch for the
// initial `presets` broadcast — once that lands, state.presets is
// populated and the creator can open.

const { test, expect } = require('@playwright/test');

async function installWsRecorder(page) {
  await page.addInitScript(() => {
    /** @type {any} */ const w = window;
    w.__rxTypes = new Set();
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
        try { w.__rxTypes.add(JSON.parse(ev.data).type); } catch {}
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
  // The initial broadcasts the server sends to a new connection are
  // `config`, `sessions`, `presets`, `themes`. `presets` is the one the
  // creator needs to populate its preset list.
  await expect.poll(
    async () => page.evaluate(() => Array.from(/** @type {any} */ (window).__rxTypes || [])),
    { timeout: 10_000, intervals: [100, 200, 500] }
  ).toEqual(expect.arrayContaining(['config', 'sessions', 'presets']));
}

test.describe('smoke — app shell', () => {
  test('app loads and renders chrome with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await installWsRecorder(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/CliDeck/);

    await expect(page.locator('#nav-rail')).toBeVisible();
    await expect(page.locator('#session-list')).toBeVisible();
    await expect(page.locator('#btn-new')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();

    await waitForAppReady(page);

    expect(errors).toEqual([]);
  });

  test('clicking + opens the session creator with at least one preset', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    await page.locator('#btn-new').click();
    await expect(page.locator('#session-creator')).toBeVisible();

    // The Shell preset is hard-coded in agent-presets.json and always
    // present regardless of which AI agents are installed locally.
    await expect(
      page.locator('#session-creator .preset-btn').first()
    ).toBeVisible();
  });

  test('search input is interactive', async ({ page }) => {
    await page.goto('/');
    const search = page.locator('#search-input');
    await search.fill('hello world');
    await expect(search).toHaveValue('hello world');
    await search.fill('');
    await expect(search).toHaveValue('');
  });

  test('websocket reaches the server (initial broadcasts arrive)', async ({ page }) => {
    await installWsRecorder(page);
    await page.goto('/');

    await expect.poll(
      async () => page.evaluate(() => Array.from(/** @type {any} */ (window).__rxTypes || [])),
      { timeout: 5_000 }
    ).toEqual(expect.arrayContaining(['config', 'sessions', 'presets']));
  });
});
