// Paste-blob upload — E2E for the binary-paste server endpoint.
//
// We can't drive `navigator.clipboard.read()` reliably with a binary
// item across browsers, so the E2E exercises the same path the
// client uses: POST /sessions/:id/paste-blob with the binary body
// and the right Content-Type header.
//
// Asserts:
//   - 200 + JSON response with relative .clideck/paste/<name> path.
//   - Confirmation `output` frame lands in the client's WebSocket
//     stream (so the agent's scrollback sees the path).
//   - 404 for an unknown session id.
//   - 400 for a path-traversal X-Filename header.

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
  return sessionId;
}

// 1x1 transparent PNG — the smallest valid PNG you can construct.
// 67 bytes total. Used as our known payload across the upload tests.
const TINY_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

test.describe('paste-blob upload endpoint', () => {

  test('POST /sessions/:id/paste-blob writes the blob and injects the path into the PTY', async ({ page, baseURL }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const sessionId = await spawnSession(page);
    // Snapshot the rxMessages length before the upload so we only look
    // at frames that arrive AFTER our POST.
    const beforeCount = await page.evaluate(() => /** @type {any} */ (window).__rxMessages.length);

    const upload = await page.request.post(`${baseURL}/sessions/${sessionId}/paste-blob`, {
      headers: { 'content-type': 'image/png' },
      data: TINY_PNG_BYTES,
    });
    expect(upload.status()).toBe(200);
    const json = await upload.json();
    expect(json.ok).toBe(true);
    expect(json.mime).toBe('image/png');
    expect(json.sizeBytes).toBe(TINY_PNG_BYTES.length);
    expect(json.path).toMatch(/^\.clideck\/paste\/.+\.png$/);
    expect(json.filename).toMatch(/\.png$/);

    // The server writes the relative path to the PTY's stdin so the
    // running agent actually sees it (not just xterm's display buffer).
    // The shell echoes typed characters back as `output` frames; we
    // assert at least one of those carries the path substring.
    const filename = json.filename;
    await expect.poll(() => page.evaluate(({ beforeCount, sessionId, filename }) => {
      /** @type {any} */ const w = window;
      return w.__rxMessages.slice(beforeCount).filter(
        m => m.type === 'output' && m.id === sessionId && m.data.includes(filename)
      ).length;
    }, { beforeCount, sessionId, filename }), { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test('unknown session id returns 404', async ({ page, baseURL }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const upload = await page.request.post(`${baseURL}/sessions/this-id-does-not-exist/paste-blob`, {
      headers: { 'content-type': 'image/png' },
      data: TINY_PNG_BYTES,
    });
    expect(upload.status()).toBe(404);
  });

  test('X-Filename with path traversal is sanitised to a safe basename', async ({ page, baseURL }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const sessionId = await spawnSession(page);

    const upload = await page.request.post(`${baseURL}/sessions/${sessionId}/paste-blob`, {
      headers: {
        'content-type': 'image/png',
        'x-filename': '../../../etc/passwd',
      },
      data: TINY_PNG_BYTES,
    });
    // sanitizeFilename strips the path prefix down to "passwd", which
    // is a valid (if oddly-named) filename inside the inbox — so this
    // succeeds, but the saved filename is bare "passwd" rather than
    // escaping the inbox dir. That's the SPEC contract.
    expect(upload.status()).toBe(200);
    const json = await upload.json();
    expect(json.filename).toBe('passwd');
    expect(json.path).toBe('.clideck/paste/passwd');
  });

  test('empty X-Filename falls back to a synthesised timestamped name', async ({ page, baseURL }) => {
    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    const sessionId = await spawnSession(page);

    const upload = await page.request.post(`${baseURL}/sessions/${sessionId}/paste-blob`, {
      headers: { 'content-type': 'image/jpeg' },
      data: TINY_PNG_BYTES, // bytes don't have to match the declared mime
    });
    expect(upload.status()).toBe(200);
    const json = await upload.json();
    // Synthesised: <iso-timestamp>-<short>.jpg
    expect(json.filename).toMatch(/[0-9]{4}-?[0-9]{2}-?[0-9]{2}.*\.jpg$/);
  });
});
