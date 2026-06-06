# Phase 12: Mobile + Desktop Concurrent Access — Research

**Researched:** 2026-06-02
**Domain:** Multi-client WebSocket + xterm.js + Tailwind responsive + Playwright E2E (vanilla JS, Node.js fork of `rustykuntz/clideck`)
**Confidence:** HIGH (all findings verified against actual source code in this repo)

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation decisions D-01 → D-19 in `15-CONTEXT.md` are LOCKED. Do not propose alternatives. Summary by area:

- **R1 deletion sweep:** D-01 full surgical removal; D-02 enumerated deletion points; D-03 `git grep` must return zero.
- **R2 PTY resize lock:** D-04 server-side only no-op; D-05 client code untouched; D-06 `spawnSession` signature unchanged; D-07 phone clients scroll horizontally (do not reshape PTY).
- **R5 other-client indicator:** D-08 server-wide count `sessions.clients.size`; D-09 broadcast on add/delete; D-10 single `state.otherClientsConnected` flag toggles `.hidden` on every row; D-11 event-driven; D-12 per-session presence deferred.
- **R3 / R6 touch + responsive:** D-13 lean on xterm.js `.xterm-helper-textarea`; D-14 verify via mobile emulation first; D-15 contingency `touchstart → focusTerminal()`; D-16 extend existing `@media (max-width: 960px)` block — NO new ≤480px tier.
- **Testing:** D-17 Playwright two-context for R4; D-18 Playwright `devices['iPhone 12']` for R6; D-19 ship a `15-VERIFICATION.md`.

### Claude's Discretion

- Exact indicator glyph/colour/position — **already locked by 15-UI-SPEC.md** (`text-amber-400`, two overlapping outlined circles SVG, slot left of `.session-time`). UI-SPEC overrides D-10's "planner's call".
- Whether `remoteCliEnv()` is deleted vs left as a stub — **verified below: delete it** (no other consumers).
- Whether `function resize` in `sessions.js:368` is removed entirely vs left as a no-op — **see Finding #3 — recommend leave-as-no-op for minimum diff and SPEC constraint compatibility.**
- Terminal-pane horizontal-scroll CSS — UI-SPEC locked: `overflow-x: auto` on `.term-wrap` inside the existing 960px block.

### Deferred Ideas (OUT OF SCOPE)

- Per-session presence indicator (D-12)
- Custom modifier-key bar (Ctrl/Esc/Tab/arrows) for mobile
- Touch gestures (swipe-from-edge, two-finger select)
- Per-client controller / view-only mode (input is free-for-all)
- Soft-keyboard fallback (D-15) unless D-13 verification fails
- Any auth / login UI

---

## Phase Requirements

| ID | Description (from SPEC.md) | Research Support |
|----|-------------------------------|------------------|
| R1 | Retire `#remote-modal` flow | §1 full deletion inventory below |
| R2 | PTY size locked at creation | §3 minimal-diff resize change shape |
| R3 | Tap-to-focus + soft keyboard on phone | §8 Playwright mobile-emulation verification + D-15 contingency hook |
| R4 | Concurrent attach + concurrent input | §7 two-context Playwright pattern |
| R5 | Soft "other client" indicator | §2 lifecycle audit, §4 indicator insertion points, §5 state flag plumbing |
| R6 | Responsive at 375×667 phone viewport | §6 mobile-project setup; UI-SPEC §"Phone-viewport responsive contract" |

---

## Project Constraints (from project context)

No `./CLAUDE.md` exists in `/home/clideck/projects/clideck/`. The repo is a vanilla Node.js + vanilla JS (`type: "commonjs"`) fork. Constraints from `package.json` and SPEC:

- **No new heavy dependencies** (SPEC constraint). Existing deps: `node-pty`, `ws`, `@xterm/xterm@^6.0.0`, `@xterm/addon-fit@^0.11.0`. DevDeps: `@playwright/test@^1.60.0`, `happy-dom@^20.9.0`, `tailwindcss@^3.4.19`, `vitest@^4.1.6`.
- **Test runner is `vitest`** (NOT `node:test` as the focus_areas hint guessed). All existing tests in `/tests/*.test.js` use `import { describe, it, expect } from 'vitest'`. Use `vitest` for unit; `@playwright/test` for E2E.
- **E2E lives in `/e2e/*.spec.js`**, not `/tests/`. `playwright.config.js` declares `testDir: './e2e'` and a single `chromium` project on Desktop Chrome at port 4099 with `TEST_HOME` tmpdir isolation. Configured for `workers: 1`, `fullyParallel: false`.
- **Threat model is VPN-only** — do NOT add auth, do NOT bind new ports, do NOT widen origin acceptance.

---

## Summary

Phase 12 is overwhelmingly **deletion + one indicator + one CSS rule + verification tests**. The largest LOC delta is the `clideck-remote` retirement (~360 lines removed across 4 files); the new code surface is tiny (one server broadcast hook, one client WS handler, one DOM injection, one CSS rule, one new state flag).

**Primary recommendation:** Execute as 6 small, independent tasks matching the SPEC's 6 requirements. Run the deletion sweep first (R1) so all later tasks operate on a clean tree. Update the existing `tests/display-sizing.test.js` resize assertion is NOT needed — the test only inspects what the client *sends* (and per D-05 the client still sends `resize` messages); the server-side no-op is verified by a new vitest in §9.

**Critical discovery — saves a step:**
- `sessions.clients.delete(ws)` IS ALREADY CALLED on close (verified at `handlers.js:658`). D-09 only needs the **broadcast on add + broadcast on delete** to be added; no new lifecycle wiring required.
- The remote block ends at app.js line **1863**, not 1816 as CONTEXT.md says (the deletion is 1523–1863; `connect()` call at 1868 stays).
- There are **no orphan `lib/install-clideck-remote*` scripts** (`/lib/` directory does not exist in this repo). CONTEXT.md anticipated this — the "if present" clause resolves to "none".
- There are **NO CSS rules in `public/tailwind.css`** keyed on `#remote-modal` / `#btn-remote` (compiled Tailwind output only; no manual rules). No CSS cleanup is needed beyond deleting the `<button id="btn-remote">` element which removes its references entirely.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `clideck-remote` deletion (R1) | Frontend (HTML + JS) | API server (handlers.js) | Modal markup lives in DOM; install/pair RPC bridges in handlers.js; client state in app.js |
| PTY resize lock (R2) | API server (sessions.js) | — | PTY lifecycle is server-owned; client may continue to send `resize` (per D-05) |
| Tap-to-focus + soft keyboard (R3) | Browser / Client | — | xterm.js renders `.xterm-helper-textarea` in the DOM; native browser raises soft KB on focus |
| Concurrent attach + input (R4) | API server (broadcast) | Frontend (multi-tab no-op) | `sessions.broadcast` already fans output; `case 'input'` already passthrough |
| Other-client indicator (R5) | API server (count broadcast) | Frontend (state flag + DOM toggle) | Server owns truth of `clients.size`; client renders state |
| Responsive 375×667 (R6) | Frontend (CSS + JS) | — | Pure layout — server has no role |

---

## Per Focus-Area Findings

### 1. `clideck-remote` deletion sweep — full verified inventory

`git grep` run from repo root (excluding `CHANGELOG.md`, `.planning/`, `node_modules/`) using the union pattern:

```
remote-modal|clideck-remote|remote\.(update|error|installing|status|pair|unpair|history|paired|unpaired|install\.progress|install\.done|getHistory)|btn-remote|version-remote|remoteCliEnv|remoteUpdateCache|REMOTE_UPDATE_INTERVAL|checkRemoteUpdate|remoteVersion
```

Returns matches in exactly **4 files**: `handlers.js`, `public/index.html`, `public/js/app.js`, `public/js/settings.js`, plus state schema in `public/js/state.js`.

#### 1a. `handlers.js` — server-side deletions

| Lines | Construct | Action |
|-------|-----------|--------|
| 46–98 | `remoteUpdateCache`, `remoteUpdateCheckedAt`, `REMOTE_UPDATE_INTERVAL`, `compareVersions`, `parseVersion`, `getInstalledVersion`, `checkRemoteUpdate(ws)` | **DELETE all 7**. ⚠️ Verify whether `compareVersions` / `parseVersion` / `getInstalledVersion` are still used elsewhere — they ARE: `checkAvailability()` at line 102 calls `getInstalledVersion(bin)` and `compareVersions(p.version, p.minVersion)`. So **keep** `compareVersions`, `parseVersion`, `getInstalledVersion`; delete only `remoteUpdateCache`, `remoteUpdateCheckedAt`, `REMOTE_UPDATE_INTERVAL`, `checkRemoteUpdate`. |
| 246–248 | `function remoteCliEnv() { return { ...process.env, CLIDECK_PORT: String(PORT) }; }` | **DELETE**. Only callers are the four `remote.*` switch cases at lines 605, 615, 624 — all deleted in this phase. Confirmed: `git grep "remoteCliEnv"` → 4 matches, all in soon-deleted blocks. |
| 601–612 | `case 'remote.status':` block (incl. inner `checkRemoteUpdate(ws)` call) | DELETE |
| 614–621 | `case 'remote.pair':` block | DELETE |
| 623–632 | `case 'remote.unpair':` block | DELETE |
| 634–637 | `case 'remote.getHistory':` block | DELETE (CONTEXT.md missed this case — it's a small per-client reply that fetches transcript turns; client side at app.js does not currently send `remote.getHistory`, so dead code) |
| 639–650 | `case 'remote.install':` block (incl. `npm install -g clideck-remote` spawn) | DELETE |

#### 1b. `public/index.html` — DOM deletions

| Lines | Construct | Action |
|-------|-----------|--------|
| 154–156 | `<button id="btn-remote">…</button>` rail launcher | DELETE element |
| 248–250 | `<div class="text-slate-600">clideck remote version: <span id="version-remote"></span></div>` inside `#version-footer` | **DELETE this whole line** (line 249). The line above (`version-clideck`) stays. UI-SPEC didn't list this — surfacing it. |
| 405–493 | `<!-- Remote modal -->` comment + `<div id="remote-modal">…</div>` block — **actual end is line 493**, NOT ~480 as UI-SPEC said. Verified: the modal root `</div>` closes at 493 (immediately before `<!-- Confirmation dialog -->` at 495) | DELETE entire block |

#### 1c. `public/js/app.js` — driver + WS dispatch deletions

| Lines | Construct | Action |
|-------|-----------|--------|
| 107 | `send({ type: 'remote.status' });` inside `state.ws.onopen` handler | DELETE this single line |
| 437–461 | Six `case 'remote.*':` arms inside `state.ws.onmessage` switch (`remote.status`, `remote.paired`, `remote.unpaired`, `remote.error`, `remote.install.progress`, `remote.install.done`, `remote.update`) | DELETE all 7 cases (the seventh is `remote.update` at 455–461) |
| 1523–1863 | **Entire remote modal driver block**. CONTEXT.md says 1523–1816 but the real boundary is 1863 (last line `document.getElementById('remote-disconnect2').addEventListener…`). The next live code starts at line 1865 `initDrag();`. Verified: no other non-remote code in this 340-line range. | DELETE the full 1523–1863 range |
| 1834 | `send({ type: 'remote.status' });` (inside the deleted block) | covered |

**Surfaced** by this research that CONTEXT.md missed: there are also `state.remoteVersion`, `remoteUpdateInfo`, `remotePreflight`, `remoteStatusPoll`, `remoteState`, `remoteInstalled`, `remoteModalOpen`, `remoteLastStatus`, `btnRemote`, `remoteModal` module-level identifiers inside the 1523–1863 block. All disappear with the block. No external references confirmed (`grep` returns zero non-block matches for `remoteUpdateInfo`, `remotePreflight`, `remoteStatusPoll`, `remoteLastStatus`).

#### 1d. `public/js/settings.js` — version-footer cleanup

| Lines | Construct | Action |
|-------|-----------|--------|
| 103–104 | `const remoteEl = document.getElementById('version-remote'); if (remoteEl) remoteEl.textContent = state.remoteVersion \|\| '';` | DELETE these 2 lines. The function `updateVersionFooter` retains its `version-clideck` update. |

#### 1e. `public/js/state.js` — state schema cleanup

| Lines | Construct | Action |
|-------|-----------|--------|
| 13 | `remoteVersion: null,` in the `state` literal | DELETE this single field |

#### 1f. No `lib/install-clideck-remote*` orphans

Verified: `/lib/` directory does not exist in this repo. CONTEXT.md anticipated this. No action.

#### 1g. No CSS in `tailwind.css` to delete

Verified: `grep -nE "remote|btn-remote" public/tailwind.css` returns zero matches. The compiled Tailwind output never produces a rule keyed on the deleted IDs once the DOM is removed.

#### 1h. Verification grep — final

After deletion, this command MUST return zero rows (run from repo root):

```bash
git grep -nE "remote-modal|clideck-remote|remote\.(update|error|installing|status|pair|unpair|history|paired|unpaired|install\.progress|install\.done|getHistory)|btn-remote|version-remote|remoteCliEnv|remoteUpdateCache|REMOTE_UPDATE_INTERVAL|checkRemoteUpdate|remoteVersion|remoteUpdateInfo|remotePreflight|remoteStatusPoll|remoteState|remoteInstalled|remoteModalOpen|remoteLastStatus|btnRemote|remoteModal" -- ':!CHANGELOG.md' ':!.planning/'
```

---

### 2. `sessions.clients` lifecycle audit

**Critical finding:** `sessions.clients.delete(ws)` IS ALREADY CALLED on connection close.

Source: `handlers.js:658` reads:

```js
ws.on('close', () => sessions.clients.delete(ws));
```

This is at the end of `onConnection`, after the message-handler `ws.on('message', …)`. The heartbeat-cleanup `ws.on('close', () => clearInterval(heartbeat))` at line 270 is a separate close handler (multiple `on('close', …)` handlers on the same socket all fire — they don't replace each other).

**D-09 implementation only needs:**
1. Add `sessions.broadcast({ type: 'clients.count', count: sessions.clients.size })` immediately after `sessions.clients.add(ws)` at line 251.
2. Add the same broadcast inside the existing close handler at line 658, after the `delete`:
   ```js
   ws.on('close', () => {
     sessions.clients.delete(ws);
     sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
   });
   ```
3. Add an initial `ws.send(JSON.stringify({ type: 'clients.count', count: sessions.clients.size }))` to the initial-payload block in `onConnection` (around lines 272–280) so the newly-connected client learns the current count immediately — note this client itself is already in the set by then (line 251), so `count >= 1` always when this fires.

**Subtle correctness:** when the second client connects, the broadcast fires AFTER `add(ws)` so `count === 2` is observable on both clients. When the second client disconnects, the broadcast fires AFTER `delete(ws)` so `count === 1` is observable on the remaining client. The contract aligns with R5 acceptance: appears within 5s on appear, disappears within 10s.

---

### 3. Resize handler removal — minimal diff path

Three approaches were considered (per D-04):

| Option | Diff | Risk |
|--------|------|------|
| (a) Replace `sessions.js:368` body with `{}` no-op | 1 line | Lowest |
| (b) Remove `case 'resize':` line in `handlers.js:355` only, keep `sessions.resize` exported | 1 line | If a future code path inside `handlers.js` ever calls `sessions.resize(msg)` directly, behaviour silently divergent |
| (c) Remove both case dispatch AND `sessions.resize` from exports | ~3 lines | Breaks the SPEC constraint *"The `resize` WebSocket message type must remain accepted (clients may still send it during transition / from older fork checkouts) but become a no-op server-side. Do not throw or close the WS on receipt."* — if `case 'resize':` is removed, the `default:` branch passes it to `plugins.handleMessage(msg)` which does NOT throw (verified: it's defensive) so this is technically safe, but option (a) is cleaner because the message type is still explicitly accepted in the switch. |

**Recommendation: Option (a).** Replace `sessions.js:368` with:

```js
// PTY size is locked at session creation time (Phase 12 / SPEC R2).
// Per-client viewport changes no longer reshape the agent's terminal —
// clients visually scale / scroll horizontally instead. The `resize`
// message type stays accepted (older clients still send it) but is a
// no-op server-side. See `.planning/2026-06-02-mobile-desktop-concurrent-access/`.
function resize(_msg) { /* no-op — PTY cols/rows locked at spawnSession() */ }
```

Leave the export at `sessions.js:749` unchanged, leave `handlers.js:355 case 'resize': sessions.resize(msg); break;` unchanged. This satisfies:
- SPEC constraint: message type remains accepted, no throw.
- D-05: client code at `terminals.js:725, 732, 751, 1084` continues to send `resize` and the server silently absorbs it.
- D-04: change is "server-side only no-op".
- Minimum diff.

**Downstream caller check:**
- `sessions.resize` is exported at `sessions.js:749` but external callers: `git grep "sessions.resize\|require.*sessions.*resize"` → only the one call site `handlers.js:355`. Safe to leave the export in place even though only one consumer exists.
- `pty.resize` callers (the underlying node-pty method): there's no path in the code that would call `pty.resize()` directly outside this single function once the body is no-op'd. Verified.

**Test impact: NONE.** `tests/display-sizing.test.js:115–119` asserts on `sent.filter(m => m.type === 'resize')` — i.e. what the *client* sends. Per D-05 the client behaviour is unchanged, so this test stays green. There is NO existing test that exercises the server-side `sessions.resize` function directly.

---

### 4. Session-row indicator wiring — exact insertion point

#### Active sessions (R5)

In `public/js/terminals.js`, `addTerminal` function, the row template is built at lines **509–526**. The top-row container is at **line 514**:

```html
<div class="flex items-baseline gap-2">
  <span class="name flex-1 font-semibold text-[13px] text-slate-200 truncate pointer-events-auto cursor-default">${esc(name)}</span>
  <span class="session-time recent text-[11px] flex-shrink-0">${formatTime(Date.now())}</span>
</div>
```

UI-SPEC contract: insert the new indicator span as the **middle child** between `.name` and `.session-time`:

```html
<div class="flex items-baseline gap-2">
  <span class="name flex-1 font-semibold text-[13px] text-slate-200 truncate pointer-events-auto cursor-default">${esc(name)}</span>
  <span class="other-client-indicator hidden flex-shrink-0 text-amber-400"
        title="Another client is connected"
        aria-label="Another client is connected">
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="6" cy="8" r="3.5"/>
      <circle cx="10" cy="8" r="3.5"/>
    </svg>
  </span>
  <span class="session-time recent text-[11px] flex-shrink-0">${formatTime(Date.now())}</span>
</div>
```

The parent already has `gap-2`, so no parent change needed. `.name` has `flex-1` so it absorbs remaining width; the indicator and timestamp are both `flex-shrink-0` so they sit fixed-width on the right.

#### Resumable / Previous Sessions (R5)

In the same file at lines **1309–1336**, `buildResumableRow` builds the dormant-row template. The top-row container is at **line 1322**:

```html
<div class="flex items-baseline gap-2">
  <span class="resumable-name flex-1 font-semibold text-[13px] text-slate-400 truncate">${esc(s.name)}</span>
  <span class="text-[11px] text-slate-600 flex-shrink-0">${time}</span>
</div>
```

Insert the same indicator markup between `.resumable-name` and the timestamp span. UI-SPEC §"Resumable-rows" confirms identical contract — same toggle rule (server-wide count), same markup.

#### Toggle mechanism (single point)

A single helper in `app.js` (or `terminals.js`) — call site of the new WS `clients.count` handler — should run:

```js
function updateOtherClientIndicator(count) {
  state.otherClientsConnected = count > 1;
  document.querySelectorAll('.other-client-indicator').forEach(el => {
    el.classList.toggle('hidden', !state.otherClientsConnected);
  });
}
```

Both `addTerminal` (line 509-ish) and `buildResumableRow` (line 1322-ish) MUST also read `state.otherClientsConnected` at construction time to apply the initial class — otherwise newly-added rows render `.hidden` even when a second client is connected. Simplest pattern: after the template `innerHTML = …` assignment, call `if (state.otherClientsConnected) row.querySelector('.other-client-indicator').classList.remove('hidden');`.

---

### 5. State flag plumbing

`state` is defined and exported from `public/js/state.js` (lines 1–14). The full object today:

```js
export const state = {
  ws: null,
  terms: new Map(),
  active: null,
  cfg: { commands: [], defaultPath: '', defaultTheme: 'catppuccin-mocha', hostDir: null },
  themes: [],
  presets: [],
  resumable: [],
  filter: { query: '', tab: 'all' },
  pills: new Map(),
  activePill: null,
  transcriptCache: {},
  remoteVersion: null,
};
```

**Two edits to this file:**
1. Add `otherClientsConnected: false,` to the literal (anywhere; idiomatic place is just before the closing `};`).
2. REMOVE `remoteVersion: null,` (per §1e above).

**WS handler precedent (where to add the `clients.count` arm):** `public/js/app.js` lines **112–462** is the message switch in `state.ws.onmessage`. Every state-mutating handler follows the pattern: receive frame → update `state.*` → call a renderer / `applyFilter()` / `updatePill()` etc. Insert the new case alongside the others, e.g. near `case 'sessions':` (line 159) which has similar "iterate over `state.terms`" semantics. Suggested placement: after the `case 'closed':` arm (line 199):

```js
case 'clients.count':
  updateOtherClientIndicator(msg.count);
  break;
```

Where `updateOtherClientIndicator` is defined and imported from `terminals.js` (which owns row construction) so it's adjacent to the row template that needs to read `state.otherClientsConnected` at build time.

---

### 6. Phone-viewport responsive verification — Playwright pattern

Existing `playwright.config.js` declares **one project: `chromium` on `devices['Desktop Chrome']`**. There is NO mobile project. For R6 verification we have two patterns:

**Pattern A (preferred): Per-test mobile context, no config change.**

Spawn a mobile context inside the test using `browser.newContext({ ...devices['iPhone 12'] })`. This avoids cross-project test pollution and keeps the existing Desktop Chrome project as the default.

```js
const { test, expect, devices } = require('@playwright/test');

test('phone viewport at iPhone 12 has no horizontal page-body overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] }); // 390×844, isMobile, hasTouch
  const page = await ctx.newPage();
  await page.goto('/');
  await waitForAppReady(page);

  // R6 acceptance: document.body.scrollWidth === window.innerWidth (no horizontal page overflow)
  const overflows = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);

  // Sidebar toggle reachable
  await expect(page.locator('#mobile-nav-toggle')).toBeVisible();
  await ctx.close();
});
```

For 375×667 specifically (closer to SPEC's literal "iPhone-ish"), use `iPhone SE` device or a custom viewport: `viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 12'].userAgent`.

**Pattern B (alternative): Add a `mobile` project to `playwright.config.js`.**

Not recommended for this phase because the only mobile-only tests are the ones added in this phase; mixing project-scoped tests with per-test context adds complexity. Stay with Pattern A.

---

### 7. Two-context Playwright test for R4 (concurrent input)

Established pattern in this repo (from `e2e/session-indicator-mutex.spec.js`) demonstrates the WS-driven test idiom:

1. `installWsRecorder(page)` patches `window.WebSocket` to capture sent/received messages (recipe at smoke.spec.js:16–43).
2. `waitForAppReady(page)` polls `window.__rxTypes` for `['config', 'sessions', 'presets']` (smoke.spec.js:45–53).
3. `spawnSession(page)` sends `{type:'create', cols:80, rows:24}` on the live WebSocket and waits for the `created` broadcast (indicator-mutex.spec.js:69–88).

**Two-context extension for R4:**

```js
const { test, expect } = require('@playwright/test');

test('two clients concurrently attach to the same session — both see both inputs', async ({ browser }) => {
  // Two independent browser contexts share state through the server only (separate cookies, storage).
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

  // A creates a Shell session; B observes it via the `sessions` broadcast.
  const sessionId = await spawnSession(pageA);
  await expect(pageB.locator(`.group[data-id="${sessionId}"]`)).toBeVisible({ timeout: 5_000 });

  // Both pages select the session.
  await pageA.locator(`.group[data-id="${sessionId}"]`).click();
  await pageB.locator(`.group[data-id="${sessionId}"]`).click();

  // A types 'echo A\r'; B types 'echo B\r'. Use WS input to avoid xterm-textarea focus races.
  await pageA.evaluate(({ id }) => {
    /** @type {any} */ const w = window;
    w.__ws.send(JSON.stringify({ type: 'input', id, data: 'echo A\r' }));
  }, { id: sessionId });
  await pageB.evaluate(({ id }) => {
    /** @type {any} */ const w = window;
    w.__ws.send(JSON.stringify({ type: 'input', id, data: 'echo B\r' }));
  }, { id: sessionId });

  // Both pages should observe both 'A' and 'B' in the rx output stream.
  for (const page of [pageA, pageB]) {
    await expect.poll(async () => page.evaluate(() => {
      /** @type {any} */ const w = window;
      const outs = w.__rxMessages.filter(m => m.type === 'output').map(m => m.data || '').join('');
      return { hasA: /\bA\b/.test(outs), hasB: /\bB\b/.test(outs) };
    }), { timeout: 5_000 }).toEqual({ hasA: true, hasB: true });
  }

  await ctxA.close();
  await ctxB.close();
});
```

Note: `playwright.config.js` uses `workers: 1` so two contexts within one test share the same server instance — exactly the setup R4 needs.

**R5 indicator test in the same file** can reuse both contexts. Before B opens its page: indicator hidden on A. After B's page loads (so the server count goes 1→2): indicator visible on A. After `ctxB.close()`: indicator hidden on A again (within 10s — Playwright `expect.poll` handles this).

---

### 8. Soft-keyboard verification approach (R3)

#### D-13 happy path verification

Per D-13, the contract is "xterm.js's `.xterm-helper-textarea` raises native soft keyboard on tap". In Playwright mobile emulation, the path is:

```js
test('R3: tap on terminal pane focuses xterm helper textarea', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await ctx.newPage();
  await installWsRecorder(page);
  await page.goto('/');
  await waitForAppReady(page);

  const id = await spawnSession(page);
  await page.locator(`.group[data-id="${id}"]`).tap();           // sidebar tap to select
  await page.locator('.term-wrap').first().tap();                // tap into terminal area

  // Phase 11 focusTerminal() should land focus on the helper textarea.
  const focused = await page.evaluate(() => document.activeElement?.classList?.contains('xterm-helper-textarea'));
  expect(focused).toBe(true);
  await ctx.close();
});
```

Playwright `.tap()` synthesises a real `touchstart` + `touchend` sequence when the context has `hasTouch: true` (auto-true for `devices['iPhone 12']`). The Phase-11 `focusTerminal()` primitive in `public/js/terminals.js` (referenced from CONTEXT.md, called from `onWrapClick` at line 715) handles the click→focus path. The verification: tap → `activeElement` is `.xterm-helper-textarea`.

#### D-15 contingency hook

If D-13 verification fails (no focus lands), the contingency is to attach a `touchstart` listener on the terminal container that calls `focusTerminal(id)` explicitly. The smallest hook in `terminals.js` is **adjacent to the existing `el.addEventListener('click', onWrapClick)` at line 716**. Add immediately after:

```js
el.addEventListener('click', onWrapClick);
// D-15 contingency (only enabled if D-13 verification fails) — explicitly route
// touchstart to focusTerminal() so xterm-helper-textarea gets focus on phones
// where 'click' doesn't propagate before the soft keyboard handshake.
// el.addEventListener('touchstart', () => focusTerminal(id), { passive: true });
```

Leave as a comment if D-13 passes. Uncomment if D-13 fails the Playwright mobile-tap assertion. No other code changes — `focusTerminal` is the existing Phase-11 primitive.

---

### 9. Validation Architecture (mandatory — Nyquist gate heading)

See dedicated section `## Validation Architecture` below.

---

### 10. Risks / non-obvious gotchas

| # | Risk | Verified Status | Mitigation |
|---|------|-----------------|------------|
| G1 | Deleting `remote.update` broadcast changes the `onConnection` initial-payload contract older clients depend on | Verified: NO `remote.update` is sent on connect today. `checkRemoteUpdate(ws)` is only called from inside `case 'remote.status':` (line 610). Once we delete the `remote.status` handler, the only path that triggered `remote.update` is gone. Safe to delete. | None needed |
| G2 | Existing test fixture exercises `sessions.resize` and the no-op breaks it | Verified: no test in `/tests/` imports or calls `sessions.resize`. The only resize-related test is `display-sizing.test.js:104–120` which asserts what the *client* sends (unchanged per D-05). | None needed; document in plan |
| G3 | `state.cfg` persists `remote pairing` state across loads | Verified: `state.cfg` is rebuilt from the server's `config` broadcast on every connect (app.js:117). Server's `configForClient()` at handlers.js:242 returns from `cfg` (loaded from disk). No `remote.*` keys exist on cfg today. Safe. | None needed |
| G4 | TypeScript types or JSDoc switch-exhaustiveness check warns on deleted message types | Verified: repo uses vanilla JS, no TypeScript. `app.js` switch has a `default:` branch that delegates to `plugins.handleMessage(msg)` (line 463). Server switch has a `default:` that does the same. No exhaustiveness check exists. Safe. | None needed |
| G5 | `state.remoteVersion` deletion leaves stale references in localStorage or persisted config | Verified: `state.remoteVersion` is module-memory only (not in `state.cfg`, not in localStorage). Just the JS field — safe to delete. | None needed |
| G6 | `compareVersions`, `parseVersion`, `getInstalledVersion` are used elsewhere | Verified: `compareVersions` called at handlers.js:111 inside `checkAvailability()`. `parseVersion` called by `getInstalledVersion`. `getInstalledVersion` called at handlers.js:110. **KEEP all three.** Only delete `checkRemoteUpdate` + cache vars. | Plan must NOT touch these 3 functions |
| G7 | Two `ws.on('close', …)` handlers in `onConnection` (lines 270 + 658) — order matters? | Verified: registration order is heartbeat-clear first, then-message-handler-registered close last. Both fire on close. Order of FIRING is registration order (ws/EventEmitter semantics). The `clients.delete + broadcast` addition can go in either close handler — recommend the existing line-658 one for locality. | None |
| G8 | Initial `clients.count` broadcast on connect races against initial state delivery — what if a client receives `clients.count: 2` before `sessions: [...]`? | The order in `onConnection` is: `add(ws)` first, then send config/themes/presets/sessions, then register message handler. If we insert the `clients.count` broadcast at line 252 (immediately after add), it fires BEFORE the initial-payload sends to this client and BEFORE other clients have an updated count. Safer: also send the `clients.count` *to this client only* as part of the initial-payload block (between sessions and pills), so the new client knows the count includes itself. The fan-out broadcast can stay at line 252 for the other clients. | Plan: at line 251–252, do (a) `sessions.clients.add(ws)`, (b) `sessions.broadcast({type:'clients.count', count: sessions.clients.size})` — this fires to the new client too since broadcast iterates all clients including the just-added one. Single source of truth. |
| G9 | Indicator visibility on newly-added rows after a second client is already connected | Verified: `state.otherClientsConnected` is set when the `clients.count > 1` message arrives. New rows added later (e.g. when the user creates a new session) build the indicator span with `.hidden` by default. Without an additional check, the indicator won't appear on the new row until the next `clients.count` broadcast (i.e. another connect/disconnect). | Fix: in `addTerminal` and `buildResumableRow`, conditionally strip `.hidden` based on `state.otherClientsConnected` at construction time (already in §4 above). |
| G10 | Phone-viewport horizontal scroll on `.term-wrap` doesn't compose with xterm.js Canvas/DOM renderer width math | xterm.js's `.xterm-screen` element has an explicit pixel width matching `cols × charWidth`. Setting `overflow-x: auto` on `.term-wrap` lets the user pan a too-wide xterm grid into view. Compatible with both DOM and Canvas renderers. UI-SPEC locked. | None — apply UI-SPEC CSS verbatim |
| G11 | `text-amber-400` may not be in the compiled `public/tailwind.css` because no class currently uses it | Verified: `grep -nE "text-amber-400" public/tailwind.css` outcome required. If it's missing, the build step `npm run build:css` won't add it because Tailwind's content scan won't see it (it lives only inside a template string at terminals.js line 514). **Plan task must include `npm run build:css` step** OR the indicator must be expressed via inline `style="color: …"` with the resolved amber color. | Recommend the plan step rebuild `tailwind.css` after first introducing `text-amber-400`. If that's impractical (release CSS is shipped pre-built), fall back to inline `style="color:#FBBF24"` per UI-SPEC's dark-mode color value. |
| G12 | Public exposure semantics changing | Verified: phase makes no port/origin changes. `runtime.js` still binds `--host 0.0.0.0` (pre-existing); no new listeners added. The VPN-only threat model is preserved. | None needed; document in completion report |

---

## Standard Stack

### Core
| Library | Version (this repo) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| `@xterm/xterm` | `^6.0.0` | Terminal renderer + `.xterm-helper-textarea` for native KB | Already in use; D-13 leans on its built-in textarea focus path |
| `@xterm/addon-fit` | `^0.11.0` | Computes cols/rows from container size | Already in use; client-side fit logic stays per D-05 |
| `ws` | `^8.19.0` | WebSocket server | Existing; new `clients.count` broadcast uses existing `sessions.broadcast` fan-out |
| `node-pty` | `^1.1.0` | PTY spawn + `pty.resize` (no-op'd per R2) | Existing |

### Supporting (testing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `^4.1.6` | Unit test runner (NOT node:test) | R2 server-side no-op assertion; R5 state-flag handler |
| `happy-dom` | `^20.9.0` | DOM env for vitest | Already used by `terminal-size-estimate.test.js`, `display-sizing.test.js` |
| `@playwright/test` | `^1.60.0` | E2E + mobile emulation via `devices['iPhone 12']` / `iPhone SE` | R3, R4, R5, R6 |

### No new dependencies
Per SPEC constraint. All deletions; only additions are tiny pure JS/CSS.

---

## Architecture Patterns

### System Architecture Diagram (post-Phase-12)

```
   Browser (desktop)                    Browser (phone)
        │                                    │
        │ ws://server:4010                   │ ws://server:4010
        │ (via OpenVPN LAN — out of repo)    │
        ▼                                    ▼
   ┌─────────────────────────────────────────────────┐
   │  server.js  (single ws.Server, binds 0.0.0.0)    │
   └─────────────────────────────────────────────────┘
            │ on connection
            ▼
   ┌─────────────────────────────────────────────────┐
   │  handlers.onConnection(ws)                       │
   │    sessions.clients.add(ws)  ─┐                  │
   │    broadcast clients.count ◄──┘ (NEW R5)         │
   │    initial payload: config, themes, presets,     │
   │                     sessions, plugins, pills     │
   │    ws.on('message', ...) — switch on msg.type:   │
   │      'input'  → sessions.input(msg)              │
   │      'resize' → sessions.resize(msg) [NO-OP R2]  │
   │      'create' → sessions.create(...)             │
   │      [remote.* cases DELETED R1]                 │
   │    ws.on('close', ...):                          │
   │      clients.delete(ws)                          │
   │      broadcast clients.count ◄── (NEW R5)        │
   └─────────────────────────────────────────────────┘
            │
            ▼
   ┌─────────────────────────────────────────────────┐
   │  sessions.js                                     │
   │    spawnSession(..., cols, rows) ── creator's   │
   │      viewport cols/rows lock at creation        │
   │    broadcast({type:'output', id, data}) ──────── │
   │      fans to every client (R4 substrate)        │
   │    resize(msg) { /* NO-OP — locked at spawn */ } │
   └─────────────────────────────────────────────────┘
            │
            ▼
       node-pty pty.spawn / pty.write
       (pty.resize is never called from msg-driven path post-R2)
```

### Recommended Project Structure (unchanged)

```
clideck/
├── handlers.js          # WS message switch — R1 deletions + R5 broadcasts
├── sessions.js          # PTY lifecycle — R2 resize no-op
├── public/
│   ├── index.html       # R1 markup deletions, R6 CSS extension
│   ├── tailwind.css     # rebuild after R5 introduces text-amber-400
│   └── js/
│       ├── app.js       # R1 driver deletion, R5 ws handler
│       ├── terminals.js # R5 indicator markup, D-15 contingency hook
│       ├── settings.js  # R1 version-footer cleanup
│       └── state.js     # remove remoteVersion, add otherClientsConnected
├── tests/               # vitest unit tests
│   └── (new) sessions-resize.test.js, clients-count.test.js
├── e2e/                 # Playwright specs
│   └── (new) mobile-concurrent.spec.js
└── playwright.config.js # NO changes — per-test mobile context (Pattern A)
```

### Pattern 1: WS Message → Handler-Case → Session-Mutator → Broadcast

Established in `handlers.js`. Every state-changing client message follows: client `send({type})` → `case` in `handlers.js` switch → call `sessions.{mutator}` → `sessions.broadcast` fans to all clients.

D-09's `clients.count` is a server-internal trigger (not client-initiated) so it skips the case-arm step and goes straight to broadcast.

### Pattern 2: Per-tab/Per-client Broadcast Awareness

`sessions.broadcast` iterates `clients` and `c.send(raw)` if `c.readyState === 1`. Pattern is fire-and-forget; no per-client ack. Suitable for `clients.count` because eventual consistency is acceptable (R5 SLA: appear within 5s, disappear within 10s).

### Pattern 3: State Flag → DOM Class Toggle (one source of truth)

Established in app.js's `mobileQuery.matches` pattern (line 496). The new indicator follows: single `state.otherClientsConnected` flag, single `updateOtherClientIndicator(count)` function, single class toggle. No per-row state, no map.

### Anti-Patterns to Avoid

- **Per-session presence tracking** — D-12 explicitly defers. Do not introduce a `clients.bySession` map.
- **Client-side resize message removal** — D-05 explicitly forbids. Leave `terminals.js:725, 732, 751, 1084` untouched.
- **A new ≤480px CSS breakpoint** — D-16 forbids. Extend the existing 960px block.
- **Auth UI in this phase** — SPEC out-of-scope.
- **Letterbox via CSS transform on the terminal pane** — UI-SPEC rejected this in favour of `overflow-x: auto`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Soft-keyboard input routing on phone | A hidden `<input>` proxy that mirrors keystrokes to the PTY | Existing `.xterm-helper-textarea` (xterm.js owns it) | xterm.js already routes textarea→term.onData→WS input. A parallel path would duplicate state and likely deadlock. (D-13 locked.) |
| Per-client connection ID tracking | A `clients: Map<id, ws>` with handshake-issued IDs | `sessions.clients: Set<WebSocket>` (already exists) — count by `.size` | We only need count, not identity. (D-08 locked.) |
| Mobile breakpoint tier | A new `@media (max-width: 480px)` block | Extend the existing 960px block | Existing block already handles slide-over sidebar; adding a single `overflow-x` rule is sufficient. (D-16 locked.) |
| Concurrent-input conflict resolution | A "controller mode" with input-locking | Free-for-all + soft indicator | Last-keystroke-wins on race is acceptable per SPEC. (Out of scope per CONTEXT deferred ideas.) |

**Key insight:** Phase 12's leanness is the whole point. Every "elegance" temptation toward a richer presence model, a controller-vs-viewer mode, or a separate phone breakpoint is explicitly out of scope. The implementation should be deletion-heavy.

---

## Runtime State Inventory

Not a rename/refactor/migration phase — this is a feature retirement + new server broadcast + UI delta. The closest analogue is the deletion sweep (R1).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `clideck-remote` did not store any state in the clideck repo's data dir. Pairing state was held by the external `clideck-remote` CLI process. | None |
| Live service config | None — fork-only, no external service registration | None |
| OS-registered state | None — no Task Scheduler / systemd / launchd entries reference the deleted code | None |
| Secrets / env vars | `CLIDECK_PORT` env var is read by both the to-be-deleted `remoteCliEnv()` and the surviving `buildTelemetryEnv` (sessions.js:66). The variable itself is unchanged. | None |
| Build artifacts | `public/tailwind.css` is a committed build output. After §1's deletions, the file does NOT need rebuilding because no class names were *removed* from the new HTML that don't exist elsewhere; but it DOES need rebuilding to **add** `text-amber-400` for the new indicator (see G11 in §10 risks). Plan must include `npm run build:css` step. | `npm run build:css` after R5 indicator markup lands |

**Canonical question — *after every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?*** Answer for this phase: nothing. The only "external" dep was the `clideck-remote` npm package which is installed globally on the user's machine; after deletion, that package may remain installed on disk but is no longer referenced — Lance can manually `npm uninstall -g clideck-remote` at leisure. NOT part of this phase.

---

## Common Pitfalls

### Pitfall 1: Half-deleting the remote modal

**What goes wrong:** Leaving stranded `case 'remote.*':` arms in app.js's WS switch or stranded `state.remoteVersion` references in settings.js.
**Why it happens:** The deletion spans 4 files with cross-file dependencies (state.js → settings.js → index.html DOM IDs).
**How to avoid:** Use the §1h verification grep with the FULL union pattern (incl. `remoteUpdateInfo`, `remoteState`, `btnRemote`, etc.) — not just the SPEC's minimal pattern.
**Warning signs:** `npm run test:e2e -- smoke` failing with "Cannot read properties of null" on a stranded `getElementById` call.

### Pitfall 2: Server-side resize change breaking the client fit logic

**What goes wrong:** Refactoring `sessions.resize` aggressively (e.g. removing from exports) and forgetting that the switch-case still dispatches to it.
**Why it happens:** Wanting "clean" code beyond the minimum diff.
**How to avoid:** Use Option (a) from §3 — keep export, keep dispatch, make body empty. Minimum diff.
**Warning signs:** WS error frames on client; `sessions.resize is not a function` runtime exception.

### Pitfall 3: `text-amber-400` missing from compiled CSS

**What goes wrong:** Indicator renders as the inherited `currentColor` (slate gray) because Tailwind's compiled `public/tailwind.css` doesn't include the rule.
**Why it happens:** Tailwind's content-scan only picks up class names present in source files at build time. The first time `text-amber-400` appears is in the new indicator template string.
**How to avoid:** Plan task explicitly includes `npm run build:css` after the indicator markup is added; OR fall back to inline `style="color:#FBBF24"` per UI-SPEC's color value.
**Warning signs:** Visual-test failure in light mode (the color contingency relies on the swap-to-`text-amber-500` rule; if neither class compiles, the fallback fails too).

### Pitfall 4: Initial `clients.count` race vs initial state delivery

**What goes wrong:** Newly-connected client receives `clients.count: 2` before its `sessions: [...]` initial payload. If the indicator-toggle code runs before any rows exist, the toggle silently no-ops; but if rows are then added later via `addTerminal`, they're built with `.hidden` and the indicator stays hidden.
**Why it happens:** WS messages arrive in send order, but the JS event loop interleaves with DOM construction.
**How to avoid:** Ensure `addTerminal` and `buildResumableRow` check `state.otherClientsConnected` at construction time (see §4 final paragraph + G9 in §10). Belt-and-braces: also re-run `updateOtherClientIndicator(currentCount)` after each `case 'sessions':` arm processes the initial payload.
**Warning signs:** First load shows no indicator even though a second tab is open; refreshing fixes it.

### Pitfall 5: Two contexts in Playwright sharing state via baseURL

**What goes wrong:** Both pages in the two-context test write to the same `localStorage` keys (e.g. `clideck.sidebarWidth`) and one's changes overwrite the other's. Or both tabs assume they're "the active" client.
**Why it happens:** `browser.newContext()` isolates cookies and storage *per context*, so this is actually a non-issue at the storage level — but visual state can race.
**How to avoid:** Use `expect.poll(...)` rather than direct `expect(...)` so eventual consistency wins. Don't assert on order of arrival.
**Warning signs:** Flaky two-context tests passing locally but failing in CI.

---

## Code Examples

### Server: D-09 `clients.count` broadcast

```js
// handlers.js — inside onConnection(ws), around line 251.
function onConnection(ws) {
  sessions.clients.add(ws);
  // Broadcast current count immediately — fan-out includes this just-added
  // client, so the new connection learns the count includes itself.
  sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });

  // ... heartbeat setup (unchanged) ...

  ws.send(JSON.stringify({ type: 'config', config: configForClient() }));
  // ... rest of initial payload (unchanged) ...

  ws.on('message', (raw) => { /* ... unchanged switch ... */ });

  // Existing close handler — extend with broadcast.
  ws.on('close', () => {
    sessions.clients.delete(ws);
    sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
  });
}
```

### Server: D-04 resize no-op

```js
// sessions.js:368 — replace existing function body.
function resize(_msg) {
  // PTY size is locked at session creation time (Phase 12 R2).
  // The `resize` message type stays accepted (older clients still send it)
  // but is a no-op server-side. Per-client viewport changes no longer
  // reshape the agent's terminal — clients visually scale or scroll
  // horizontally instead.
}
```

### Client: state.js update

```js
// public/js/state.js — single literal, two edits.
export const state = {
  ws: null,
  terms: new Map(),
  active: null,
  cfg: { commands: [], defaultPath: '', defaultTheme: 'catppuccin-mocha', hostDir: null },
  themes: [],
  presets: [],
  resumable: [],
  filter: { query: '', tab: 'all' },
  pills: new Map(),
  activePill: null,
  transcriptCache: {},
  // remoteVersion: null,   // ← DELETED
  otherClientsConnected: false,   // ← ADDED (D-10)
};
```

### Client: app.js WS handler arm

```js
// public/js/app.js — inside the onmessage switch, near case 'closed':
case 'clients.count':
  updateOtherClientIndicator(msg.count);
  break;
```

### Client: indicator markup (terminals.js:514 insertion)

```js
// public/js/terminals.js — addTerminal innerHTML, line 514-ish.
item.innerHTML = `
  <div class="session-icon w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden pointer-events-none" style="background:var(--color-session-icon-bg)">
    ${iconHtml(commandId)}
  </div>
  <div class="flex-1 min-w-0 pointer-events-none">
    <div class="flex items-baseline gap-2">
      <span class="name flex-1 font-semibold text-[13px] text-slate-200 truncate pointer-events-auto cursor-default">${esc(name)}</span>
      <span class="other-client-indicator${state.otherClientsConnected ? '' : ' hidden'} flex-shrink-0 text-amber-400"
            title="Another client is connected"
            aria-label="Another client is connected">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="6" cy="8" r="3.5"/>
          <circle cx="10" cy="8" r="3.5"/>
        </svg>
      </span>
      <span class="session-time recent text-[11px] flex-shrink-0">${formatTime(Date.now())}</span>
    </div>
    <div class="flex items-center gap-1 mt-0.5">
      <span class="session-status flex-shrink-0 leading-none" style="transition:opacity 0.2s"></span>
      <span class="session-preview flex-1 text-xs text-slate-500 truncate"></span>
      <span class="unread-dot hidden w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></span>
      <button class="menu-btn opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 flex-shrink-0 transition-opacity pointer-events-auto" title="Menu">
        <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 20 20"><path d="M10 14l-4-4h8l-4 4z" fill="currentColor"/></svg>
      </button>
    </div>
  </div>`;
```

### Client: updateOtherClientIndicator helper

```js
// public/js/terminals.js — export this; called from app.js's clients.count case.
export function updateOtherClientIndicator(count) {
  state.otherClientsConnected = count > 1;
  document.querySelectorAll('.other-client-indicator').forEach(el => {
    el.classList.toggle('hidden', !state.otherClientsConnected);
  });
}
```

### CSS: D-16 horizontal scroll on `.term-wrap`

```css
/* public/index.html — inside the existing @media (max-width: 960px) block. */
@media (max-width: 960px) {
  /* ... existing rules unchanged ... */
  .term-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate `clideck-remote` npm-installed CLI bridge for mobile | Single responsive UI driven by the same WS | Phase 12 (this) | Removes 1 npm dependency from user-facing install path; ~360 LOC removed |
| `pty.resize(cols, rows)` on every client `resize` message — last-client-wins | PTY cols/rows locked at `spawnSession`; client-side viewport changes are visual-only | Phase 12 (this) | Eliminates the "phone shrinks desktop user's PTY" failure mode |
| No multi-client awareness | Soft "other client" indicator on every session row when `clients.size > 1` | Phase 12 (this) | Eventual-consistency presence; ≤ 5s on appear, ≤ 10s on disappear |
| `@media (max-width: 960px)` tablet-oriented breakpoint with no phone-specific overflow handling | Same breakpoint + `overflow-x: auto` on `.term-wrap` | Phase 12 (this) | Phone viewports below the locked PTY width scroll horizontally rather than overflowing the body |

**Deprecated/outdated** (after this phase):
- The `clideck-remote` npm package: still exists upstream but the fork no longer references it. Manual `npm uninstall -g clideck-remote` is at user's leisure (not enforced).
- `state.remoteVersion`, `state.remoteVersion` in app.js, `version-remote` DOM ID: all removed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (unit) | `vitest@^4.1.6` |
| Framework (E2E) | `@playwright/test@^1.60.0` |
| Config file (unit) | (vitest auto-detects; no `vitest.config.*` present in repo) |
| Config file (E2E) | `/home/clideck/projects/clideck/playwright.config.js` (testDir: `./e2e`, single chromium project, port 4099, isolated TEST_HOME) |
| Quick run command | `npm run test` (unit) or `npm run test:e2e -- <spec-file>` (single E2E) |
| Full suite command | `npm run test && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| R1 | `git grep` returns zero remote-references | shell + smoke E2E | `bash -c 'git grep -nE "remote-modal\|clideck-remote\|..." -- ":!CHANGELOG.md" ":!.planning/"'` + `npx playwright test e2e/smoke.spec.js` | ❌ — needs new task: `e2e/clideck-remote-deletion.spec.js` (or extend smoke.spec.js) to assert `#remote-modal`, `#btn-remote`, `#version-remote` absent from DOM and console.error empty |
| R1 | Dashboard loads clean with no console errors after deletion | E2E | `npx playwright test e2e/smoke.spec.js` | ✅ exists — already asserts `errors == []` at line 74 |
| R2 | Server `resize` is a no-op against a mock pty | unit (vitest) | `npx vitest run tests/sessions-resize.test.js` | ❌ Wave 0 — new file `tests/sessions-resize.test.js` |
| R2 | Sending `{type:'resize', cols:40, rows:10}` over WS does not change PTY size | E2E | `npx playwright test e2e/pty-size-locked.spec.js` | ❌ Wave 0 — new file `e2e/pty-size-locked.spec.js`; asserts `tput cols` before == after sending a resize WS message |
| R3 | Tapping `.term-wrap` on mobile-emulation Playwright context focuses `.xterm-helper-textarea` | E2E (mobile-context) | `npx playwright test e2e/mobile-touch.spec.js` | ❌ Wave 0 — new file `e2e/mobile-touch.spec.js`; uses `browser.newContext({...devices['iPhone 12']})` |
| R4 | Two contexts attach to one session — both see both clients' input | E2E (two-context) | `npx playwright test e2e/concurrent-input.spec.js` | ❌ Wave 0 — new file `e2e/concurrent-input.spec.js`; uses two `browser.newContext()` |
| R5 | `updateOtherClientIndicator(2)` removes `.hidden` from every `.other-client-indicator`, `updateOtherClientIndicator(1)` restores it | unit (vitest, happy-dom) | `npx vitest run tests/other-client-indicator.test.js` | ❌ Wave 0 — new file `tests/other-client-indicator.test.js` |
| R5 | Indicator visible on Tab A when Tab B connects, hidden when B disconnects | E2E (two-context) | `npx playwright test e2e/concurrent-input.spec.js` (same file as R4) | ❌ — covered by R4 file with additional assertions |
| R6 | At iPhone 12 viewport, `document.body.scrollWidth === window.innerWidth` (no page-body horizontal scroll); sidebar toggle reachable; sessions list scrollable | E2E (mobile-context) | `npx playwright test e2e/mobile-viewport.spec.js` | ❌ Wave 0 — new file `e2e/mobile-viewport.spec.js` |
| R6 | Walkthrough: load → switch session → tap terminal → open sidebar → close → create new session → delete | E2E manual + scripted | Same file as above with a sequential walk-through `test('...')` block | ❌ Wave 0 |

### Existing Tests (verification of no-regression)

- `tests/display-sizing.test.js:104–120` — asserts client SENDS `resize`. Per D-05 unchanged. Should stay green after R2.
- `e2e/smoke.spec.js` — asserts app loads with no console errors. Verifies R1 deletion sweep doesn't leave dangling `getElementById` errors.
- `e2e/session-indicator-mutex.spec.js` — verifies unread-dot / working-indicator mutex. New R5 indicator must not collide visually; verify by inspecting `.other-client-indicator` lives in a different row slot and does not toggle the `.unread-dot` or `.session-status` classes.

### Sampling Rate

- **Per task commit:** `npm run test` (vitest, ~2s suite for new tests; full suite ~ 5–10s)
- **Per wave merge:** `npm run test && npm run test:e2e` (full suite; Playwright ~ 30–60s)
- **Phase gate:** Full suite green before `/gsd:verify-work`. Both unit and E2E. Manual phone-device verification per D-14 documented in `15-VERIFICATION.md`.

### Wave 0 Gaps

New test files to author (sequenced before implementation tasks):

- [ ] `tests/sessions-resize.test.js` — vitest unit, covers R2. Mocks a `sessions.get(id)` result with a `pty.resize` spy; calls `sessions.resize({id, cols:40, rows:10})`; asserts spy never called.
- [ ] `tests/other-client-indicator.test.js` — vitest unit (happy-dom), covers R5 toggle logic. Sets up two `.other-client-indicator` spans in document.body; calls `updateOtherClientIndicator(2)`; asserts `.hidden` removed from both; calls `updateOtherClientIndicator(1)`; asserts `.hidden` re-added.
- [ ] `e2e/clideck-remote-deletion.spec.js` — Playwright, covers R1. Asserts `#remote-modal`, `#btn-remote`, `#version-remote` are absent from DOM. Asserts no `pageerror` / `console.error` during load. Asserts the post-deletion grep returns zero (shell-exec inside a `test.beforeAll`).
- [ ] `e2e/pty-size-locked.spec.js` — Playwright, covers R2 end-to-end. Creates a session with cols:120, rows:30; reads `term.cols` via xterm internals; sends a manual `{type:'resize', cols:40, rows:10}`; asserts `term.cols` unchanged after a poll window.
- [ ] `e2e/mobile-touch.spec.js` — Playwright with `devices['iPhone 12']` context. Verifies R3.
- [ ] `e2e/concurrent-input.spec.js` — Playwright two-context. Verifies R4 + R5 indicator visibility.
- [ ] `e2e/mobile-viewport.spec.js` — Playwright `devices['iPhone 12']` context. Verifies R6.
- [ ] No framework install needed — `vitest` and `@playwright/test` already in devDeps.
- [ ] No `vitest.config.*` needed — auto-detects.
- [ ] No `playwright.config.js` changes — per-test mobile contexts (Pattern A) avoid project additions.

---

## Security Domain

`security_enforcement` is not explicitly configured in `.planning/config.json` (verified: `.planning/config.json` does not exist in this repo). Treating as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | **no** (this phase explicitly does NOT add auth — VPN-only threat model is the locked control) | n/a — exposure control lives in `clideck-docker-lance` OpenVPN routing, not in-app |
| V3 Session Management | no | n/a — single-user model; WS sessions are unauthenticated by design |
| V4 Access Control | no | n/a — same reason |
| V5 Input Validation | **yes** (R2 + R4) | Server defensively validates `resize` and `input` messages: `resize` becomes a no-op (defense-in-depth even if malformed); `input` already passes through `sessions.input(msg)` which gates by `sessions.get(msg.id)?.` (handlers.js:341–366) — no change needed. |
| V6 Cryptography | no | n/a — no crypto introduced |
| V7 Error Handling | yes (deletion sweep) | After R1 deletions, no stranded `try {} catch {}` blocks should leak server stack to client. Verified: deleted `case 'remote.*':` arms used `ws.send(... 'remote.error' ...)` which goes away with the cases. |

### Known Threat Patterns for the WS+PTY+browser stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed WS frames causing server crash | DoS | `ws.on('message')` already wrapped in `try { JSON.parse } catch { return }` (handlers.js:284). No change. |
| Resize message size attack (e.g. cols: 10^9) | DoS | After R2, `resize` is no-op — no attack surface. Pre-R2, `pty.resize` would have rejected huge values at the node-pty layer. |
| Concurrent input from unauthorized client | Spoofing | Out of scope (VPN-only threat model). Any client that can reach the WS port is implicitly trusted. |
| XSS via session name / preview text | Tampering | Existing `esc()` helper used in `terminals.js:515` (`${esc(name)}`) and `:1323` (`${esc(s.name)}`). New indicator markup uses STATIC HTML (no user input interpolated) so no XSS risk. |
| Cross-client message broadcast leaking private data | Information Disclosure | All broadcasts today are session-scoped (`session.status`, `output`, `created`, etc.); the new `clients.count` broadcasts only an integer. No PII / no session data leaked. |

### Phase-12-specific defensive notes

- The new `clients.count` broadcast is fan-out to ALL connected clients including the disconnecting one — `sessions.broadcast` skips `c.readyState !== 1` per sessions.js:38, so the disconnecting client doesn't receive a send-after-close error. Verified.
- The indicator's `title` / `aria-label` are STATIC strings ("Another client is connected"). No user input interpolated. Safe.

---

## Files-to-Modify Summary Table

| File Path | What Changes | Why |
|-----------|--------------|-----|
| `/home/clideck/projects/clideck/handlers.js` | Delete `remoteUpdateCache`, `remoteUpdateCheckedAt`, `REMOTE_UPDATE_INTERVAL`, `checkRemoteUpdate` (lines 46–49, 73–98). Delete `remoteCliEnv` (246–248). Delete 5 `case 'remote.*':` arms (601–650 inclusive of `remote.status`, `remote.pair`, `remote.unpair`, `remote.getHistory`, `remote.install`). Add `sessions.broadcast({type:'clients.count', count: sessions.clients.size})` after line 251 `sessions.clients.add(ws)`. Extend `ws.on('close', …)` at line 658 to broadcast after `delete`. Keep `compareVersions`, `parseVersion`, `getInstalledVersion` — they're used by `checkAvailability`. | R1 deletions + R5 broadcast wiring |
| `/home/clideck/projects/clideck/sessions.js` | Replace `function resize(msg) { sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows); }` at line 368 with no-op `function resize(_msg) { /* no-op */ }`. Keep export at line 749. | R2 PTY resize lock |
| `/home/clideck/projects/clideck/public/index.html` | Delete `<button id="btn-remote">…</button>` (lines 154–156). Delete `<div>clideck remote version: <span id="version-remote">…</span></div>` (line 249 specifically). Delete entire `<!-- Remote modal -->` `<div id="remote-modal">…</div>` block (lines 405–493). Inside existing `@media (max-width: 960px)` block, add `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }`. | R1 deletion + R6 responsive |
| `/home/clideck/projects/clideck/public/js/app.js` | Delete `send({ type: 'remote.status' });` at line 107. Delete the 7 `case 'remote.*':` arms (437–461). Delete the full remote driver block (lines 1523–1863) — last live line in block is `document.getElementById('remote-disconnect2').addEventListener…`, next live code `initDrag();` at 1865 stays. Add new `case 'clients.count':` arm in WS switch (near closed/sessions cases). | R1 deletion + R5 client wiring |
| `/home/clideck/projects/clideck/public/js/settings.js` | Delete `const remoteEl = document.getElementById('version-remote');` and the `if (remoteEl) remoteEl.textContent = state.remoteVersion \|\| '';` lines (103–104). | R1 cleanup |
| `/home/clideck/projects/clideck/public/js/state.js` | Delete `remoteVersion: null,` (line 13). Add `otherClientsConnected: false,` to the literal. | R1 cleanup + R5 state flag |
| `/home/clideck/projects/clideck/public/js/terminals.js` | Insert the locked indicator `<span class="other-client-indicator …">…</span>` markup between `.name` and `.session-time` in `addTerminal`'s row template (around line 514) AND in `buildResumableRow`'s template (around line 1322). Build with `state.otherClientsConnected ? '' : ' hidden'` so newly-added rows pick up current state. Export new `updateOtherClientIndicator(count)` helper. (Optional D-15 contingency hook on `el.addEventListener('touchstart', …)` adjacent to line 716; leave commented unless D-13 verification fails.) | R5 indicator markup |
| `/home/clideck/projects/clideck/public/tailwind.css` | Rebuild via `npm run build:css` after `text-amber-400` first appears in terminals.js — Tailwind content-scan will pick it up. Alternatively, inline the color via `style="color:#FBBF24"` to avoid the rebuild step. | R5 indicator color |
| `/home/clideck/projects/clideck/tests/sessions-resize.test.js` | NEW vitest unit. Asserts `sessions.resize({id, cols:40, rows:10})` does not invoke `pty.resize` on the mocked session. | R2 unit gate |
| `/home/clideck/projects/clideck/tests/other-client-indicator.test.js` | NEW vitest unit (happy-dom). Asserts `updateOtherClientIndicator(2)` removes `.hidden`; `updateOtherClientIndicator(1)` restores it. | R5 unit gate |
| `/home/clideck/projects/clideck/e2e/clideck-remote-deletion.spec.js` | NEW Playwright. Asserts `#remote-modal`, `#btn-remote`, `#version-remote` absent; no console errors. | R1 E2E gate |
| `/home/clideck/projects/clideck/e2e/pty-size-locked.spec.js` | NEW Playwright. Creates 120×30 session; sends `{type:'resize', cols:40, rows:10}`; asserts xterm `term.cols === 120` post-poll. | R2 E2E gate |
| `/home/clideck/projects/clideck/e2e/mobile-touch.spec.js` | NEW Playwright mobile-context. Asserts tap on `.term-wrap` focuses `.xterm-helper-textarea`. | R3 E2E gate |
| `/home/clideck/projects/clideck/e2e/concurrent-input.spec.js` | NEW Playwright two-context. Asserts R4 (both clients see both inputs) and R5 (indicator visibility on Tab A when Tab B connects/disconnects). | R4 + R5 E2E gate |
| `/home/clideck/projects/clideck/e2e/mobile-viewport.spec.js` | NEW Playwright mobile-context. Asserts no page-body horizontal scroll at 375×667; sidebar toggle reachable; walkthrough completes. | R6 E2E gate |
| `/home/clideck/projects/clideck/.planning/2026-06-02-mobile-desktop-concurrent-access/15-VERIFICATION.md` | NEW per D-19. Documents which E2E specs were authored, which were executed locally vs CI-only, and the manual real-device verification result for R3. | D-19 |

---

## Assumptions Log

> All claims tagged `[ASSUMED]` in this research. Empty if every claim was verified.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `text-amber-400` is missing from compiled `public/tailwind.css` because no existing class uses it. The build step picks it up if rebuilt. | G11, Pitfall 3 | Indicator renders without color in production until rebuild. Mitigation: also documented inline-style fallback. (Not yet `grep`-verified inside the multi-MB minified file — would need a `grep -c "amber-400"` to confirm.) |
| A2 | `npm view clideck-remote version` is the package identifier the deleted `checkRemoteUpdate` queries. The package itself is unchanged by this phase — we just stop calling it. | §1a deletion | None — we're removing a caller, not the package itself. Package legitimacy audit not required because no new package installs. |

**Otherwise:** every other finding was verified by reading the actual source code in this repo (handlers.js, sessions.js, public/index.html, public/js/app.js, public/js/terminals.js, public/js/state.js, public/js/settings.js, playwright.config.js, package.json, existing e2e/*.spec.js, existing tests/*.test.js). All line numbers are accurate as of commit `9f6a111` (HEAD of `main`).

---

## Open Questions

1. **Should the `15-VERIFICATION.md` (D-19) be created by the planner or the executor?**
   - What we know: Phases 9 / 10 / 11 each ship a `VERIFICATION.md` noting which E2E tests were authored vs executed locally (sudo-gated Chromium libs).
   - What's unclear: which agent owns its initial creation.
   - Recommendation: planner creates the skeleton (which tests to author, which require manual real-device validation per D-14); executor fills in actual run results.

2. **Does the existing test environment have Chromium libs available for Playwright?**
   - What we know: `clideck-docker/TEST-ENV-DEPS.md` (referenced by D-19) documents sudo-gated Chromium libs — implying the standard dev WSL environment does NOT have them.
   - What's unclear: whether Lance has unblocked this for the test runner since.
   - Recommendation: plan should attempt `npm run test:e2e` once during the verify-work phase; if it fails on missing Chromium libs, document in VERIFICATION.md and move to the manual real-device verification path. The unit tests (vitest) will run regardless.

3. **Is there a real Android phone available for D-14 verification during this phase, or does that wait for `clideck-docker-lance` to ship?**
   - What we know: CONTEXT.md says "Lance has access via the dev container exposed on LAN once `clideck-docker-lance` is up".
   - What's unclear: timing — is `clideck-docker-lance` up at execution time?
   - Recommendation: the Playwright `devices['iPhone 12']` mobile-emulation tests are the primary R3/R6 acceptance gate. The real-device check is supplementary per D-14; if not available at execution time, defer to the next sync with Lance and document the gap in VERIFICATION.md. **Do NOT block the phase on it.**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `vitest` | New unit tests for R2 + R5 | ✓ | `^4.1.6` (devDep) | — |
| `happy-dom` | DOM env for `tests/other-client-indicator.test.js` | ✓ | `^20.9.0` (devDep) | — |
| `@playwright/test` | New E2E tests for R1, R2, R3, R4, R5, R6 | ✓ | `^1.60.0` (devDep) | — |
| Chromium browser libs (Playwright host deps) | `npm run test:e2e` actually running | ⚠ unknown — likely missing per `clideck-docker/TEST-ENV-DEPS.md` (sudo-gated) | — | Author specs, run later in a real-device or sudo-enabled environment; document gap in `15-VERIFICATION.md` per D-19. |
| `node-pty` | Existing `sessions.spawnSession` (verifying R2 didn't break PTY lifecycle) | ✓ | `^1.1.0` | — |
| `tailwindcss` (CLI for `npm run build:css`) | Adding `text-amber-400` to compiled CSS | ✓ | `^3.4.19` (devDep) | Inline-style fallback `color:#FBBF24` (A1) |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** Chromium runtime libs — fallback is to author specs and run in CI or a phone-on-LAN environment.

---

## Sources

### Primary (HIGH confidence — direct repo verification)
- `/home/clideck/projects/clideck/handlers.js` — read 1–700, verified line numbers
- `/home/clideck/projects/clideck/sessions.js` — read full file
- `/home/clideck/projects/clideck/public/index.html` — read full file (modal block at 405–493, breakpoint at 60–127)
- `/home/clideck/projects/clideck/public/js/app.js` — targeted reads around 90–220, 420–500, 1700–1865
- `/home/clideck/projects/clideck/public/js/terminals.js` — targeted reads around 490–770, 1070–1100, 1305–1380
- `/home/clideck/projects/clideck/public/js/state.js` — read full file
- `/home/clideck/projects/clideck/public/js/settings.js` — targeted read 95–120
- `/home/clideck/projects/clideck/playwright.config.js` — read full file
- `/home/clideck/projects/clideck/package.json` — read top section
- `/home/clideck/projects/clideck/tests/display-sizing.test.js` — verified resize-assertion shape
- `/home/clideck/projects/clideck/e2e/smoke.spec.js` — read full file (WS recorder pattern, app-ready poll)
- `/home/clideck/projects/clideck/e2e/session-indicator-mutex.spec.js` — read full file (WS-driven test idiom)
- `/home/clideck/projects/clideck/.planning/2026-06-02-mobile-desktop-concurrent-access/15-CONTEXT.md` — read full file
- `/home/clideck/projects/clideck/.planning/2026-06-02-mobile-desktop-concurrent-access/SPEC.md` — read full file
- `/home/clideck/projects/clideck/.planning/2026-06-02-mobile-desktop-concurrent-access/15-UI-SPEC.md` — read full file
- `git grep -nE "..."` (multi-pattern) — verified deletion sweep inventory
- `git grep "remoteCliEnv"` — verified the helper has no surviving callers post-deletion
- `git grep "compareVersions|parseVersion|getInstalledVersion"` — verified these 3 are still used by `checkAvailability` and MUST NOT be deleted

### Secondary (MEDIUM confidence)
- Tailwind 3.4 content-scan behaviour (Tailwind docs, training knowledge): paths in `tailwind.config.*` determine what classes get compiled into output. Confirmed in `package.json` build script `tailwindcss -i src/input.css -o public/tailwind.css --minify`. NOT cross-verified against a live `tailwind.config.js` — that file was not read in this session. **Mitigation:** documented inline-style fallback (A1).
- xterm.js 6 `.xterm-helper-textarea` focus behaviour: documented xterm.js behaviour for soft-keyboard activation. Cross-confirmed by D-13's existing decision.

### Tertiary (LOW confidence)
- None. All findings are verified or explicitly flagged.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version directly read from `package.json`
- Architecture: HIGH — every line number verified in source
- Pitfalls: HIGH — each pitfall references concrete code paths verified in this session
- Test framework: HIGH — vitest + Playwright confirmed via package.json and existing test files (not node:test as focus_areas implied)
- Deletion inventory: HIGH — `git grep` results in record above
- One MEDIUM-confidence item: G11 / A1 (whether `text-amber-400` is in current compiled CSS) — flagged

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 (30 days; stable fork — no fast-moving deps)

---

## RESEARCH COMPLETE
