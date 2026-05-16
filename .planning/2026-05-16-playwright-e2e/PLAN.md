# PLAN — Playwright E2E test framework

## Step 1 — Install Playwright + config

- `npm install --save-dev @playwright/test`.
- `npx playwright install chromium` — downloads Chromium binary into the
  Playwright cache (`%USERPROFILE%\AppData\Local\ms-playwright\` on
  Windows). One-time per machine.
- Create `playwright.config.js` with:
  - `testDir: './e2e'`
  - `workers: 1`, `fullyParallel: false` (single dev server)
  - `webServer.command: 'node server.js'`
  - `webServer.env`: `CLIDECK_PORT=4099`, `USERPROFILE=<tmp>`, `HOME=<tmp>`
  - `use.baseURL: 'http://localhost:4099'`
  - `use.permissions: ['clipboard-read', 'clipboard-write']`
  - `projects`: single Chromium project
- Add scripts to `package.json`:
  - `"test:e2e": "playwright test"`
  - `"test:e2e:ui": "playwright test --ui"`
- Extend `.gitignore` to exclude `test-results/`, `playwright-report/`,
  `e2e/.auth/`.
- **Commit:** "Add Playwright E2E test framework"

## Step 2 — Smoke tests

`e2e/smoke.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('app loads and renders shell UI', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/CliDeck/);
    await expect(page.locator('#nav-rail')).toBeVisible();
    await expect(page.locator('#session-list')).toBeVisible();
    await expect(page.locator('#btn-new')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();

    // Allow async config/sessions broadcasts to settle.
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });

  test('clicking + opens the session creator', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-new').click();
    await expect(page.locator('#session-creator')).toBeVisible();
  });

  test('search input accepts text', async ({ page }) => {
    await page.goto('/');
    const search = page.locator('#search-input');
    await search.fill('hello');
    await expect(search).toHaveValue('hello');
  });
});
```

- **Commit:** "Add smoke tests for app shell and basic UI"

## Step 3 — Ctrl+V paste E2E

`e2e/ctrl-v-paste.spec.js`:

Strategy:

1. `page.addInitScript` to hook `WebSocket.prototype.send` so every
   outgoing payload is pushed to `window.__sentMessages`. This is the
   assertion surface — we don't need to inspect xterm's render buffer.
2. `page.goto('/')`. Wait for the app to open its WebSocket. Detectable
   via `page.evaluate(() => window.__sentMessages.length > 0)`.
3. Drive a `create` message via the page's existing WS to make a Shell
   session, using the default command with `commandId: '1'`.
4. Wait for `.xterm` element to render.
5. Write to clipboard via Playwright's clipboard API
   (`page.evaluate(() => navigator.clipboard.writeText('echo hello from
   E2E'))` — works because the test grants clipboard-read/write
   permission).
6. Focus the terminal (click `.xterm`).
7. `page.keyboard.press('Control+V')`.
8. Poll `window.__sentMessages` until an `{ type: 'input', data: 'echo
   hello from E2E' }` appears. Assert.

- **Commit:** "Add Ctrl+V paste E2E test through the full stack"

## Step 4 — Verify locally

- `npm run test:e2e` — confirm passing.
- Confirm no writes to `~/.clideck/` by snapshotting before and after
  (or running with a non-default `USERPROFILE`).
- **Commit (if anything tweaked):** "Stabilize E2E suite for local
  runs" — *may not be needed if step 3 lands clean*.

## Risks

- **Clipboard permission** in headless Chromium can be flaky. Playwright
  grants `clipboard-read` and `clipboard-write` via `context.permissions`,
  but the page must have an "interaction" for the grant to apply in some
  cases. We click into the page before any clipboard call.
- **Slow PTY spawn** on Windows when antivirus is paranoid. The Ctrl+V
  test doesn't need PTY echo (it asserts on the wire-side input), so a
  slow PTY shouldn't affect it.
- **Helper-textarea focus** — xterm renders an offscreen `<textarea>` for
  IME and key capture. Clicking `.xterm` should bubble focus to that
  textarea. If not, fall back to focusing
  `.xterm-helper-textarea` directly.
- **WebSocket hook timing** — `page.addInitScript` runs *before* any
  page script, including the inline scripts in `index.html`. So the WS
  constructor sees our patched `prototype.send` and all sends are
  captured.

## Manual verification

After `npm run test:e2e` passes:

1. Run with `--ui` mode to step through the Ctrl+V spec visually.
2. Confirm that during the test run, no `~/.clideck/` writes occur on
   the user's actual home (it should write only to the temp dir).
