# Phase 16: Device pairing — Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 18 (5 server edits, 4 server new, 6 client new/edits, 3 test new)
**Analogs found:** 18 / 18
**Branch in scope:** `main` (HEAD) — Phase 15 (`feat/mobile-desktop-concurrent-access`) flagged for merge-order in §3 below.

Project conventions inherited from `/home/clideck/.claude/CLAUDE.md` §1 (verify
before claiming done), §5 (verbose commit messages on personal projects),
§14 (demand elegance — name hacks out loud). Every line citation below was
verified with `Read` or `Grep` before quoting; no fabricated line numbers.

---

## §1 — New artifact → existing analog (one row per file/edit)

| New / edited artifact | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| **`handlers.js`** — `onConnection` auth gate (before `sessions.clients.add(ws)`) | server, ws-upgrade | request-response | `handlers.js:266-296` `onConnection` body (heartbeat install + initial sends) | exact role, the splice IS here |
| **`handlers.js`** — `validateDeviceToken(rawToken)` helper | server, utility | sync transform | `handlers.js:51-71` `compareVersions` / `parseVersion` / `getInstalledVersion` (sync, returns string or normalized value, falls through on error) | exact shape |
| **`handlers.js`** — `attachWsDeviceMeta(ws, dev)` (sets `ws.deviceTokenHash`, `ws.deviceId`) | server, per-conn annotation | request-response | `handlers.js:275-276` `ws.isAlive = true; ws.on('pong', …)` (existing per-connection ad-hoc property on the `ws` object) | exact shape |
| **`server.js`** — wire `handleProtocols` into `new WebSocketServer({…})` | server, ws-construction | request-response | `server.js:366-371` `const wss = new WebSocketServer({ server, verifyClient: ({ req }) => isAllowedWsOrigin(...) })` — `verifyClient` is the sibling option of `handleProtocols`; same constructor, same callback-on-upgrade shape | exact (same constructor) |
| **`server.js`** — `GET /pair` static page handler | server, static | request-response | `server.js:332-340` `/plugins/<id>/…` static-resolve block + the unified fallback at `server.js:342-349` `(req.url === '/' ? 'index.html' : req.url)` static-file serving | exact role (a sibling static-page route) |
| **`server.js`** — `POST /pair/redeem` JSON handler (UNAUTHENTICATED) | server, JSON RPC | request-response | `server.js:246-249` `/api/session/ask` dispatcher → `session-ask.js:160-169` `handleHttp(req, res, sessionsApi)` (with `readJson` / `sendJson` / `jsonError` helpers at `session-ask.js:7-33`) | exact — copy the dispatcher line + delegate to a new `pair.js` file with the same `handleHttp` shape |
| **`server.js`** — `POST /pair/mint-otp` JSON handler (AUTHENTICATED via paired-WS-state OR loopback) | server, JSON RPC | request-response | Same as above. Auth check: `session-ask.js:36-39` `isLoopback(req)` is the project's only existing auth-style guard on an HTTP route — for the WS-token-based auth on `/pair/mint-otp`, the closest analog is the new auth gate in `handlers.js` itself (the helper from row 2). Use it. | partial — the existing pattern uses loopback; a header-based device-token re-check is a Phase-16-novel addition. Document this explicitly. |
| **`handlers.js`** — `device.list` / `device.revoked` broadcast arms | server, ws-broadcast | pub-sub | `handlers.js:669` `sessions.broadcast({ type: 'plugins', list: plugins.getInfo() })` (broadcasts a fresh list to every connected client after a mutation) — direct shape match. Phase 15 also uses this idiom (`{type:'clients.count', count:sessions.clients.size}`) but that is NOT on main yet (see §3). | exact (use `plugins` broadcast as the analog) |
| **`sessions.js`** — revoke-closes-socket iterator | server, ws-iteration | event-driven | `sessions.js:53-55` `function broadcast(msg) { … for (const c of clients) if (c.readyState === 1) c.send(raw); … }` — the ONLY existing iteration over `clients`. Identical shape, just substitute `c.send(raw)` for `c.close(4401, 'revoked')`. | exact |
| **`sessions.js`** — expose `clients` Set as a `module.exports` member (if not already) | server, module API | n/a | `sessions.js:885-889` `module.exports = { … clients, broadcast, addBroadcastListener, … }` — `clients` is already exported (`handlers.js:267` does `sessions.clients.add(ws)`), no change needed to the export | exact — already wired |
| **NEW `.clideck/devices.json`** + atomic-write helper | server, persistence | file-I/O | `sessions.js:705-768` `saveSessions(cfg)` + `loadSessions()` AND `config.js:217-219` `save(config)` — **NEITHER USES ATOMIC RENAME.** Both do plain `writeFileSync(PATH, JSON.stringify(data, null, 2))`. `paths.js` lays down `DATA_DIR = process.env.CLIDECK_DATA_DIR \|\| join(os.homedir(), '.clideck')` at `paths.js:5`. **Per CLAUDE.md §14 (demand elegance) call this out:** SPEC asks for atomic-rename, project precedent does not. The planner must pick one — see §2 template below. | role-match (NOT a literal-pattern copy) |
| **NEW `public/pair.html`** | client, standalone page | request-response | `public/index.html:1-9` head pattern (charset, title, favicon, `/xterm.css`, `/tailwind.css`) — copy lines 1-9, drop the xterm CSS (no terminal on the pair page), keep tailwind | exact head pattern |
| **NEW `public/js/pair.js`** | client, page logic | request-response | `public/js/state.js:21-30` `send(msg)` for the `fetch`-style payload-and-await pattern (no direct analog — the project has no other standalone-page JS). For form submission + redirect: closest is the Phase 10 creator pre-flight `creator.js:300-339` (POST-like dispatch via `send()`, `waitForResult`, then branch on result.ok). Document that `pair.js` stands relatively alone — it must use `fetch()` because the WebSocket isn't open yet pre-pair. | partial (document as standalone) |
| **EDIT `public/js/state.js`** — add `linkedDevices: []`, `deviceId: null` | client, state literal | n/a | `public/js/state.js:1-14` existing literal. Phase 15 added `otherClientsConnected: false` at `state.js:13` (on the feature branch, not main). On `main` the prior precedent is the original literal — copy that shape: comma-separated, with multi-line comments above each non-obvious field. | exact (mirror the Phase 15 add shape) |
| **EDIT `public/js/app.js`** — boot-time `localStorage` token check + WS subprotocol injection + 4401-close redirect | client, ws-construction | request-response | `public/js/app.js:104-118` `connect()` function (current WS construction) AND `app.js:484-498` `state.ws.onclose / onerror` (existing reconnect path — extend with the 4401 branch) | exact splice points |
| **EDIT `public/js/settings.js`** — `renderLinkedDevices()` + `device.list` ws-arm | client, render fn | pub-sub | `public/js/settings.js:89-99` `renderSettings()` (the dispatcher that calls every per-section render) + `settings.js:108-118` `renderFontSize()` (concrete render-from-state pattern) + `settings.js:133-142` `updateVersionFooter()` (DOM-write-from-state shape). For the new ws-arm: `public/js/app.js:407-408` `case 'plugins': loadPlugins(msg.list); break;` (one-liner that delegates to a render function — same shape) | exact |
| **EDIT `public/index.html`** — new "Linked devices" settings panel + nav button | client, markup | n/a | `public/index.html:233-247` settings-nav `<button class="settings-cat" data-cat="…">` triplet (General / CLI Agents / Notifications / Appearance — add a 5th `data-cat="devices"` button matching the existing class structure) AND `public/index.html:283-389` the four `<div id="settings-XXX" class="settings-panel hidden p-6 max-w-xl">` panels — add a 5th `<div id="settings-devices">` mirroring the General panel's plain-form structure | exact (one new nav button + one new panel) |
| **NEW revoke confirm-modal call** | client, modal | request-response | `public/js/creator.js:308-321` two-mode `confirmClose(message, '', { hideConfirm:true, cancelLabel:'OK' })` for info-only AND `creator.js:326-329` for 2-button destructive confirm. The Phase 10 extension contract is documented at `public/js/confirm.js:9-21` — copy the `opts.hideConfirm` / `opts.cancelLabel` signature directly. | exact |
| **NEW `tests/pair-otp.test.js`** | test, unit (server) | n/a | `tests/check-cwd-handler.test.js:1-42` — `// @vitest-environment node` directive, `freshHandlers()` require-cache wipe, `fakeWs()` EventEmitter factory, `beforeEach`/`afterEach` with `CLIDECK_DATA_DIR=mkdtempSync(...)` | exact |
| **NEW `tests/pair-redeem.test.js`** | test, unit (server, JSON RPC handler) | n/a | Same as above. The HTTP handler tests against `session-ask.js` aren't present, so for the HTTP layer the closest pattern is calling `pair.handleHttp(fakeReq, fakeRes)` directly with mock req/res — document that this is a Phase 16 first (no prior HTTP-handler unit test in the suite). | exact for shape; novel for HTTP req/res mocking |
| **NEW `tests/devices-json.test.js`** | test, unit (persistence) | n/a | `tests/resumable-handlers.test.js:1-46` — same `// @vitest-environment node` + `freshSessionsModule()` cache-wipe + tmpdir-based `CLIDECK_DATA_DIR` pattern | exact |
| **NEW `tests/ws-auth-gate.test.js`** | test, unit (auth gate) | n/a | `tests/check-cwd-handler.test.js` as above. Specifically the `it('reports error:…')` mock-fs-then-restore pattern (lines 102-127) is the template for testing the close-with-4401 branch with a spy on `ws.close`. | exact |
| **NEW `tests/revoke-closes-socket.test.js`** | test, unit (ws iteration) | n/a | `tests/resumable-handlers.test.js` + `tests/session-pause.test.js:49-57` `captureClient(sessions)` helper that adds a fake-`{readyState:1, send:…}` to `sessions.clients` (extend fake with `close: (code, reason) => recorded.push({close: [code, reason]})`) | exact (extend the existing `captureClient` helper) |
| **NEW `e2e/pair-flow.spec.js`** | test, e2e (Playwright) | n/a | `e2e/smoke.spec.js:15-56` `installWsRecorder(page)` + `waitForAppReady(page)` helpers (lines 17-44, 46-54). For form-driven flow: no existing e2e exercises a `GET /pair`-style standalone page, so this is Phase 16 first. Document that the pair page is the first standalone (non-app-shell) Playwright spec — pattern is `await page.goto('/pair'); await page.fill('#otp', 'ABC-DEF'); await page.click('#pair-submit'); await page.waitForURL('/');` straight Playwright. | partial — copy `installWsRecorder` for the post-pair WS verify; the form flow itself is novel |
| **NEW `e2e/revoke-flow.spec.js`** | test, e2e (Playwright) | n/a | `e2e/session-pause.spec.js:15-25` — same `installWsRecorder` boilerplate, plus the trick (called out in its file header) of injecting synthetic WS MessageEvents on the live socket to drive the UI. For revoke-flow specifically: inject a `device.list` MessageEvent, click revoke, assert the modal text, confirm, assert `ws.close` is observed. | exact (mirror session-pause.spec.js's `injectMessageEvent` pattern) |

---

## §2 — Inline code shape templates for the trickiest splices

These are the splices the planner will quote verbatim into PLAN file
`<read_first>` blocks. All snippets are verified against the cited line
ranges as of `main` HEAD.

### 2.1 `handleProtocols` wiring on `new WebSocketServer({…})` (D-01 transport)

**Current:** `server.js:366-371` instantiates the wss with a `verifyClient`
hook. `handleProtocols` is the sibling option in the `ws` library
(verified at `node_modules/ws/lib/websocket-server.js:44, 71, 276-281`).

Existing shape to splice into:

```js
// server.js:366-371 (existing, unchanged)
const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }) => {
    return isAllowedWsOrigin(req.headers.origin, req.headers.host);
  },
});
```

Phase 16 splice (add a 3rd key — keep `verifyClient` as the outer-gate
origin check; `handleProtocols` is the *auth* gate that picks the
subprotocol or returns `false` to reject):

```js
const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }) => {
    return isAllowedWsOrigin(req.headers.origin, req.headers.host);
  },
  // Phase 16 D-01 — token transport is Sec-WebSocket-Protocol.
  // Browser sends:  Sec-WebSocket-Protocol: clideck-device-token, <raw-token>
  // We must echo back exactly one of the offered protocols. Returning the
  // sentinel string accepts the upgrade; returning `false` makes the `ws`
  // library reject with HTTP 401 (browser surfaces this as a clean close
  // — no in-protocol 4401 needed at this stage; that's the application-layer
  // reject for tokens we DO accept the upgrade for but then identify as
  // unknown post-onConnection).
  handleProtocols: (protocols, request) => {
    const arr = Array.from(protocols);
    if (!arr.includes('clideck-device-token')) return false;
    // Hand the raw token to onConnection by stashing it on the request.
    // The token itself is the OTHER entry in `protocols` (the one that
    // isn't the sentinel). `ws` strips both from the response header
    // we control by returning only the sentinel.
    const raw = arr.find(p => p !== 'clideck-device-token');
    request.__deviceTokenRaw = raw || null;  // attached for onConnection
    return 'clideck-device-token';
  },
});
```

Then in `handlers.js` `onConnection(ws, req)` (note: the second arg is the
upgrade request — currently `onConnection(ws)` at `handlers.js:266`
ignores it but `wss.on('connection', onConnection)` at `server.js:372`
passes it):

```js
// handlers.js — REPLACE line 266-267
function onConnection(ws, req) {
  // Phase 16 — auth gate (runs BEFORE sessions.clients.add to prevent
  // unpaired sockets from changing Phase 15's clients.count). On Phase
  // 15 merge, this gate runs before the clients.count broadcast for free.
  const raw = req && req.__deviceTokenRaw;
  const dev = validateDeviceToken(raw);  // returns {id, label, tokenHash} | null
  if (!dev) {
    try { ws.close(4401, 'unpaired'); } catch { /* noop */ }
    return;  // do NOT add to clients, do NOT broadcast, do NOT send config
  }
  ws.deviceId = dev.id;
  ws.deviceTokenHash = dev.tokenHash;  // for revoke-closes-socket iteration
  // Touch last_seen here (atomic-write via the new devices.json helper).
  touchDeviceLastSeen(dev.id);

  sessions.clients.add(ws);
  // ... existing handlers.js:268+ unchanged
}
```

### 2.2 Atomic-write helper for `devices.json` (NEW, no project precedent)

**Project precedent is plain `writeFileSync`** — both `config.js:217-219`
and `sessions.js:762` write the JSON file directly with no rename. SPEC
asks for atomic-rename. Per CLAUDE.md §14 (demand elegance, don't paper
over), the planner must pick one and name the choice:

- **Option A (project-consistent, simpler):** Plain `writeFileSync` like
  the existing two persisters. Risk: half-written `devices.json` on a
  power-cut between the open and the close. The same risk applies to
  `sessions.json` and `config.json` today and has not bitten anyone —
  so option A is the **path of least surprise**.
- **Option B (SPEC-faithful, novel):** Atomic write via tmp-then-rename.
  Adds a new pattern the project doesn't have anywhere. Worth doing
  if the planner is willing to also retrofit `sessions.json` and
  `config.json` (otherwise we have one atomic file and two non-atomic
  siblings, which is a tell-tale sign of half-applied discipline).

**Recommended:** Option A in Phase 16, document the inconsistency, file
a Phase 17 backlog item to retrofit all three persisters at once. That
keeps Phase 16 scope tight AND avoids the discipline-asymmetry footgun.

Concrete shape for Option A (mirrors `sessions.js:762`):

```js
// NEW: devices.js (or fold into sessions.js if planner prefers)
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const { DATA_DIR } = require('./paths');
const DEVICES_PATH = join(DATA_DIR, 'devices.json');

function load() {
  if (!existsSync(DEVICES_PATH)) return { devices: [], version: 1 };
  try {
    const obj = JSON.parse(readFileSync(DEVICES_PATH, 'utf8'));
    return { devices: Array.isArray(obj.devices) ? obj.devices : [], version: obj.version || 1 };
  } catch { return { devices: [], version: 1 }; }
}

function save(state) {
  writeFileSync(DEVICES_PATH, JSON.stringify(state, null, 2));
  // (Option B would write to DEVICES_PATH + '.tmp' then renameSync — but
  // see §2.2 above for why Option A is recommended on first pass.)
}

module.exports = { load, save, DEVICES_PATH };
```

If the planner picks Option B, the renameSync shape is:

```js
function save(state) {
  const tmp = DEVICES_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  require('fs').renameSync(tmp, DEVICES_PATH);
}
```

### 2.3 Revoke-closes-socket iterator (in `sessions.js` or a new helper)

**The ONLY existing iteration over `sessions.clients`** is the broadcast
loop at `sessions.js:53-55`:

```js
// sessions.js:53-55 (existing — the analog)
function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(raw);
  // ... rest of broadcast unchanged
}
```

Phase 16 splice — same shape, different action. Either as a new function
in `sessions.js` next to `broadcast`, or inline in the revoke handler:

```js
// NEW: in sessions.js, next to broadcast() (~line 75)
//
// Close every WS whose device token-hash matches the one being revoked.
// Mirror broadcast's iteration exactly — for...of, readyState gate, swallow
// per-socket errors so one wedged ws doesn't block the others. The 4401
// + reason 'revoked' lets the client clear localStorage and redirect to
// /pair without ambiguity (cf. the 4401 'unpaired' path in §2.1).
function closeDevice(tokenHash) {
  let closed = 0;
  for (const c of clients) {
    if (c.deviceTokenHash === tokenHash && c.readyState === 1) {
      try { c.close(4401, 'revoked'); closed++; } catch { /* noop */ }
    }
  }
  return closed;
}
```

The revoke handler then becomes a 3-step thing: delete from
`devices.json`, call `closeDevice(tokenHash)`, broadcast the new list.

---

## §3 — Phase 15 merge-order considerations

Phase 15 (`feat/mobile-desktop-concurrent-access`) is implemented on its
feature branch but NOT merged to `main`. Diff verified at the time of
writing with `git diff main..feat/mobile-desktop-concurrent-access --
handlers.js sessions.js public/js/state.js public/js/app.js`. Three
Phase 16 splice points overlap Phase 15's territory:

### S-1 — `handlers.js` `onConnection` body (the auth gate splice)

| | Detail |
|---|---|
| **On `main`** | `handlers.js:266-267` is `function onConnection(ws) { sessions.clients.add(ws); …` |
| **On `feat/mobile-desktop-concurrent-access`** | Same opening, but the NEXT line adds `sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });` |
| **Phase 16 wants** | Auth gate to fire **before** `sessions.clients.add(ws)` so unpaired sockets don't change Phase 15's count |
| **Conflict on merge** | Trivial — same hunk, two adjacent inserts. `git merge` will conflict cleanly; resolution is "auth gate, then existing main body (which already had `sessions.clients.add`), then Phase 15's `clients.count` broadcast". |
| **Recommendation** | **Phase 15 merges to main first.** Then Phase 16 plans regenerate against post-merge `handlers.js` so the auth-gate splice sits in the right place relative to the now-present `clients.count` line. Otherwise Phase 16 plans cite line 267, Phase 15 lands and shifts it to 268, and every plan needs a manual fix. |

### S-2 — `handlers.js` `ws.on('close', …)` (the disconnect splice)

| | Detail |
|---|---|
| **On `main`** | `handlers.js:755` is `ws.on('close', () => sessions.clients.delete(ws));` |
| **On `feat/mobile-desktop-concurrent-access`** | Same line expands to a multi-line: `ws.on('close', () => { sessions.clients.delete(ws); sessions.broadcast({type:'clients.count', count: sessions.clients.size}); });` |
| **Phase 16 wants** | No change to this exact splice — the 4401 close path runs via `closeDevice()` (see §2.3), which is initiated server-side by the revoke handler, not by the client. Phase 16's revoke-closes-socket invariant relies on the existing close-cleanup running normally. |
| **Conflict on merge** | None for Phase 16. The post-merge shape is "delete from clients Set, broadcast updated count, AND on Phase 16 also implicitly any device.list that wants to drop the now-disconnected device's `liveNow` flag — but `device.list` derives liveNow live from `sessions.clients` so no extra wiring needed." |
| **Recommendation** | No action required on merge order for this splice alone — but bundled with S-1 the recommendation is the same: **Phase 15 first**. |

### S-3 — `public/js/state.js` state literal

| | Detail |
|---|---|
| **On `main`** | `public/js/state.js:1-14` ends with `remoteVersion: null,` (the last field) |
| **On `feat/mobile-desktop-concurrent-access`** | `remoteVersion` is REPLACED by `otherClientsConnected: false` (verified at the diff) |
| **Phase 16 wants** | Add `linkedDevices: []` and `deviceId: null` |
| **Conflict on merge** | Same hunk, adjacent additions. Trivial conflict. Post-merge the literal should carry all four fields: `otherClientsConnected`, `linkedDevices`, `deviceId`, and (if it survives Phase 15's review) `remoteVersion`. |
| **Recommendation** | Same — **Phase 15 first.** Phase 16's state.js plan should target the post-merge literal. |

### S-4 — `public/js/app.js` ws-message switch

| | Detail |
|---|---|
| **On `main`** | switch ends around `case 'pill.logs':` at app.js:447, then default. |
| **On `feat/mobile-desktop-concurrent-access`** | Adds `case 'clients.count': updateOtherClientIndicator(msg.count); break;` after the `closed` arm (around the existing `case 'closed':` at app.js:215). |
| **Phase 16 wants** | Add `case 'device.list':` and `case 'device.revoked':` arms — naturally far from the `clients.count` splice (probably near settings-related arms like `case 'plugins':` at app.js:407). |
| **Conflict on merge** | None expected (different switch arms, different file locations). |
| **Recommendation** | No specific ordering pressure from S-4, but the combined S-1/S-3 pressure means the same overall guidance. |

### Aggregate recommendation

**Phase 15 merges to `main` first, then Phase 16 plans regenerate
against the post-merge tree.** This is the cheapest path because:

1. Two of the four splices (S-1, S-3) are line-shift sensitive — the plan
   files quote exact line numbers per CLAUDE.md §1.
2. Phase 15 has already been validated on its branch (`15-VALIDATION.md`,
   `15-VERIFICATION.md`); it is ready to merge.
3. Reverse ordering (Phase 16 first, Phase 15 second) would make Phase
   15's `clients.count` splice land into a `handlers.js` that already
   has the auth gate, which is *correct* outcome-wise but means Phase 15
   needs to know about Phase 16 — backward dependency direction from how
   the SPEC is written ("Phase 16 depends on Phase 15").
4. Per CLAUDE.md §3 (commit-but-don't-push on GitHub remotes) and §10
   (agreement = green-light during execution), the planner should
   surface this recommendation in Phase 16's PLAN-01 `<read_first>`
   block and ask Lance to confirm "Phase 15 merge first" before plan
   execution starts.

---

## §4 — Naming / convention checks

These are project-wide conventions the planner must follow for Phase 16
artefacts. Each one was verified across at least 3 existing files.

### 4.1 Vitest environment directive

**Convention:** Server-side / node-runtime tests start with
`// @vitest-environment node` on line 1. Verified at:
- `tests/check-cwd-handler.test.js:1`
- `tests/session-pause.test.js:1`
- `tests/resumable-handlers.test.js:1`
- `tests/confirm-modal-onebutton.test.js:1` (uses `happy-dom` instead — the explicit override for DOM tests)

Default env (`vitest.config.js:5`) is `happy-dom`. Phase 16's
server-side test files (`pair-otp`, `pair-redeem`, `devices-json`,
`ws-auth-gate`, `revoke-closes-socket`) ALL need the
`// @vitest-environment node` directive on line 1.

### 4.2 Test data-dir isolation

**Convention:** Tests that touch `~/.clideck` set
`process.env.CLIDECK_DATA_DIR = mkdtempSync(...)` in `beforeEach` and
delete it in `afterEach`. Verified at `tests/check-cwd-handler.test.js:44-55`,
`tests/session-pause.test.js:39-47`, `tests/resumable-handlers.test.js:36-46`.
**`paths.js:5-8` reads the env var** so this works without code changes.
Phase 16's `devices-json.test.js` MUST follow the same pattern — the
new `devices.json` lives in the same `DATA_DIR`.

### 4.3 Fresh-module require-cache wipe

**Convention:** Tests that depend on module-scope state (`resumable`
array, `cfg` closure, etc.) wipe the clideck-owned require cache and
re-require to get a clean closure. Verified at
`tests/check-cwd-handler.test.js:24-32`, `tests/session-pause.test.js:29-37`,
`tests/resumable-handlers.test.js:25-33`. Exact shape (copy verbatim):

```js
function freshHandlers() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require('path').sep}clideck${require('path').sep}`) &&
        !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../handlers.js');
}
```

Phase 16's `pair-otp.test.js`, `ws-auth-gate.test.js`,
`revoke-closes-socket.test.js` ALL need this idiom (rename `freshHandlers`
to `freshHandlersOrPair` etc. as appropriate).

### 4.4 Fake-WS factory

**Convention:** `EventEmitter` subclass with `readyState=1`, `sent[]`,
`send: (raw) => sent.push(JSON.parse(raw))`, `ping`/`terminate` no-ops.
Verified at `tests/check-cwd-handler.test.js:34-42`,
`tests/session-pause.test.js:49-57`, `tests/resumable-handlers.test.js:47-53`.
For Phase 16 add `close: (code, reason) => sent.push({__close:[code, reason]})`
so the 4401-close path is observable in `ws-auth-gate.test.js` and
`revoke-closes-socket.test.js`.

### 4.5 ES-module imports in public/

**Convention:** `import { x } from './y.js';` with the `.js` extension
explicit. Verified at `public/js/app.js:1-16`, `public/js/settings.js:1-11`,
`public/js/confirm.js` (no imports, but uses `export function`),
`public/js/state.js` (uses `export const`/`export function`).
`public/index.html:521` declares `<script type="module" src="/js/app.js">`.

Phase 16's `public/js/pair.js` should follow the same — `import { … }
from './state.js'` etc. — and `public/pair.html` should declare the
script as `<script type="module" src="/js/pair.js">`.

### 4.6 JSON broadcast frames

**Convention:** `{ type: 'kebab-or-dotted-name', …payload }` — type
strings use dotted namespaces for sub-events. Verified at
`sessions.js:201` (`session.recovered`), `handlers.js:288` (`config`),
`handlers.js:294` (`plugins`), `handlers.js:312` (`session.status`).
Phase 16: `device.list`, `device.revoked` follow this. Single-word
types (`config`, `themes`, `presets`) also exist for top-level
domains. SPEC's `device.list` already conforms.

### 4.7 Close codes

**Convention:** Project does not currently use custom WebSocket close
codes anywhere (verified — only `ws.terminate()` at `handlers.js:280`
and the implicit close codes from the library). Phase 16 is the first
adopter of custom close codes (`4401`). Per IANA / RFC 6455, the
4000-4999 range is application-private — `4401` is unambiguously
"clideck unauthorized." Document this in the SPEC test plan: clients
that don't know about 4401 will see a generic close + reason string;
clideck's own client treats `event.code === 4401` as "clear token,
redirect to /pair."

### 4.8 Author identity for the eventual commit

Per CLAUDE.md §4: this repo's GitHub remote (`origin
https://github.com/tekstaker/clideck.git`, verified with `git remote
-v`) requires the **`Samuel Harding <dev1@lancetek.com>`** identity.
Current `git config user.email` should already be set locally — pattern
mapping commits inherit it; the planner should NOT touch git config.

---

## Metadata

**Analog search scope:** project root + `public/`, `public/js/`,
`tests/`, `e2e/`, plus `.planning/2026-06-02-mobile-desktop-concurrent-access/`
for cross-reference. Excluded `node_modules/` (except for one targeted
`ws` library lookup to verify `handleProtocols` API surface).

**Files scanned:** `handlers.js` (931 lines), `sessions.js` (891),
`server.js` (453), `config.js` (221), `session-ask.js` (171),
`paths.js` (43), `public/js/app.js` (1954, targeted reads), `public/js/state.js`
(30), `public/js/settings.js` (663, targeted reads),
`public/js/confirm.js` (51), `public/index.html` (523, targeted reads),
6 test files, 2 e2e specs, the Phase 15 diff.

**Pattern extraction date:** 2026-06-05.

**Files created / modified by this agent:** ONE — this PATTERNS.md.
No source code touched (per pattern-mapper read-only constraint).
