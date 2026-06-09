// Phase 15 R1 — clideck-remote surgical-removal verification.
//
// SPEC R1: "Retire the mobile-remote modal. #remote-modal flow is removed
// entirely; the full UI becomes the only surface." Per CONTEXT D-01/D-02/D-03
// every reference to clideck-remote / #remote-modal / #btn-remote /
// #version-remote and the remote.* WS message types must be gone outside
// CHANGELOG.md and .planning/ history.
//
// This spec is the E2E gate. It runs against a real bootstrapped server +
// browser and proves three things at once:
//   1. The deleted DOM elements (#btn-remote, #remote-modal, #version-remote)
//      are absent from the rendered page.
//   2. No console.error / pageerror fires during page load (i.e. no stale
//      code still references the deleted globals / WS message types).
//   3. The repo-wide grep for the locked strings (per CONTEXT D-03) returns
//      zero matches outside the allowed exemptions (.planning/, CHANGELOG.md,
//      this spec file itself, docker artifacts that happen to mention the
//      old package name, and node_modules/.git).
//
// This spec is authored RED per CLAUDE.md §2 (TDD-first). It will FAIL today
// because public/index.html still carries `<button id="btn-remote">`,
// `<div id="remote-modal">`, `<span id="version-remote">`, and the same
// strings live in handlers.js + public/js/app.js. Plan 15-04 deletes them
// and this spec turns green.
//
// Analog: e2e/smoke.spec.js (same installWsRecorder + waitForAppReady +
// pageerror/console.error listener pattern). Helpers inlined per
// 15-PATTERNS.md Shared 7 — no shared e2e/helpers.js exists in this repo.
//
// Phase 16 interaction note (Wave 3 verification concern): origin/main now
// requires a clideck-device-token Sec-WebSocket-Protocol header to upgrade
// the WS unless the server is in bootstrap mode (empty devices.json). The
// playwright.config.js webServer launches with TEST_HOME pointing at a
// fresh tempdir, which means devices.json starts empty → bootstrap mode →
// upgrade succeeds for an unauthenticated browser. If a future config change
// breaks that assumption, Wave 3 surfaces it as a Phase 16 interaction gap.

const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');

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

test.describe('Phase 15 R1 — clideck-remote surgical removal', () => {

  test('deleted remote DOM elements are absent + no console errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await installWsRecorder(page);
    await page.goto('/');
    await waitForAppReady(page);

    // The three DOM elements that Plan 15-04 deletes outright.
    await expect(page.locator('#btn-remote')).toHaveCount(0);
    await expect(page.locator('#remote-modal')).toHaveCount(0);
    await expect(page.locator('#version-remote')).toHaveCount(0);

    // No stale references in JS — any case 'remote.*' arm or remoteCliEnv()
    // caller still on the page would surface as a TypeError on a `remote.*`
    // broadcast or on the missing-element handler.
    expect(errors).toEqual([]);
  });

  test('repo grep — no clideck-remote refs outside CHANGELOG / .planning / this spec', async () => {
    // Per CONTEXT D-03: the locked verification grep is
    //   git grep -nE "remote-modal|clideck-remote|btn-remote|version-remote|remote\.(update|error|installing|status|pair|unpair)"
    // returning zero matches outside the exemption list.
    //
    // Exemptions (in priority order):
    //   - CHANGELOG.md / CHANGELOG-*.md — historical release notes
    //   - .planning/ — all planning + summary docs (Phases 3, 11, 12, etc.
    //     all reference the old package name in their narrative)
    //   - This spec file itself — the strings appear in our assertions
    //   - docs/, README.md — top-level project docs may name the deleted
    //     surface in migration notes
    //   - lib/install-clideck-remote* — the orphaned legacy installer,
    //     which Plan 15-04 deletes if it exists (verify status at exec time)
    //   - docker-compose*, Dockerfile*, .docker/ — docker artifacts may
    //     mention the package name as a comment; out of scope for this
    //     phase per CONTEXT.md ("clideck-docker-lance is a separate project")
    //   - node_modules/, .git/ — never grep these
    const pattern = String.raw`remote-modal|clideck-remote|btn-remote|version-remote|remote\.(update|error|installing|status|pair|unpair)`;
    let output = '';
    try {
      output = execSync(
        `git grep -nE "${pattern}" -- . ` +
          `':!CHANGELOG.md' ':!CHANGELOG-*.md' ` +
          `':!.planning/' ` +
          `':!e2e/clideck-remote-deletion.spec.js' ` +
          `':!docs/' ':!README.md' ` +
          `':!lib/install-clideck-remote*' ` +
          `':!docker-compose*' ':!Dockerfile*' ':!.docker/'`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      // git grep exits 1 when there are no matches — the GREEN path.
      if (err.status === 1) {
        output = '';
      } else {
        throw err;
      }
    }
    expect(output, `clideck-remote refs still in repo:\n${output}`).toBe('');
  });
});
