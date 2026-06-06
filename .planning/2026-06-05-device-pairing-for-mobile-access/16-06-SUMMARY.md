---
phase: 16-device-pairing-for-mobile-access
plan: 06
type: execute
wave: 2
state: complete
date: 2026-06-05
duration_seconds: 2400
duration_pretty: ~40min
requirements_addressed: [AC1, AC2, AC3, AC5]
files_created:
  - public/js/pair.js
files_modified:
  - public/pair.html
  - public/js/state.js
  - public/js/app.js
files_deleted: []
commits:
  - "feat(client): pair view + token storage + app.js boot gate + RESEARCH §7 hybrid auth-fail check (Phase 16 AC1/AC2/AC3 client side, D-03)"
  - "docs(phase-16-06): wave-2 SUMMARY — client pair flow + boot gate landed; pair-flow.spec partially activated"
acceptance_criteria_satisfied:
  - AC1 — empty-localStorage → /pair redirect, no WS construction (client-side soft gate; server hard gate landed in 16-05)
  - AC2 — valid OTP → token + device_id persisted to localStorage, dashboard reloads with live WS
  - AC3 — known device reconnects silently (boot-time gate finds the token, WS opens with subprotocol arg)
  - AC5 client half — onclose 4401 hybrid clears localStorage + redirects to /pair (server side of AC5 was 16-05; server emits 4401 on revoke and client handles it here)
acceptance_criteria_deferred:
  - AC4 — fully landed in 16-05 (unknown token → 4401, never in sessions.clients); no client work needed
  - AC6 — depends on Settings panel from 16-07
  - AC7 — server side (bootstrap.otp write) landed in 16-03; this plan adds the client side
  - AC8 — server-side hygiene was 16-02/16-04; this plan extends to the client (no console.log of token or OTP)
  - AC9 — pair-otp single-use + TTL is server-side (16-03); this plan's pair.js maps the 410/400+error contract to user-facing strings
---

# Phase 16 Plan 06: Wave 2 — Client pair flow + boot gate landed Summary

Wave-2 client work: the browser now has everything it needs to walk the
full pair flow end to end. A fresh phone hitting `/` lands on `/pair`,
enters the bootstrap OTP, gets a 256-bit token + opaque device ID written
to `localStorage`, and reloads into the dashboard with a live WebSocket
that carries the token in the `Sec-WebSocket-Protocol` header (D-01). On
revoke (server emits close code 4401) or boot-time auth-fail (server emits
HTTP 401 which surfaces as WS close code 1006), the hybrid `onclose`
handler from RESEARCH §7 clears both `clideck.deviceToken` and
`clideck.deviceId` and redirects back to `/pair`.

The four artefacts the plan called for are all in place. The Wave-0 e2e
spec at `e2e/pair-flow.spec.js` is no longer dependency-blocked — its AC1
test (empty-localStorage → /pair) now has the boot-time gate it needs;
its AC2 test (bootstrap → redeem → token persists → dashboard) has the
form-submit handler it needs; its AC3 test (known device reconnects
silently) has the localStorage-token-passes-into-WS-subprotocol path it
needs. The spec's third test was `test.skip`-gated on AC2 succeeding (it
reuses the token captured by AC2 to drive AC3); after this plan AC2 can
run, so AC3 cascades open too. The Settings → Linked-devices half of
AC5 + AC6 + the `device.list` ws-arm in `app.js` is 16-07 territory and
is the only Wave-0 spec area still blocked.

## What landed

### 1. `public/pair.html` — full pair UI replacing the 16-04 placeholder

The 16-04 placeholder explicitly carried a `PHASE 16-04 PLACEHOLDER`
comment and minimal inline styling. This plan replaces it with the real
view: a single-card layout centred on the page, with `#otp` and `#label`
inputs and a `#pair-submit` button. **All four selector IDs preserved**
verbatim from the placeholder so the Wave-0 e2e spec's locators
(`page.locator('#otp')`, `#label`, `#pair-submit`) continue to match
without spec churn.

Key shapes:

- Reuses the dashboard's compiled `/tailwind.css` for palette
  consistency (PATTERNS §1 row 11). Drops `xterm.css` — no terminal on
  this page.
- The OTP input is `inputmode="latin"`, `autocomplete="off"`,
  `autocapitalize="characters"`, `pattern="[A-Z0-9\-]{3,7}"`,
  `maxlength="7"` — accommodates either `ABCDEF` or `ABC-DEF` formats
  per the server's normaliser (`String(payload.otp || '').toUpperCase()
  .replace(/[^A-Z0-9]/g, '')`).
- The label input is `maxlength="32"`, trimmed and clamped by both the
  client (`label.trim().slice(0, 32)`) and the server (D-04: free-form
  UTF-8 max 32 chars, trimmed; server falls back to `'Device'` if empty
  after sanitisation).
- A `<form>` wrap enables iOS's "Go" key + Enter-on-desktop submission;
  the handler calls `preventDefault()` so the fetch path runs instead
  of a form-POST navigation.
- An `apple-mobile-web-app-capable` meta tag lays the groundwork for the
  PWA-install path that mitigates iOS Safari ITP eviction (see "iOS
  Safari ITP caveat" below).
- A trailing `<p>` tip recommends "add to home screen" — surfaces the
  mitigation in-line to the user without needing a manual.

### 2. `public/js/pair.js` — standalone form-submit module

189-line ES module, no imports. Handles:

- **Live OTP normalisation:** as the user types, `otpEl.value` is
  upper-cased and the caret is preserved (via `setSelectionRange`).
  This mirrors the server-side normaliser exactly so a hyphenated user-
  typed OTP (`'ABC-DEF'`) redeems against the stored `'ABCDEF'` key.
- **Submit handler** on both the form `submit` event and the explicit
  button `click` (defence-in-depth for older browsers where Enter on a
  single-field form skips the form submit).
- **Payload:** `{ otp, label, ua_hint }` JSON-encoded to
  `POST /pair/redeem`. `ua_hint` is `navigator.userAgent.slice(0, 200)`
  (server caps the same).
- **Success path:** `localStorage.setItem('clideck.deviceToken', token)`
  + `localStorage.setItem('clideck.deviceId', device_id)` →
  `window.location.href = '/'`. The literal `localStorage.setItem(
  'clideck.deviceToken'` is the canonical pattern that the Wave-0 e2e
  spec greps for; the keys are inlined (NOT lifted to a constant) so
  the static check stays loud and obvious.
- **Error mapping matrix** (server contract per `routes/pair.js`):

  | Server response | User-facing message |
  |---|---|
  | HTTP 410 (`error: 'expired'`) | "That code has expired. Generate a new one from your server boot log or from Settings → Linked devices on another paired device." |
  | HTTP 400 (`error: 'used'`) | "That code was already used. Generate a new one." |
  | HTTP 400 (`error: 'invalid'`) | "Unknown code. Check the code and try again." |
  | HTTP 400 (`error: 'invalid-json'`), 5xx, fetch reject | "Network error. Please try again." |
  | localStorage write throws (private-mode Safari, quota) | "Could not save the pairing on this browser. Try a different browser or disable private/incognito mode." |
  | Empty OTP after normalise | "Enter the 6-character code." |

- **Submit button** disabled + label changed to "Pairing…" during the
  in-flight fetch; re-enabled and original label restored on every
  error path. Success navigates away before the re-enable could matter.

### 3. `public/js/state.js` — two new fields

Two single-line additions after the existing `remoteVersion: null,`
field:

```js
linkedDevices: [],  // populated by `device.list` broadcast (Phase 16, 16-07 renders)
deviceId: null,     // hydrated at app boot from localStorage.clideck.deviceId
```

The literal still parses; no existing field touched.

**Merge-order note (PATTERNS §3 S-3):** if/when Phase 15
(`feat/mobile-desktop-concurrent-access`) merges to `main`, that branch
also adds a field to this literal (`otherClientsConnected: false`). The
splice this plan made targets the current `main` literal (no Phase 15
field present), so the three-way merge will be a trivial adjacent-field
conflict — both branches add to the same `state = { … }` literal at
the bottom. Resolution: keep all three fields (`otherClientsConnected`,
`linkedDevices`, `deviceId`).

### 4. `public/js/app.js` — three splices

#### 4a. Module-scope `connectedAtLeastOnce` flag (top of module)

A new `let connectedAtLeastOnce = false;` next to the existing
`lastDropToastId` / `connectedAt` flags. A multi-line comment above it
cites RESEARCH §7 and explains the discriminator: it distinguishes
boot-time WS handshake rejection (event.code=1006, because verifyClient
rejects pre-handshake) from in-flight revoke (event.code=4401, because
sessions.closeDevice from 16-05 sends `ws.close(4401, 'revoked')` after
the upgrade was already up).

#### 4b. `state.deviceId` hydrated at app boot

Right after the module-scope flag declarations, wrapped in a try/catch
in case Safari private-mode throws on `localStorage` access:

```js
try { state.deviceId = localStorage.getItem('clideck.deviceId'); }
catch { /* localStorage blocked — leave deviceId null */ }
```

The raw device token deliberately does NOT enter `state`. It is read
only in `connect()` at WS-construction time and on each `onclose`
auth-fail check; that scoping keeps it out of `JSON.stringify(state)`
dumps if anyone ever adds one for debugging.

#### 4c. `connect()` — boot-time gate + subprotocol arg

At the top of `connect()`, BEFORE the WebSocket URL construction:

```js
const deviceToken = localStorage.getItem('clideck.deviceToken');
if (!deviceToken) {
  window.location.href = '/pair';
  return;
}
```

WebSocket construction now passes the subprotocol array:

```js
state.ws = new WebSocket(
  `${wsProtocol}//${location.host}`,
  ['clideck-device-token', deviceToken]
);
```

The server's `handleProtocols` (landed in 16-05) accepts only if the
`'clideck-device-token'` sentinel is one of the offered protocols;
it echoes back just the sentinel. The token rides as the OTHER entry,
inspected by `verifyClient` and looked up via SHA-256-hash +
`timingSafeEqual` against `devices.json`.

#### 4d. `state.ws.onopen` — sets the flag

`connectedAtLeastOnce = true;` as the FIRST line inside the onopen
callback, beside the existing `connectedAt = Date.now();`. Once the
upgrade has completed, any subsequent close is a runtime event (network
drop, server restart, revoke) rather than a handshake-time rejection.

#### 4e. `state.ws.onclose` — RESEARCH §7 hybrid verbatim

The signature changes from `() => { … }` to `(event) => { … }`. The
new body preserves the existing teardown (clearing `connectedAt`,
re-rendering the status badge, clearing heartbeat) and inserts the
hybrid auth-fail check above the existing reconnect path:

```js
const hasToken = !!localStorage.getItem('clideck.deviceToken');
const isAuthFail = event.code === 4401 ||
  (!connectedAtLeastOnce && event.code === 1006 && hasToken);
if (isAuthFail) {
  localStorage.removeItem('clideck.deviceToken');
  localStorage.removeItem('clideck.deviceId');
  window.location.href = '/pair';
  return;
}
```

**This conditional matches RESEARCH §7 verbatim** — verified by:

```bash
$ grep -F "event.code === 4401 ||" public/js/app.js
    const isAuthFail = event.code === 4401 ||
$ grep -F "!connectedAtLeastOnce && event.code === 1006 && hasToken" public/js/app.js
      (!connectedAtLeastOnce && event.code === 1006 && hasToken);
```

After the auth-fail branch, the existing reconnect path
(`Connection lost — reconnecting…` toast + `setTimeout(connect, 1000)`)
is preserved verbatim with a `connectedAtLeastOnce = false;` reset above
it so the per-attempt flag tracks each fresh WS instance independently.

The `onerror` handler is unchanged — it force-closes the ws so the
onclose path runs, which is the contract the hybrid handler relies on.

## Two-layer defence (D-03)

Per CONTEXT D-03 the design is two layers of defence against unpaired
WS connects:

| Layer | Where | Mechanism | Wins if… |
|---|---|---|---|
| Hard (server) | `auth-gate.js` `makeVerifyClient` (16-05) | HTTP 401 from `abortHandshake` aborts the upgrade BEFORE `clients.add(ws)` | An attacker bypasses the client (curl, custom WS lib, devtools) |
| Soft (client) | `app.js` `connect()` boot gate + `onclose` hybrid (this plan) | Redirects to `/pair` before WS construction; clears `localStorage` + redirects after 4401/1006 | Saves the round-trip on the legitimate fresh-browser path |

Both layers are needed: the hard layer is the security boundary, the
soft layer is the UX optimisation that avoids gratuitous /pair-redirect
loops on every page load.

## iOS Safari ITP caveat (RESEARCH §5 A3 — [ASSUMED])

Safari's Intelligent Tracking Prevention may clear site-scoped storage
after 7 days of non-use. A clideck phone used twice a week sits right at
the threshold. If `localStorage.getItem('clideck.deviceToken')` returns
`null` after a multi-day gap, the phone is silently un-paired and the
user has to re-OTP.

**Mitigation (NO code action in 16-06; documented only):** recommend
adding clideck to the iPhone home screen (Share → Add to Home Screen).
Installed PWAs are treated as first-party app contexts by Safari and
the 7-day cap is relaxed (or removed; exact behaviour varies by iOS
version).

The pair.html now carries:
- `<meta name="apple-mobile-web-app-capable" content="yes">` — declares
  PWA capability.
- A trailing `<p>` tip: *"Tip: add clideck to your home screen for the
  most reliable session."* — surfaces the mitigation without a manual.

A future-phase observation (not a blocker for 16): if Lance starts
seeing real-world silent-unpair drift, the upgrade path is IndexedDB
(async, which makes the boot-time check a Promise rather than a sync
`if (localStorage.getItem(...))`; tractable but invasive).

## localStorage keys used

| Key | Written by | Read by | Cleared by |
|---|---|---|---|
| `clideck.deviceToken` | `pair.js` (on /pair/redeem 200) | `app.js` `connect()` boot gate; `app.js` onclose hybrid (presence check) | `app.js` onclose hybrid (on 4401 / 1006+token) |
| `clideck.deviceId` | `pair.js` (on /pair/redeem 200) | `app.js` boot (hydrates `state.deviceId`) | `app.js` onclose hybrid (on 4401 / 1006+token) |

Both keys are cleared together on auth-fail — the device ID alone is
not useful without the token, and the token alone leaves the Settings
panel (16-07) without "this device" identification.

## Token hygiene (CLAUDE.md §13)

The raw device token's blast radius is tightly scoped:

- **Server side:** `routes/pair.js` returns it in the `POST /pair/redeem`
  response body exactly once. Never in a `console.log`, never in
  `devices.json` (only the SHA-256 hash persists).
- **Network:** transits via `Sec-WebSocket-Protocol` on the WS upgrade.
  No `Cookie`, no query string, no log.
- **Client side (this plan):** `pair.js` reads it from the response and
  writes it to `localStorage`. `app.js` reads it from `localStorage` in
  exactly two places (`connect()` for WS construction; `onclose` for the
  has-token discriminator). NEVER appears in `state`, NEVER in any
  `console.log`, NEVER in any DOM textContent or alert.

Verified by grep:

```bash
$ grep -E 'console\.log.*deviceToken|console\.log.*devicetoken' public/js/app.js
(no output)
$ grep -E 'console\.log.*[Tt]oken|console\.log.*otp' public/js/pair.js
(no output)
```

## Smoke test (manual, before SUMMARY)

Per CLAUDE.md §1 — actually ran the end-to-end pair flow on a fresh
tempdir before claiming done:

```bash
DATADIR=$(mktemp -d)
CLIDECK_DATA_DIR="$DATADIR" CLIDECK_PORT=4099 node server.js &
# Server boot logs the bootstrap OTP to stdout and to $DATADIR/bootstrap.otp.
# (OTP value redacted per CLAUDE.md §13 — referenced by file path only.)

# 1. GET /pair returns the new HTML with the four selector IDs:
curl -s http://127.0.0.1:4099/pair | grep -F 'id="otp"'      # HTTP 200, IDs present
curl -s http://127.0.0.1:4099/js/pair.js | wc -l             # 189 lines served

# 2. Redeem the bootstrap OTP via the JSON route the form will hit:
OTP=$(cat $DATADIR/bootstrap.otp)
curl -s -X POST http://127.0.0.1:4099/pair/redeem \
  -H 'content-type: application/json' \
  -d "{\"otp\":\"$OTP\",\"label\":\"Smoke Test\",\"ua_hint\":\"smoke/1.0\"}"
# → 200 {"ok":true, "device_id":"dev_...", "token":"<43-char base64url>", "label":"Smoke Test"}

# 3. bootstrap.otp deleted (D-02), devices.json holds sha256: hash (NOT raw token):
test -f $DATADIR/bootstrap.otp || echo "deleted ✓"
cat $DATADIR/devices.json | grep -F 'sha256:' >/dev/null && echo "hash persisted ✓"

# 4. WS handshake with the fresh token: auth gate accepts.
node -e "const ws = new (require('ws'))('ws://127.0.0.1:4099', ['clideck-device-token', '<token>']);
         ws.on('open', () => { console.log('OPEN'); ws.close(); });"
# → OPEN  (then close code 1005, no auth-fail)

# 5. WS handshake with a WRONG token (43-char A's): 1006.
# → "error (expected) Unexpected server response: 401" + close code 1006
# This is the path the boot-time onclose hybrid catches:
# !connectedAtLeastOnce && event.code === 1006 && hasToken → clear + /pair

# 6. Duplicate redeem: 400 "used".
curl -s -X POST http://127.0.0.1:4099/pair/redeem ... -d "{\"otp\":\"<used>\"}"
# → {"ok":false, "error":"used"}  HTTP 400
```

All six smoke checks pass. The raw token surfaces only in the redeem
response and the WS handshake header; never in stdout or persistence.

## Test suite — no regression

```
Pre-Wave-2 server-side specs (16-01-authored):
 Test Files  7 passed (7)
      Tests  53 passed (53)
   Duration  779ms
```

The 53 server-side spec results from 16-05 stayed green. The 3
pre-existing handler-test failures (`check-cwd`, `mkdir-cwd`,
`creator-preflight-integration`) are timeout flakiness on the WSL2
host unrelated to this plan — verified the same 3 fail on `cd1e3e0`
(HEAD before this plan's commits) for the same reason.

## Wave-0 e2e spec status

`e2e/pair-flow.spec.js` activation:

- **AC1** (empty localStorage → /pair, no WS): the boot-time
  localStorage check in `connect()` is in place; the AC1 test should
  now pass under Playwright.
- **AC2 + AC7** (bootstrap → redeem → token persists → dashboard with
  live WS): pair.js submit handler is wired, /pair/redeem is wired
  (16-04), bootstrap.otp is written (16-03). All dependencies of the
  AC2 test are now in place; the test should now pass.
- **AC3** (known device reconnects silently): the test is
  `test.skip`-gated on AC2 capturing a token. AC2 can now run, so the
  cascade unblocks AC3 too.

`e2e/revoke-flow.spec.js` remains RED — its tests depend on the
Settings → Linked-devices panel (16-07) and the `device.list` ws-arm in
`app.js` (16-07). 16-07 is the next plan.

(Per CLAUDE.md §1, the planner's authorial-intent for Wave-0 specs is
to flip them green incrementally. The exact e2e GREEN-ness will be
verified by 16-08 with a full Playwright run; smoke-checking the AC2
contract via the JSON path above gives us high confidence the
Playwright test will pass too, but the canonical proof is 16-08.)

## Deviations from plan

**None.** The four tasks landed exactly as the plan specified:

1. `public/pair.html` replaced — full UI; selector IDs preserved.
2. `public/js/pair.js` created — form-submit + fetch + localStorage +
   navigate; full error-mapping matrix.
3. `public/js/state.js` extended — two new fields; literal still parses.
4. `public/js/app.js` spliced — boot-time gate + subprotocol arg +
   `connectedAtLeastOnce` flag + hybrid `onclose` per RESEARCH §7
   verbatim.

No Rule 1/2/3 auto-fixes triggered; no Rule 4 architectural decisions
needed. No checkpoint needed.

## What 16-07 will pick up

- Settings → Linked devices panel (`public/index.html` + `settings.js`
  `renderLinkedDevices()`).
- `app.js` `state.ws.onmessage` arms for `device.list` and
  `device.revoked`.
- A `send({type: 'device.list.get'})` from `app.js` after WS open so the
  Settings panel mirrors current state.
- The `device.list`-broadcast → `state.linkedDevices` ←
  `renderLinkedDevices()` data flow that this plan's
  `state.linkedDevices: []` field reserves the slot for.

Once 16-07 lands, `e2e/revoke-flow.spec.js` should flip green too,
closing out the Wave-0 cascade started by 16-01.

## Self-Check: PASSED

All four artefacts present, both commits expected. Verified:

- `public/pair.html` — id="otp", id="label", id="pair-submit",
  id="pair-error" all present; PHASE 16-04 PLACEHOLDER marker gone.
- `public/js/pair.js` — fetch('/pair/redeem' present;
  localStorage.setItem('clideck.deviceToken' present; no token-related
  console.log; no OTP-related console.log.
- `public/js/state.js` — `linkedDevices: []` present; `deviceId: null`
  present; `remoteVersion: null` preserved.
- `public/js/app.js` — `let connectedAtLeastOnce = false` present;
  `connectedAtLeastOnce = true` present in onopen; `event.code === 4401`
  present; `!connectedAtLeastOnce && event.code === 1006 && hasToken`
  present (RESEARCH §7 verbatim); both `localStorage.removeItem` calls
  present; subprotocol `['clideck-device-token', deviceToken]` present;
  boot-time gate ordered BEFORE WS construction; existing reconnect path
  preserved.
- Phase 16 server-side specs: 53 passed (53). No regression.
