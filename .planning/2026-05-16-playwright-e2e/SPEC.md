# SPEC — Playwright E2E test framework for clideck

**Status:** in progress
**Owner:** Lance Keay
**Date:** 2026-05-16
**Follows:** [2026-05-16-ctrl-v-paste](../2026-05-16-ctrl-v-paste/SPEC.md)

## What this delivers

Browser-driven end-to-end test coverage for clideck. Two suites land in this
phase:

1. **Smoke tests** — boot the real `node server.js`, navigate a real
   Chromium to `http://localhost:<port>/`, verify the page loads, key DOM
   elements render, no console errors are thrown, and the basic UI
   interactions (open creator, settings nav, search) wire up.
2. **Ctrl+V paste E2E** — the headline test for the prior phase. Creates a
   real Shell session through the real WebSocket, writes text to the OS
   clipboard, sends a real Ctrl+V keydown, and asserts the input payload
   reached the PTY layer via the live WebSocket.

The Vitest unit suite from the previous phase already proves the dispatcher
contract. This E2E suite proves the *full stack* — including xterm.js's
focus path, real Chromium clipboard API, real WebSocket round-trip, real
node-pty — which the unit test could not.

## Why

- The Ctrl+V fix shipped with one acknowledged gap in the unit-test
  coverage: it goes through the document-level dispatcher seam, not the
  xterm-focus seam (`attachCustomKeyEventHandler` → `dispatch`). A real
  browser closes that gap.
- clideck is a web app per global `CLAUDE.md` rule 1 (verify before
  claiming done): "use Playwright or Puppeteer (MCP is configured) to load
  the page and actually look at it the way Lance would". Standing the
  framework up means future fixes can do that automatically.
- A smoke suite gives a regression net for the broad app shell — if a
  future change breaks the page from loading at all, a CI gate would catch
  it before it ever gets to a human.

## Scope

**In scope**

- Add `@playwright/test` as a dev dependency.
- Install the Chromium browser binary used by Playwright (the user runs
  this; it's a ~300 MB download we don't commit).
- `playwright.config.js` at repo root: single Chromium project, single
  worker (one shared dev server), `webServer` block that boots `node
  server.js` on a non-default port with an isolated `USERPROFILE` /
  `HOME` so the user's real `~/.clideck/` is never touched.
- `e2e/` directory housing the specs.
- `e2e/smoke.spec.js`:
  - `/` returns 200, page title is `CliDeck`.
  - `#nav-rail`, `#session-list`, `#btn-new`, `#search-input` are present.
  - No console errors during initial load.
  - Clicking `#btn-new` opens the session creator (`#session-creator`).
  - Search input accepts text.
- `e2e/ctrl-v-paste.spec.js`:
  - Init script hooks `WebSocket.prototype.send` to record outgoing
    frames into a `window.__sentMessages` array.
  - Wait for the WS to open and the app to be ready.
  - Programmatically send `{ type: 'create', commandId: '1' }` over the
    WebSocket — this creates a Shell session using the default
    `defaultShell` command (`cmd.exe` on Windows).
  - Wait for the terminal to render (`.xterm` element appears).
  - Write a known string to the clipboard.
  - Focus the terminal and press `Control+V`.
  - Assert `window.__sentMessages` contains an `{ type: 'input', id,
    data }` frame whose `data` equals the clipboard text.
- `npm run test:e2e` script that runs the suite once.
- `npm run test:e2e:ui` script that opens Playwright's UI mode for
  iteration.

**Out of scope**

- CI integration / GitHub Actions wiring (separate concern, separate PR).
- Cross-browser matrix (Firefox, WebKit) — Chromium only for now; clideck
  is a local-only app and Chromium is the most common host.
- Mobile viewport tests.
- Visual regression / screenshot diffing.
- Auth flows or remote-control scenarios.
- Any change to clideck production code or to existing Vitest tests.

## Acceptance criteria

1. `npm run test:e2e` from a clean checkout, after `npx playwright
   install chromium`, passes all specs.
2. The test server runs in isolation: no writes to the user's real
   `~/.clideck/`. Verified by spawning the server with a temp
   `USERPROFILE` and checking the temp dir afterwards.
3. The Ctrl+V spec demonstrably exercises the full stack: a real Chromium
   keypress, a real WebSocket payload landing at the real server.
4. Smoke specs catch a deliberately-broken `index.html` (e.g. a missing
   `<script>` tag) — verified manually during phase development, not as a
   committed test.
5. The Vitest suite (`npm test`) still passes — no cross-contamination of
   test discovery.

## Constraints

- No production-code changes. Tests must work against the app as it
  stands.
- Browser binaries are NOT committed — `.gitignore` excludes
  `test-results/`, `playwright-report/`, and any Playwright cache dirs
  that land at repo root.
- Default test port: `4099` (avoids the user's running dev clideck on
  4000, plus their typical Vite/Next/etc dev ports).
