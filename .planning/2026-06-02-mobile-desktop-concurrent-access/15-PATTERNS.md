# Phase 12: Mobile + Desktop Concurrent Access — Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 14 (7 modified + 7 new tests)
**Analogs found:** 14 / 14

> Consumed by `gsd-planner`. Each pattern below pairs a target file with the closest existing analog in the codebase, lifts the load-bearing excerpt, and points to the exact splice site. The UI-SPEC and RESEARCH.md remain authoritative for *what* to write — this file pins *which existing code* to copy the **shape** from.

---

## File Classification

| Target file | Role | Data Flow | Closest Analog | Match Quality |
|-------------|------|-----------|----------------|---------------|
| `handlers.js` (modified) | server message dispatcher | event-driven WS broadcast | itself (Phase 10 `check-cwd` ws.send precedent at `handlers.js:361-369` + initial-payload pushes at `handlers.js:272-279`) | exact (same file) |
| `sessions.js` (modified — `resize` no-op) | session mutator | request-response (now no-op) | `sessions.js:368` itself; closest no-op precedent is the defensive close-handler shrug `catch { /* noop */ }` at `handlers.js:264,268,288,363,368` | role-match |
| `public/index.html` (modified — delete `#remote-modal`, add `.term-wrap` overflow) | DOM markup + responsive CSS | static markup + media query | `public/index.html:60-127` (existing `@media (max-width: 960px)` block — extend) | exact |
| `public/js/app.js` (modified — `case 'clients.count':` + 7 remote-case deletions) | WS message router | event-driven | `app.js:159-173` (`case 'sessions':` arm — same "iterate state.terms" pattern; pure handler→state update) | exact |
| `public/js/settings.js` (modified — delete `version-remote` block) | settings renderer | DOM mutation | `settings.js:100-109` (`updateVersionFooter` — `version-clideck` lines stay; `version-remote` lines deleted) | exact (same file) |
| `public/js/state.js` (modified — add `otherClientsConnected`, delete `remoteVersion`) | module state literal | static state | `state.js:1-14` (the literal itself) | exact (same file) |
| `public/js/terminals.js` (modified — indicator splice + `updateOtherClientIndicator`) | session-row renderer | DOM construction + reactive toggle | `terminals.js:521` (`.unread-dot hidden …` — same slot+toggle pattern); `terminals.js:519` (`.session-status` — same row template) | exact (same file) |
| `public/tailwind.css` (modified — rebuild for `text-amber-400`) | build artifact | static CSS | `package.json` `npm run build:css` script + `tailwind.config.js` content-scan | exact |
| `tests/sessions-resize.test.js` (NEW) | unit test (node env) | mutator + spy | `tests/session-pause.test.js` and `tests/session-token-capture.test.js` (both `@vitest-environment node`; both use `freshSessionsModule()` + `captureClient()`; both call `sessions.{mutator}` and assert on broadcast frames) | exact |
| `tests/other-client-indicator.test.js` (NEW) | unit test (happy-dom) | DOM toggle | `tests/terminal-focus.test.js` (same happy-dom env; same `state.terms.clear() + document.body.innerHTML=''` setup; same `import { focusTerminal } from '../public/js/terminals.js'` import shape) | exact |
| `e2e/clideck-remote-deletion.spec.js` (NEW) | E2E smoke regression | DOM absence + console.error gate | `e2e/smoke.spec.js` (already asserts `errors == []` via `pageerror` + `console` listeners at lines 57-61, 74) | exact |
| `e2e/pty-size-locked.spec.js` (NEW) | E2E WS-driven assertion | WS send + xterm internal poll | `e2e/session-indicator-mutex.spec.js` (full WS recorder + `spawnSession` + `dispatchSessionStatus` synthetic-event idiom) | exact |
| `e2e/mobile-touch.spec.js` (NEW) | E2E mobile-context | touch event + active-element poll | No mobile-context precedent in repo → derive from Playwright docs (`browser.newContext({ ...devices['iPhone 12'] })`); reuse `installWsRecorder` + `waitForAppReady` from smoke.spec.js | partial (no analog) |
| `e2e/concurrent-input.spec.js` (NEW) | E2E two-context | two parallel WS streams | No two-context precedent in repo → derive: two parallel `browser.newContext()` calls, each running the single-context shape from `session-indicator-mutex.spec.js`'s `spawnSession()` helper | partial (no analog) |
| `e2e/mobile-viewport.spec.js` (NEW) | E2E mobile-context | viewport math + walkthrough | Same mobile-context idiom as `mobile-touch.spec.js` | partial (no analog) |

---

## Pattern Assignments

### 1. `handlers.js` — add `clients.count` broadcast + delete remote bridges

**Role:** server message dispatcher | **Data flow:** event-driven WS broadcast
**Analog:** itself — the existing `onConnection(ws)` (`handlers.js:250–280`) for the initial-payload precedent + the existing `ws.on('close', …)` (`handlers.js:658`) for the cleanup hook.

#### 1a. Initial-payload broadcast precedent (`handlers.js:272-280`)

This is the shape D-09 follows for the new `{type:'clients.count'}` push. Note the consistent `ws.send(JSON.stringify({...}))` per-message pattern with no batching, no acks:

```js
ws.send(JSON.stringify({ type: 'config', config: configForClient() }));
ws.send(JSON.stringify({ type: 'themes', themes }));
ws.send(JSON.stringify({ type: 'presets', presets: clientPresets() }));
ws.send(JSON.stringify({ type: 'sessions', list: sessions.list() }));
ws.send(JSON.stringify({ type: 'sessions.resumable', list: sessions.getResumable(cfg) }));
ws.send(JSON.stringify({ type: 'transcript.cache', cache: transcript.getCache() }));
ws.send(JSON.stringify({ type: 'plugins', list: plugins.getInfo() }));
ws.send(JSON.stringify({ type: 'pills', list: plugins.getPills() }));
sessions.sendBuffers(ws);
```

**Splice for D-09:** Insert a `sessions.broadcast({ type: 'clients.count', count: sessions.clients.size })` call immediately after `sessions.clients.add(ws)` at line 251 (fires to the just-added client AND every existing client — per the `sessions.broadcast` fan-out in `sessions.js:36-58`). Do NOT add a per-client `ws.send` in the initial-payload block above — the broadcast already covers the new client because it's in the set by line 252.

#### 1b. Per-client reply precedent — Phase 10's `check-cwd` (`handlers.js:361-369`)

For reference (NOT what D-09 uses, but the orthogonal pattern in this codebase). D-09 is a global broadcast, not a per-client reply:

```js
case 'check-cwd': {
  const r = checkCwd(msg.path);
  try { ws.send(JSON.stringify({ type: 'check-cwd-result', path: msg.path, exists: r.exists, isDirectory: r.isDirectory, error: r.error })); } catch { /* noop */ }
  break;
}
case 'mkdir-cwd': {
  const r = mkdirCwd(msg.path);
  try { ws.send(JSON.stringify({ type: 'mkdir-cwd-result', path: msg.path, ok: r.ok, error: r.error })); } catch { /* noop */ }
  break;
}
```

The `try { ws.send(...) } catch { /* noop */ }` guard is the project's defensive idiom for "client may have disappeared between the request and our reply." D-09's broadcast does NOT need this guard — `sessions.broadcast` already filters by `readyState === 1` (`sessions.js:38`).

#### 1c. Close-handler extension precedent (`handlers.js:658`)

Existing line:

```js
ws.on('close', () => sessions.clients.delete(ws));
```

D-09 extends this to:

```js
ws.on('close', () => {
  sessions.clients.delete(ws);
  sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
});
```

**Note:** there are TWO `ws.on('close', …)` handlers on the same socket in `onConnection`: the heartbeat-cleanup at line 270 (`ws.on('close', () => clearInterval(heartbeat))`) and the clients-delete at line 658. Both fire. D-09's broadcast goes in the line-658 handler for locality with the `delete(ws)`.

#### 1d. Deletion analog — what gets cut

The 5 `case 'remote.*':` arms in this file (`handlers.js:601-650`) all share a shape: each does an `execFile` against the `clideck-remote` CLI and replies with a `remote.*` frame. They have no other consumer beyond this switch + the deleted modal driver in `app.js`. Delete all five plus the `remoteCliEnv()` helper at `handlers.js:246-248` (no surviving caller after the case-arm deletions). Lines 46–98 (`remoteUpdateCache` etc.) and `checkRemoteUpdate(ws)` go too; KEEP `compareVersions`, `parseVersion`, `getInstalledVersion` — they're called by `checkAvailability()` at handlers.js:102-111. See RESEARCH.md §1a for the verified inventory.

---

### 2. `sessions.js` — replace `resize` body with no-op (line 368)

**Role:** session mutator (now no-op) | **Data flow:** request-response (absorbed)
**Analog:** the function itself + the project's `/* noop */` precedent across `handlers.js`.

#### 2a. Current code at `sessions.js:368`

```js
function resize(msg) { sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows); }
```

#### 2b. Existing `/* noop */` precedent in handlers.js (multiple sites)

The codebase already has a "swallow defensively" pattern for situations where action is intentionally skipped:

```js
// handlers.js:264
try { ws.terminate(); } catch { /* noop */ }

// handlers.js:268
try { ws.ping(); } catch { /* noop */ }

// handlers.js:288
try { ws.send(JSON.stringify({ type: 'pong', t: msg.t })); } catch { /* noop */ }
```

#### 2c. Splice for D-04

Per RESEARCH.md §3 the chosen approach is Option (a) — leave the function declaration AND the export AND the `case 'resize':` dispatch at `handlers.js:355` unchanged; only the body changes. Keep the underscore-prefix on the unused parameter to signal intent:

```js
// sessions.js:368 (replace existing one-line body)
function resize(_msg) {
  // PTY size is locked at session creation time (Phase 12 R2).
  // The `resize` message type stays accepted (older clients still send it)
  // but is a no-op server-side. Per-client viewport changes no longer
  // reshape the agent's terminal — clients visually scale or scroll
  // horizontally instead. See `.planning/2026-06-02-mobile-desktop-concurrent-access/`.
}
```

**Export unchanged** at `sessions.js:749`:

```js
module.exports = {
  clients, broadcast, addBroadcastListener, getSessions: () => sessions,
  create, createProgrammatic, resume, restart, input, resize, rename, setTheme, setMute, setProject, setPreview, close, pause, captureToken,
  ...
};
```

**Dispatch unchanged** at `handlers.js:355`:

```js
case 'resize':               sessions.resize(msg); break;
```

---

### 3. `public/index.html` — delete remote markup + extend `@media (max-width: 960px)`

**Role:** DOM markup + responsive CSS | **Data flow:** static
**Analog:** the existing `@media (max-width: 960px)` block at lines 60-127 (extend in-place per D-16).

#### 3a. Existing breakpoint block (lines 60-127) — extract the shape

```html
<style>
    ...
    @media (max-width: 960px) {
      #mobile-sidebar-backdrop {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 240;
        opacity: 0;
        pointer-events: none;
        background: color-mix(in srgb, var(--color-base) 78%, transparent);
        backdrop-filter: blur(10px);
        transition: opacity 0.22s ease;
      }
      #sidebar-shell {
        position: fixed;
        inset: 0 auto 0 0;
        z-index: 260;
        width: 100vw;
        max-width: 100vw;
        transform: translateX(calc(-100% - 16px));
        transition: transform 0.24s ease;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      }
      body.mobile-nav-open #sidebar-shell { transform: translateX(0); }
      body.mobile-nav-open #mobile-sidebar-backdrop { opacity: 1; pointer-events: auto; }
      /* ... mobile-nav-toggle, mobile-nav-close, nav-rail, sidebar, plugin-toolbar, empty, settings-overlay, folder-picker ... */
      #folder-picker > div { width: 100%; max-width: 420px; }
    }
</style>
```

#### 3b. Splice for D-16 / R6 (locked CSS from UI-SPEC §"Terminal pane overflow")

Inside the same `@media (max-width: 960px) { … }` block — append after `#folder-picker > div { width: 100%; max-width: 420px; }` at line 126, before the closing `}` at line 127:

```css
.term-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

**Why this CSS targets `.term-wrap`:** in `terminals.js:537-541` every terminal pane is built as:

```js
const el = document.createElement('div');
el.className = 'term-wrap';
el.style.backgroundColor = resolveTheme(themeId).background;
document.getElementById('terminals').appendChild(el);
```

So `.term-wrap` is the wrapper that hosts the xterm grid — adding `overflow-x: auto` on it lets phone viewports pan a too-wide grid into view without reshaping the PTY.

#### 3c. Deletions in `public/index.html`

| Lines | Construct | Action |
|-------|-----------|--------|
| 154-156 | `<button id="btn-remote">…</button>` (rail "Mobile Remote" launcher) | DELETE element |
| 249 | `<div class="text-slate-600">clideck remote version: <span id="version-remote" class="text-slate-500"></span></div>` | DELETE line (KEEP line 248 `version-clideck`) |
| 405-493 | `<!-- Remote modal -->` comment + entire `<div id="remote-modal">…</div>` block (true end is line 493, not ~480 as UI-SPEC said) | DELETE block |

The `<div class="flex-1"></div>` spacer at line 153 stays — it correctly pushes the theme/settings buttons to the rail bottom without `#btn-remote` between them.

---

### 4. `public/js/app.js` — add `case 'clients.count':` arm, delete remote arms

**Role:** WS message router | **Data flow:** event-driven (handler → state mutator → renderer)
**Analog:** `app.js:159-173` (`case 'sessions':`) — the closest "receive frame → iterate state.terms → reconcile DOM" pattern.

#### 4a. Existing `case 'sessions':` arm (`app.js:159-173`)

```js
case 'sessions':
  {
    const liveIds = new Set(msg.list.map(s => s.id));
    for (const id of [...state.terms.keys()]) {
      if (!liveIds.has(id)) removeTerminal(id);
    }
    msg.list.forEach(s => {
      addTerminal(s.id, s.name, s.themeId, s.commandId, s.projectId, s.muted, s.lastPreview, s.presetId, s.cwd);
      setHasToken(s.id, !!s.hasToken);
    });
    if (!state.active || !state.terms.has(state.active)) {
      if (msg.list.length) select(msg.list[0].id);
    }
  }
  break;
```

#### 4b. Simpler analog — `case 'session.token':` (`app.js:207-213`)

For a single-line "update state, no iteration" pattern — closer to what D-10 needs:

```js
case 'session.token':
  // Server captured a session token for this id. Flip the entry's
  // hasToken flag so the next open of the menu shows Pause as
  // enabled. (No live re-render of an already-open menu — the
  // user can close and reopen.)
  setHasToken(msg.id, !!msg.hasToken);
  break;
```

#### 4c. Splice for D-10 — new `case 'clients.count':`

Add after the `case 'closed':` arm at line 199-206 and before `case 'session.token':` at line 207, keeping the alphabetical-ish ordering:

```js
case 'clients.count':
  updateOtherClientIndicator(msg.count);
  break;
```

Where `updateOtherClientIndicator` is the new export from `terminals.js` (see §7c below). Import alongside the existing `addTerminal, removeTerminal, setHasToken, …` import block from `./terminals.js` at the top of `app.js`.

#### 4d. Deletion analog — what the 7 `case 'remote.*':` arms look like

`app.js:437-461` (delete the whole block):

```js
case 'remote.status':
  handleRemoteStatus(msg);
  break;
case 'remote.paired':
  handleRemotePaired(msg);
  break;
case 'remote.unpaired':
  handleRemoteUnpaired();
  break;
case 'remote.error':
  handleRemoteError(msg.error);
  break;
case 'remote.install.progress':
  appendInstallLog(msg.text);
  break;
case 'remote.install.done':
  handleInstallDone(msg.success);
  break;
case 'remote.update':
  remoteUpdateInfo = msg?.available ? msg : null;
  if (remotePreflight?.pending) {
    remotePreflight.updateSeen = true;
    finishRemotePreflight();
  }
  break;
```

Also delete the lone `send({ type: 'remote.status' });` inside `state.ws.onopen` at line 107 (this triggered the now-deleted server `case 'remote.status':`).

#### 4e. The big driver block (1523-1863)

Per RESEARCH.md the real end of the remote driver is line 1863, not 1816 as CONTEXT.md says. The next live line at 1865 is `initDrag();` which stays. The block contains: modal control, install spinner, install-failed log, `clideck-remote` install path, `handleRemoteStatus / handleRemotePaired / handleRemoteUnpaired / handleRemoteError / appendInstallLog / handleInstallDone / finishRemotePreflight` definitions, and the module-level identifiers `remoteUpdateInfo`, `remotePreflight`, `remoteStatusPoll`, `remoteLastStatus`, `btnRemote`, `remoteModal`, `remoteState`, `remoteInstalled`, `remoteModalOpen`. All disappear together.

---

### 5. `public/js/settings.js` — delete `version-remote` lines (preserve `version-clideck`)

**Role:** settings renderer | **Data flow:** DOM mutation
**Analog:** itself — `updateVersionFooter` at `settings.js:100-109`.

#### 5a. Current code at `settings.js:100-109`

```js
export function updateVersionFooter() {
  const el = document.getElementById('version-clideck');
  if (el) el.textContent = state.cfg.version || '';
  const remoteEl = document.getElementById('version-remote');
  if (remoteEl) remoteEl.textContent = state.remoteVersion || '';
  // The lower-left build tag is now part of the connection lozenge
  // (see app.js setStatusBadge). Just nudge it to re-render with the
  // freshest version string.
  if (typeof window.__refreshStatusBadge === 'function') window.__refreshStatusBadge();
}
```

#### 5b. Splice for R1 (lines 103-104 deleted)

```js
export function updateVersionFooter() {
  const el = document.getElementById('version-clideck');
  if (el) el.textContent = state.cfg.version || '';
  // The lower-left build tag is now part of the connection lozenge
  // (see app.js setStatusBadge). Just nudge it to re-render with the
  // freshest version string.
  if (typeof window.__refreshStatusBadge === 'function') window.__refreshStatusBadge();
}
```

The `getElementById('version-clideck')` pattern stays intact as the precedent for any future `getElementById('version-*')` reads.

---

### 6. `public/js/state.js` — delete `remoteVersion`, add `otherClientsConnected`

**Role:** module state literal | **Data flow:** static state
**Analog:** the literal itself at `state.js:1-14`.

#### 6a. Current literal

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

#### 6b. Splice

Delete `remoteVersion: null,` (line 13). Add `otherClientsConnected: false,` just before the closing `};`:

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
  otherClientsConnected: false,
};
```

#### 6c. Idiomatic flag precedent

Booleans-as-flags precedent in the codebase lives in `state.cfg.confirmClose` (`!== false`, settings.js:86) and `entry.working` (transient, used in `app.js:196` — `entry && !entry.working`). The new `state.otherClientsConnected` follows the boolean-flag idiom directly; no Map / no per-session bookkeeping (D-12 defers per-session presence).

---

### 7. `public/js/terminals.js` — indicator markup in both row templates + `updateOtherClientIndicator`

**Role:** session-row renderer | **Data flow:** DOM construction + reactive toggle
**Analogs:**
- **Slot+toggle precedent:** `.unread-dot hidden …` at `terminals.js:521` (the `hidden`-by-default-then-toggle pattern UI-SPEC wants us to replicate).
- **Indicator-as-template-string precedent:** `.session-status` at `terminals.js:519`.
- **Resumable-row template:** `buildResumableRow` at `terminals.js:1309-1336`.

#### 7a. Existing `addTerminal` row template (`terminals.js:509-526`) — full shape

```js
item.innerHTML = `
  <div class="session-icon w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden pointer-events-none" style="background:var(--color-session-icon-bg)">
    ${iconHtml(commandId)}
  </div>
  <div class="flex-1 min-w-0 pointer-events-none">
    <div class="flex items-baseline gap-2">
      <span class="name flex-1 font-semibold text-[13px] text-slate-200 truncate pointer-events-auto cursor-default">${esc(name)}</span>
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

**Key precedents:**
- `.unread-dot hidden …` (line 521) — single span, `hidden` Tailwind class as the default-invisible state, toggled by code elsewhere (`markUnread`). This is the EXACT pattern the new indicator follows.
- `.session-status` (line 519) — another empty span that gets its content driven from JS (Phase 5 working-indicator).
- `${esc(name)}` (line 515) — XSS-safe interpolation; the new indicator carries no user input so it can use a plain template literal.

#### 7b. Splice for R5 — indicator markup (locked by UI-SPEC; do NOT propose alternatives)

The UI-SPEC's "DOM contract" subsection locks the exact two-circle SVG. The splice point is between `.name` and `.session-time` on the top row (`terminals.js:514-517`). After the splice the row template's top-row segment reads:

```js
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
```

**Locked details — DO NOT vary** (UI-SPEC):
- Class list: `other-client-indicator` + `flex-shrink-0` + `text-amber-400` + `hidden` (conditional via the ternary so newly-added rows pick up current `state.otherClientsConnected`).
- `title` and `aria-label`: literally `"Another client is connected"` — do not paraphrase.
- SVG: two `<circle>` elements with `cx="6"/"10"` `cy="8"` `r="3.5"`, `stroke-width="1.5"`, `aria-hidden="true"`.
- Parent gap is `gap-2` (already there).

#### 7c. New export — `updateOtherClientIndicator(count)`

Idiomatic shape based on `focusTerminal` (`terminals.js`) — small named export, single responsibility:

```js
// public/js/terminals.js — add adjacent to focusTerminal export
export function updateOtherClientIndicator(count) {
  state.otherClientsConnected = count > 1;
  document.querySelectorAll('.other-client-indicator').forEach(el => {
    el.classList.toggle('hidden', !state.otherClientsConnected);
  });
}
```

Symmetry with existing helpers: `focusTerminal(id)` is exported from terminals.js and consumed by `app.js`; `updateOtherClientIndicator(count)` follows the same pattern, also consumed by `app.js`'s new `case 'clients.count':` arm (§4c).

#### 7d. Splice for R5 in `buildResumableRow` (`terminals.js:1309-1336`)

Existing top row at `terminals.js:1322-1325`:

```js
<div class="flex items-baseline gap-2">
  <span class="resumable-name flex-1 font-semibold text-[13px] text-slate-400 truncate">${esc(s.name)}</span>
  <span class="text-[11px] text-slate-600 flex-shrink-0">${time}</span>
</div>
```

Splice the identical indicator span between `.resumable-name` and the timestamp:

```js
<div class="flex items-baseline gap-2">
  <span class="resumable-name flex-1 font-semibold text-[13px] text-slate-400 truncate">${esc(s.name)}</span>
  <span class="other-client-indicator${state.otherClientsConnected ? '' : ' hidden'} flex-shrink-0 text-amber-400"
        title="Another client is connected"
        aria-label="Another client is connected">
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="6" cy="8" r="3.5"/>
      <circle cx="10" cy="8" r="3.5"/>
    </svg>
  </span>
  <span class="text-[11px] text-slate-600 flex-shrink-0">${time}</span>
</div>
```

#### 7e. D-15 contingency hook (DO NOT enable unless D-13 fails)

Adjacent to `el.addEventListener('click', onWrapClick)` at `terminals.js:716`:

```js
const onWrapClick = () => focusTerminal(id);
el.addEventListener('click', onWrapClick);
// D-15 contingency — only enable if D-13 mobile-touch verification fails.
// Forces touchstart to land focus on .xterm-helper-textarea when click
// alone doesn't fire the soft-keyboard handshake.
// el.addEventListener('touchstart', () => focusTerminal(id), { passive: true });
```

Leave commented per default; uncomment only if `e2e/mobile-touch.spec.js` fails.

---

### 8. `public/tailwind.css` — rebuild for `text-amber-400`

**Role:** build artifact | **Data flow:** static CSS
**Analog:** the existing build pipeline (`tailwind.config.js` + `npm run build:css`).

#### 8a. `tailwind.config.js` (full file — 7 lines)

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {},
  },
};
```

The `content` glob scans all `.html` and `.js` under `public/`, so once `text-amber-400` first appears inside the terminals.js template literal at §7b, the next `npm run build:css` run will include the rule. Verified `grep` against the current minified `public/tailwind.css` returns ZERO matches for `amber-400` — confirming RESEARCH.md G11 / A1.

#### 8b. Plan task

After the terminals.js splice in §7b lands, run `npm run build:css` (the script from package.json: `tailwindcss -i src/input.css -o public/tailwind.css --minify`) so the new utility class compiles into the production CSS. Commit `public/tailwind.css` alongside the JS change.

**Fallback (only if rebuild fails for any reason):** swap `class="… text-amber-400"` for inline `style="color:#FBBF24"` in both splice sites (§7b and §7d). This bypasses Tailwind entirely. UI-SPEC §"Cross-mode … contingency" notes a similar swap-to-`text-amber-500` rule for light-mode contrast borderline cases.

---

### 9. `tests/sessions-resize.test.js` (NEW) — vitest unit, R2 server no-op

**Role:** unit test (server module) | **Data flow:** mutator + spy
**Analog:** `tests/session-pause.test.js` (closest fit — same env, same module-fresh + captureClient idiom, same direct-call-then-assert pattern).

#### 9a. Bootstrap shape from `session-pause.test.js:1-57`

```js
// @vitest-environment node
//
// [Description block: what the test pins and why]

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, readFileSync } from 'fs';

let TEST_DATA_DIR;

function freshSessionsModule() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require('path').sep}clideck${require('path').sep}`) &&
        !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../sessions.js');
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-pause-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

function captureClient(sessions) {
  const recorded = [];
  const fake = {
    readyState: 1,
    send: (raw) => recorded.push(JSON.parse(raw)),
  };
  sessions.clients.add(fake);
  return { fake, recorded };
}
```

#### 9b. Fake-session-with-spy precedent (`session-pause.test.js:77-87`)

```js
function fakeLiveSession({ id = 'sess-X', name = 'Alpha', commandId = 'claude', token = 'tok-aaa' } = {}) {
  return {
    name, themeId: 'default', commandId, presetId: 'claude-code',
    cwd: 'C:\\projects\\x', sessionToken: token,
    projectId: null, muted: false, ephemeral: false,
    pty: { kill: vi.fn() },
    chunks: [], chunksSize: 0,
    lastPreview: 'last output line', lastActivityAt: '2026-05-20T11:00:00.000Z',
    roleName: null,
  };
}
```

For R2 the spy target is `pty.resize` (not `pty.kill`). Shape:

```js
function fakeLiveSession({ id = 'sess-X' } = {}) {
  return {
    name: 'A', sessionToken: null,
    pty: { resize: vi.fn() },
  };
}
```

#### 9c. Test body shape (R2 — assert resize spy was NOT called)

```js
describe('sessions.resize — locked at session creation (Phase 12 R2)', () => {
  it('does NOT call pty.resize when a resize message arrives', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    const s = fakeLiveSession({ id: 'sess-A' });
    map.set('sess-A', s);

    sessions.resize({ id: 'sess-A', cols: 40, rows: 10 });

    expect(s.pty.resize).not.toHaveBeenCalled();
  });

  it('does not throw for an unknown session id', () => {
    const sessions = freshSessionsModule();
    expect(() => sessions.resize({ id: 'ghost', cols: 80, rows: 24 })).not.toThrow();
  });
});
```

---

### 10. `tests/other-client-indicator.test.js` (NEW) — vitest unit, R5 DOM toggle

**Role:** unit test (DOM env) | **Data flow:** DOM toggle
**Analog:** `tests/terminal-focus.test.js` (same `@vitest-environment happy-dom`, same `import { focusTerminal } from '../public/js/terminals.js'` shape, same `state.terms.clear() + document.body.innerHTML=''` setup).

#### 10a. Bootstrap shape from `terminal-focus.test.js:1-25`

```js
// @vitest-environment happy-dom
//
// [Description block: what the test pins and why]

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../public/js/state.js';
import { focusTerminal } from '../public/js/terminals.js';

beforeEach(() => {
  state.terms.clear();
  document.body.innerHTML = '';
});
```

#### 10b. Test body shape — assert `updateOtherClientIndicator` toggles `.hidden`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../public/js/state.js';
import { updateOtherClientIndicator } from '../public/js/terminals.js';

beforeEach(() => {
  state.otherClientsConnected = false;
  document.body.innerHTML = '';
});

describe('updateOtherClientIndicator', () => {
  it('removes .hidden from every .other-client-indicator when count > 1', () => {
    document.body.innerHTML = `
      <span class="other-client-indicator hidden"></span>
      <span class="other-client-indicator hidden"></span>
    `;
    updateOtherClientIndicator(2);
    expect(state.otherClientsConnected).toBe(true);
    for (const el of document.querySelectorAll('.other-client-indicator')) {
      expect(el.classList.contains('hidden')).toBe(false);
    }
  });

  it('restores .hidden on every .other-client-indicator when count <= 1', () => {
    document.body.innerHTML = `
      <span class="other-client-indicator"></span>
      <span class="other-client-indicator"></span>
    `;
    state.otherClientsConnected = true;
    updateOtherClientIndicator(1);
    expect(state.otherClientsConnected).toBe(false);
    for (const el of document.querySelectorAll('.other-client-indicator')) {
      expect(el.classList.contains('hidden')).toBe(true);
    }
  });

  it('is a no-op when no indicators exist in the DOM', () => {
    expect(() => updateOtherClientIndicator(2)).not.toThrow();
    expect(state.otherClientsConnected).toBe(true);
  });
});
```

The `state.otherClientsConnected` reset in `beforeEach` is important because `state.js` is a module-singleton across tests (same pattern that `display-sizing.test.js:49-56` uses with `state.terms.clear()` and `state.cfg = {commands: []}`).

---

### 11. `e2e/clideck-remote-deletion.spec.js` (NEW) — Playwright, R1 verification

**Role:** E2E smoke regression | **Data flow:** DOM absence + console.error gate
**Analog:** `e2e/smoke.spec.js` (same `pageerror` + `console.error` listener pattern at lines 57-61; same `installWsRecorder` + `waitForAppReady` helpers).

#### 11a. Bootstrap shape from `smoke.spec.js:14-53`

```js
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
  await expect.poll(
    async () => page.evaluate(() => Array.from(/** @type {any} */ (window).__rxTypes || [])),
    { timeout: 10_000, intervals: [100, 200, 500] }
  ).toEqual(expect.arrayContaining(['config', 'sessions', 'presets']));
}
```

#### 11b. Error-gate precedent (`smoke.spec.js:56-75`)

```js
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
```

#### 11c. Splice for R1 verification

Same shape, asserting absence rather than presence:

```js
test('R1 — deleted remote DOM elements are absent + no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await installWsRecorder(page);
  await page.goto('/');
  await waitForAppReady(page);

  await expect(page.locator('#btn-remote')).toHaveCount(0);
  await expect(page.locator('#remote-modal')).toHaveCount(0);
  await expect(page.locator('#version-remote')).toHaveCount(0);

  expect(errors).toEqual([]);
});
```

---

### 12. `e2e/pty-size-locked.spec.js` (NEW) — Playwright, R2 end-to-end

**Role:** E2E WS-driven assertion | **Data flow:** WS send + xterm internal poll
**Analog:** `e2e/session-indicator-mutex.spec.js` (the full WS recorder + `spawnSession` + `dispatchSessionStatus` synthetic-event idiom).

#### 12a. `spawnSession` precedent (`session-indicator-mutex.spec.js:69-88`)

```js
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
```

**Note:** R2 needs `spawnSession` parameterised by cols/rows. Inline the 120×30 spawn or extend `spawnSession(page, { cols, rows })`.

#### 12b. Sending arbitrary WS messages (`session-indicator-mutex.spec.js:69-73` shape — direct WS send)

```js
await page.evaluate(() => {
  /** @type {any} */ const w = window;
  w.__ws.send(JSON.stringify({ type: 'create', cols: 80, rows: 24 }));
});
```

For R2: send a hand-crafted resize after the session is created:

```js
await page.evaluate(({ id }) => {
  /** @type {any} */ const w = window;
  w.__ws.send(JSON.stringify({ type: 'resize', id, cols: 40, rows: 10 }));
}, { id: sessionId });
```

#### 12c. Reading xterm internals — `state.terms`

`state.terms` is the `Map<id, entry>` where `entry.term` is the xterm `Terminal` instance (see `terminals.js:542-554`). Read `term.cols` directly:

```js
const cols = await page.evaluate(async ({ id }) => {
  const { state } = await import('/js/state.js');
  return state.terms.get(id)?.term.cols;
}, { id: sessionId });
expect(cols).toBe(120);
```

**Note:** the dynamic `import('/js/state.js')` path may need verification at exec time — alternatively use `expect.poll` against a setTimeout to allow re-fit to settle. RESEARCH.md §3 says the test must show `term.cols === 120` after sending the malicious resize, proving the server didn't reshape the PTY.

---

### 13. `e2e/mobile-touch.spec.js` (NEW) — Playwright mobile context, R3 verification

**Role:** E2E mobile-context | **Data flow:** touch event + active-element poll
**Analog:** **No mobile-context precedent in this repo.** Derive the shape from Playwright docs (`browser.newContext({ ...devices['iPhone 12'] })`) and reuse the helpers from `smoke.spec.js`.

#### 13a. Mobile-context shape (RESEARCH.md §6 / §8 confirmed)

```js
const { test, expect, devices } = require('@playwright/test');

test('R3 — tap on terminal pane focuses xterm helper textarea', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] }); // 390×844, isMobile, hasTouch
  const page = await ctx.newPage();
  await installWsRecorder(page);
  await page.goto('/');
  await waitForAppReady(page);

  const id = await spawnSession(page);
  await page.locator(`.group[data-id="${id}"]`).tap();
  await page.locator('.term-wrap').first().tap();

  const focused = await page.evaluate(() =>
    document.activeElement?.classList?.contains('xterm-helper-textarea')
  );
  expect(focused).toBe(true);

  await ctx.close();
});
```

#### 13b. Helper reuse

Copy `installWsRecorder`, `waitForAppReady`, `spawnSession` verbatim from `e2e/session-indicator-mutex.spec.js:29-88`. The planner may want to extract these into `e2e/helpers.js` if duplication grows, but that's optional cleanup (no precedent in repo for shared helpers).

---

### 14. `e2e/concurrent-input.spec.js` (NEW) — Playwright two-context, R4 + R5

**Role:** E2E two-context | **Data flow:** two parallel WS streams + indicator visibility poll
**Analog:** **No two-context precedent in this repo.** Derive: two parallel `browser.newContext()` calls, each running the single-context shape from `session-indicator-mutex.spec.js`. The `playwright.config.js` `workers: 1` + `fullyParallel: false` is what makes two contexts share the same server.

#### 14a. Single-context-shape precedent (`session-indicator-mutex.spec.js:120-139`)

```js
test('working session does NOT show unread dot while busy', async ({ page }) => {
  await installWsRecorder(page);
  await page.goto('/');
  await waitForAppReady(page);

  const a = await spawnSession(page);
  const b = await spawnSession(page);
  await page.locator(`.group[data-id="${b}"]`).click();

  await dispatchSessionStatus(page, a, true);
  await dispatchOutput(page, a, 'building...\r\n');

  expect(await isDotHidden(page, a)).toBe(true);
});
```

#### 14b. Two-context derivation (RESEARCH.md §7)

```js
test('R4 — two clients concurrently attach to one session', async ({ browser }) => {
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

  const sessionId = await spawnSession(pageA);
  await expect(pageB.locator(`.group[data-id="${sessionId}"]`)).toBeVisible({ timeout: 5_000 });
  await pageA.locator(`.group[data-id="${sessionId}"]`).click();
  await pageB.locator(`.group[data-id="${sessionId}"]`).click();

  // Inject input from both contexts via WS to bypass xterm focus races.
  await pageA.evaluate(({ id }) => {
    /** @type {any} */ const w = window;
    w.__ws.send(JSON.stringify({ type: 'input', id, data: 'echo A\r' }));
  }, { id: sessionId });
  await pageB.evaluate(({ id }) => {
    /** @type {any} */ const w = window;
    w.__ws.send(JSON.stringify({ type: 'input', id, data: 'echo B\r' }));
  }, { id: sessionId });

  // Both contexts should observe both letters in the rx output stream.
  for (const p of [pageA, pageB]) {
    await expect.poll(async () => p.evaluate(() => {
      /** @type {any} */ const w = window;
      const outs = w.__rxMessages.filter(m => m.type === 'output').map(m => m.data || '').join('');
      return { hasA: /\bA\b/.test(outs), hasB: /\bB\b/.test(outs) };
    }), { timeout: 5_000 }).toEqual({ hasA: true, hasB: true });
  }

  await ctxA.close();
  await ctxB.close();
});
```

#### 14c. R5 indicator visibility — same file, separate test

Use the same two-context setup; assert the indicator on Tab A appears after Tab B connects, disappears after Tab B closes. The single-source-of-truth state flag (`state.otherClientsConnected`) is what gets toggled by the WS `clients.count` broadcast, so the test polls `.other-client-indicator:not(.hidden)`:

```js
test('R5 — indicator appears on Tab A when Tab B connects, disappears on close', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await installWsRecorder(pageA);
  await pageA.goto('/');
  await waitForAppReady(pageA);
  const sessionId = await spawnSession(pageA);

  // Before B connects: indicator hidden on A.
  await expect(pageA.locator(`.group[data-id="${sessionId}"] .other-client-indicator`)).toHaveClass(/\bhidden\b/);

  // B connects → broadcast lifts the indicator on A within 5s.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await installWsRecorder(pageB);
  await pageB.goto('/');
  await waitForAppReady(pageB);

  await expect(pageA.locator(`.group[data-id="${sessionId}"] .other-client-indicator`))
    .not.toHaveClass(/\bhidden\b/, { timeout: 5_000 });

  // B disconnects → indicator hides on A within 10s.
  await ctxB.close();
  await expect(pageA.locator(`.group[data-id="${sessionId}"] .other-client-indicator`))
    .toHaveClass(/\bhidden\b/, { timeout: 10_000 });

  await ctxA.close();
});
```

---

### 15. `e2e/mobile-viewport.spec.js` (NEW) — Playwright mobile context, R6 walkthrough

**Role:** E2E mobile-context | **Data flow:** viewport math + sequential walkthrough
**Analog:** same mobile-context idiom as `e2e/mobile-touch.spec.js` (§13).

#### 15a. Body-overflow assertion (RESEARCH.md §6)

```js
test('R6 — no page-body horizontal overflow at iPhone 12 viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await ctx.newPage();
  await installWsRecorder(page);
  await page.goto('/');
  await waitForAppReady(page);

  const overflows = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);

  await expect(page.locator('#mobile-nav-toggle')).toBeVisible();
  await ctx.close();
});
```

#### 15b. Sequential walkthrough (R6 acceptance criterion)

```js
test('R6 — mobile walkthrough: load → switch → tap → sidebar → create → delete', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await ctx.newPage();
  await installWsRecorder(page);
  await page.goto('/');
  await waitForAppReady(page);

  // create → terminal opens
  const id = await spawnSession(page);
  await expect(page.locator(`.group[data-id="${id}"]`)).toBeVisible();

  // sidebar toggle
  await page.locator('#mobile-nav-toggle').tap();
  await expect(page.locator('body.mobile-nav-open')).toHaveCount(1);
  await page.locator('#mobile-nav-close').tap();
  await expect(page.locator('body.mobile-nav-open')).toHaveCount(0);

  // assert no horizontal page overflow at each step
  const overflows = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);

  await ctx.close();
});
```

`#mobile-nav-toggle` and `#mobile-nav-close` are existing IDs (`public/index.html:93-118`); `body.mobile-nav-open` is the class toggled by `app.js:496` per CONTEXT.md "Existing Code Insights."

---

## Shared Patterns

### Shared 1 — WS message → handler-case → mutator/broadcast (server)

**Source:** `handlers.js:282-655` (entire `ws.on('message', …)` switch)
**Apply to:** `handlers.js` modifications (D-09 broadcast wiring, deletion of remote arms).

Every state-changing client message in this codebase follows: client `send({type})` → `case` in `handlers.js` switch → call `sessions.{mutator}` → `sessions.broadcast` fans to all clients. The new `clients.count` broadcast is **server-internal** (triggered by connect/disconnect, not by a client message) so it skips the case-arm step and goes directly to broadcast. See §1a-c for splice details.

### Shared 2 — `state.X = value` then DOM toggle (client)

**Source:** `app.js` `case 'session.token':` (line 207-213) — receive frame, mutate state, no per-frame iteration.
**Apply to:** `app.js` `case 'clients.count':` arm (§4c).

The new arm is the simplest possible WS handler: `updateOtherClientIndicator(msg.count)` which itself sets the flag and toggles the class. No re-render needed because `addTerminal` / `buildResumableRow` read `state.otherClientsConnected` at construction time.

### Shared 3 — `.hidden` Tailwind class as the toggleable slot

**Source:** `.unread-dot hidden …` at `terminals.js:521` and `#mobile-nav-close { opacity: 0; pointer-events: none; }` style flips at `public/index.html:90-92`.
**Apply to:** the new `.other-client-indicator hidden …` markup in §7b and §7d.

The codebase's standard reactive-toggle idiom is: render the element with the `hidden` class by default, mutate that one class from JS. Avoids re-rendering, avoids per-row state. The `updateOtherClientIndicator` helper in §7c implements this idiom directly.

### Shared 4 — `try { ... } catch { /* noop */ }` defensive guard

**Source:** `handlers.js:264,268,288,363,368` — defensive `ws.send` wraps in `try {} catch { /* noop */ }`.
**Apply to:** No new code needs this in Phase 12, but the `sessions.broadcast` fan-out already guards via `if (c.readyState === 1)` at `sessions.js:38`. Documented here so the planner doesn't accidentally add a redundant try/catch around the new `clients.count` broadcast.

### Shared 5 — vitest test harness (server-side, `@vitest-environment node`)

**Source:** `tests/session-pause.test.js:1-57`, `tests/session-token-capture.test.js:1-52`, `tests/resumable-handlers.test.js:1-54`.
**Apply to:** `tests/sessions-resize.test.js` (§9).

The shared bootstrap shape:
- `// @vitest-environment node` directive on line 1
- `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';`
- `freshSessionsModule()` helper to wipe `require.cache` between tests
- `beforeEach` / `afterEach` that create + tear down `CLIDECK_DATA_DIR` tmpdir
- `captureClient(sessions)` helper that adds a fake `{ readyState: 1, send: raw => recorded.push(JSON.parse(raw)) }` to `sessions.clients`

### Shared 6 — vitest test harness (happy-dom, `@vitest-environment happy-dom`)

**Source:** `tests/terminal-focus.test.js:1-25`, `tests/display-sizing.test.js:1-56`.
**Apply to:** `tests/other-client-indicator.test.js` (§10).

The shared bootstrap shape:
- `// @vitest-environment happy-dom` directive on line 1
- `import { describe, it, expect, beforeEach } from 'vitest';`
- `import { state } from '../public/js/state.js';`
- `import { someExport } from '../public/js/someModule.js';`
- `beforeEach` that clears `state.terms`, resets relevant `state.*` flags, sets `document.body.innerHTML = ''`

### Shared 7 — Playwright single-context harness

**Source:** `e2e/smoke.spec.js:14-53` (installWsRecorder + waitForAppReady) and `e2e/session-indicator-mutex.spec.js:29-88` (the same two + spawnSession + dispatch helpers).
**Apply to:** every new spec in §11-§15.

Copy verbatim. There is no shared `e2e/helpers.js` file in the repo today — every spec inlines its own copy of these helpers (verified: `smoke.spec.js` and `session-indicator-mutex.spec.js` both define `installWsRecorder` and `waitForAppReady` independently). The planner may want to factor these out into `e2e/helpers.js` to reduce 5x duplication; flagged as optional cleanup, not blocking.

### Shared 8 — `webServer` + `TEST_HOME` test isolation

**Source:** `playwright.config.js:1-49`.
**Apply to:** All new Playwright specs — they pick up port 4099, isolated `TEST_HOME`, `workers: 1`, `fullyParallel: false` automatically.

Key for R4's two-context test: `workers: 1` + `fullyParallel: false` means both contexts run inside the SAME `node server.js` process, so they observably share `sessions.clients`.

---

## No Analog Found

| File | Role | Data Flow | Reason | Mitigation |
|------|------|-----------|--------|-----------|
| `e2e/mobile-touch.spec.js` | E2E mobile-context | touch + activeElement | No mobile-context E2E exists in this repo yet | Derive shape from Playwright `devices['iPhone 12']` docs (RESEARCH.md §6 / §8); reuse single-context helpers from smoke.spec.js |
| `e2e/concurrent-input.spec.js` | E2E two-context | two parallel WS streams | No two-context E2E exists in this repo yet | Derive: instantiate two `browser.newContext()` in parallel, run the single-context spawnSession/dispatch shape from session-indicator-mutex.spec.js inside each (RESEARCH.md §7) |
| `e2e/mobile-viewport.spec.js` | E2E mobile-context | viewport math + walkthrough | Same mobile-context gap as mobile-touch.spec.js | Same Playwright `devices` derivation |

None of these gaps are blockers — Playwright's mobile-context and multi-context APIs are first-party and well-documented; RESEARCH.md §6-§8 lay out the concrete shapes. Flag as the only spots where the planner derives from external docs rather than copying from existing repo code.

---

## Insertion-Point Quick Reference (for the executor)

| File | Line | Action |
|------|------|--------|
| `handlers.js` | 46-98 | Delete `remoteUpdateCache`, `remoteUpdateCheckedAt`, `REMOTE_UPDATE_INTERVAL`, `checkRemoteUpdate` (KEEP `compareVersions`, `parseVersion`, `getInstalledVersion`) |
| `handlers.js` | 246-248 | Delete `remoteCliEnv()` (no surviving callers) |
| `handlers.js` | 252 (after `sessions.clients.add(ws)`) | ADD `sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });` |
| `handlers.js` | 601-650 | Delete 5 `case 'remote.*':` arms (status, pair, unpair, getHistory, install) |
| `handlers.js` | 658 | EXTEND `ws.on('close', …)` to broadcast `clients.count` after `delete` |
| `sessions.js` | 368 | REPLACE body with no-op |
| `public/index.html` | 60-127 | EXTEND existing `@media (max-width: 960px)` block — add `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }` |
| `public/index.html` | 154-156 | DELETE `<button id="btn-remote">…</button>` |
| `public/index.html` | 249 | DELETE `<div>clideck remote version: <span id="version-remote">…</span></div>` line |
| `public/index.html` | 405-493 | DELETE entire `<!-- Remote modal -->` `<div id="remote-modal">…</div>` block |
| `public/js/app.js` | 107 | DELETE `send({ type: 'remote.status' });` |
| `public/js/app.js` | 199-206 (after `case 'closed':`) | ADD `case 'clients.count': updateOtherClientIndicator(msg.count); break;` |
| `public/js/app.js` | 437-461 | DELETE 7 `case 'remote.*':` arms |
| `public/js/app.js` | 1523-1863 | DELETE entire remote driver block (next live line `initDrag();` at 1865 stays) |
| `public/js/app.js` | top imports | ADD `updateOtherClientIndicator` to existing `terminals.js` import |
| `public/js/settings.js` | 103-104 | DELETE `version-remote` block |
| `public/js/state.js` | 13 | DELETE `remoteVersion: null,` |
| `public/js/state.js` | before closing `};` | ADD `otherClientsConnected: false,` |
| `public/js/terminals.js` | 514-517 (between `.name` and `.session-time`) | INSERT locked `<span class="other-client-indicator …">…</span>` markup |
| `public/js/terminals.js` | 1322-1325 (between `.resumable-name` and timestamp) | INSERT same locked markup |
| `public/js/terminals.js` | adjacent to `focusTerminal` export | ADD `export function updateOtherClientIndicator(count)` |
| `public/tailwind.css` | (entire file) | REBUILD via `npm run build:css` after terminals.js splice lands |

---

## Metadata

**Analog search scope:** `/handlers.js`, `/sessions.js`, `/public/index.html`, `/public/js/*.js`, `/tests/*.test.js`, `/e2e/*.spec.js`, `/playwright.config.js`, `/vitest.config.js`, `/tailwind.config.js`
**Files scanned:** 17 (every file in the modification list + every existing test/spec)
**Files Read with line excerpts:** 15
**Pattern extraction date:** 2026-06-02

---

## PATTERN MAPPING COMPLETE

**Phase:** 12 - mobile-desktop-concurrent-access
**Files classified:** 14 (7 modified + 7 new)
**Analogs found:** 14 / 14 (11 exact + 3 derived from Playwright docs)

### Coverage
- Files with exact in-repo analog: 11
- Files with role-match analog: 0
- Files with no in-repo analog (derived from external docs): 3 (all three mobile-context / two-context E2E specs)

### Key Patterns Identified
- All server message dispatch follows: case-arm → `sessions.{mutator}` → `sessions.broadcast` (fan-out via `c.readyState === 1` guard).
- `.hidden` Tailwind class is the project's standard reactive-toggle slot (precedent: `.unread-dot`, `#mobile-nav-close`).
- Vitest server-side tests use `@vitest-environment node` + `freshSessionsModule()` + `captureClient()`; vitest client-side use `@vitest-environment happy-dom` + import-from-state.js.
- Playwright specs inline `installWsRecorder` + `waitForAppReady` + `spawnSession` helpers per file (no shared `e2e/helpers.js` exists).
- `playwright.config.js` `workers: 1` + `fullyParallel: false` makes two-context tests viable (both contexts share one server process).

### File Created
`/home/clideck/projects/clideck/.planning/2026-06-02-mobile-desktop-concurrent-access/15-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog code directly in PLAN.md actions — every modification has a concrete file:line excerpt to copy from, every new file has a concrete bootstrap shape from an existing test/spec.
