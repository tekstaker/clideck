---
phase: 16-device-pairing-for-mobile-access
plan: 05
wave: 2
type: execute
status: complete
completed: 2026-06-05
duration: ~25 minutes (4 commits)
commits:
  - 5779d71  # feat(auth-gate)
  - c6d927a  # feat(sessions): closeDevice
  - 447c713  # feat(server): wire verifyClient + handleProtocols + (ws, req) wrapper
  - 433a380  # feat(handlers): device.list.get + device.revoke arms
requirements_completed: [AC4, AC5, D-06-server-half]
files_created:
  - auth-gate.js  # 94 lines
files_modified:
  - sessions.js   # +33 lines (closeDevice + exports entry)
  - server.js     # +35 / -4 (verifyClient 2-arg form, handleProtocols, (ws,req) wrapper)
  - handlers.js   # +68 lines (device.list.get + device.revoke arms)
tests_flipped_red_to_green:
  - tests/ws-auth-gate.test.js          # 8/8 GREEN (AC4)
  - tests/revoke-closes-socket.test.js  # 7/7 GREEN (AC5)
tests_still_red:
  - tests/device-revoke-rebuild.test.js # GREEN (covered by Plan 16-04 + this plan's persistence-first revoke order)
  - e2e/pair-flow.spec.js               # Plan 16-06 (client) + 16-07 (settings UI) + 16-08 close
  - e2e/revoke-flow.spec.js             # Plan 16-06 (client) + 16-07 (settings UI) + 16-08 close
threat_flags: []
---

# Phase 16 Plan 05: WS Auth Gate + Revoke-Closes-Socket Summary

One-liner: Server-side WS auth gate (HTTP-401 reject on unpaired upgrades)
+ post-handshake revoke (4401 close on live ws-es) + `device.list.get` /
`device.revoke` admin arms — Wave-2 server work for Phase 16 device pairing,
all Wave-0 server-side specs (7 files, 53 tests) now GREEN.

## What landed

Four atomic commits, one per task in 16-05-PLAN.md:

| # | Commit  | Files                | What                                          |
| - | ------- | -------------------- | --------------------------------------------- |
| 1 | 5779d71 | NEW auth-gate.js     | `makeVerifyClient` + `readDeviceToken` helpers |
| 2 | c6d927a | sessions.js          | `closeDevice(deviceId)` iterator + export      |
| 3 | 447c713 | server.js            | 2-arg verifyClient + handleProtocols + (ws, req) wrapper |
| 4 | 433a380 | handlers.js          | `device.list.get` + `device.revoke` switch arms |

## Architectural pins restated

### Pattern A (RESEARCH §4)

`ws.deviceId` / `ws.deviceTokenHash` are tagged on the ws instance at
successful upgrade in `server.js`'s `(ws, req) => { ... }` wrapper, BEFORE
`onConnection(ws)` runs. `sessions.closeDevice(deviceId)` iterates
`sessions.clients`, matches by `c.deviceId === deviceId && c.readyState
=== 1`, calls `c.close(4401, 'revoked')` inside a per-client try/catch.

At Lance's scale (n ≤ 5 paired devices × a handful of tabs each), the
O(clients) loop is sub-millisecond — AC5's "close within 1s" budget is
satisfied with three orders of magnitude headroom. Verified empirically
by the Wave-0 latency spec ("50 clients on dev_X close synchronously in
< 1000ms") — measured ~50ms on this host.

### Auth runs in `verifyClient`, BEFORE the handshake completes (AC4 correct by construction)

`authGate.makeVerifyClient({ devices, isAllowedWsOrigin })` runs the
origin check FIRST (preserving the prior 1-arg form's semantics, including
no-Origin = allow for non-browser clients), then `readDeviceToken`, then
`devices.findByToken`. On any rejection, `callback(false, 401, 'unpaired')`
(or 403 'origin not allowed') aborts the upgrade with an HTTP status code
BEFORE `ws.completeUpgrade` runs.

The consequence: unpaired sockets **never reach `handlers.js:267`'s
`sessions.clients.add(ws)`**. When Phase 15's `clients.count` broadcast
(currently on its own feature branch, not on `main`) eventually merges,
Phase 16's auth gate prevents unpaired sockets from incrementing that
count — AC4 ("no `clients.count` broadcast for unpaired") is satisfied
by construction, not by an explicit guard inside the close handler.

### 4401 vs 1006 split (RESEARCH §7)

| Path                              | Wire shape                                     | Browser event                |
| --------------------------------- | ---------------------------------------------- | ---------------------------- |
| Pre-handshake reject (auth gate)  | HTTP 401 'unpaired' (or 403 'origin')          | `event.code === 1006`        |
| Post-handshake revoke (closeDevice)| WS close frame `code=4401, reason='revoked'`   | `event.code === 4401`        |

The 1006-vs-4401 hybrid client-side handler lives in Plan 16-06. This
plan ships the server side only.

### 4401 close code choice (PATTERNS §4.7)

RFC 6455 §7.4.2 reserves 4000-4999 for application-private use; `ws@8.19.0`'s
`isValidStatusCode` accepts the range. PATTERNS §4.7 verified 4401 is
unused elsewhere in clideck (the repo-wide grep returned no other custom
close codes), so it's unambiguous in server logs and in the client-side
handler. Mnemonic: 4000 (app range) + 401 (HTTP unauthorized).

## Auth-gate WS smoke (per CLAUDE.md §1 — actually run)

Boot took ~6 seconds on this WSL host (likely host-specific; production
typically boots faster). Captured during Task 3:

```
DATADIR=$(mktemp -d)
CLIDECK_DATA_DIR="$DATADIR" CLIDECK_PORT=4099 node server.js &
(wait for $DATADIR/bootstrap.otp to appear — signals readiness)

=== Test 1: NO subprotocol — expect rejection ===
PASS: rejected without token: Unexpected server response: 401

=== Test 2: GARBAGE token — expect rejection ===
PASS: rejected with garbage token: Unexpected server response: 401

=== Test 3: VALID token (after OTP redeem via /pair/redeem) ===
(OTP read: redacted; len=6)
(token received: redacted; len=43; format=<43-char base64url>)
PASS: connected with token; subprotocol echoed= clideck-device-token
```

Per CLAUDE.md §13 — the bootstrap OTP value and the 43-char base64url
token were captured ephemerally in the smoke script for the duration of
one test only; neither value is reproduced here. The tmp DATADIR was
removed at the end of the script.

## Test status

### Wave 0 server-side specs (all flipped to GREEN by this plan)

| Spec                                | Tests | Status                                 |
| ----------------------------------- | ----- | -------------------------------------- |
| tests/ws-auth-gate.test.js          | 8/8   | GREEN — flipped in Task 1              |
| tests/revoke-closes-socket.test.js  | 7/7   | GREEN — flipped in Task 2              |
| tests/pair-otp.test.js              | 8/8   | GREEN (landed in 16-03)                |
| tests/bootstrap-otp.test.js         | 3/3   | GREEN (landed in 16-03)                |
| tests/devices-json.test.js          | 11/11 | GREEN (landed in 16-02)                |
| tests/pair-redeem.test.js           | 11/11 | GREEN (landed in 16-04)                |
| tests/device-revoke-rebuild.test.js | 5/5   | GREEN (works because revoke order in handlers.js Task 4 calls devices.remove BEFORE closeDevice + broadcast — see Task 4 commit body) |

**Total: 53/53 Wave-0 server-side specs GREEN.**

### Wave 0 client-side / e2e specs still RED (handled by later plans)

- `e2e/pair-flow.spec.js` — needs client boot-time localStorage check (16-06) + settings UI (16-07) + e2e harness wiring (16-08).
- `e2e/revoke-flow.spec.js` — needs client 4401-onclose handler (16-06) + Linked Devices settings panel (16-07) + e2e harness (16-08).

### Adjacent regression (verified GREEN, no Phase 16 impact)

`tests/session-pause.test.js`, `tests/resumable-handlers.test.js`,
`tests/ws-send-guard.test.js` — all GREEN.

### Pre-existing failures NOT caused by Phase 16

Verified via `git stash` round-trip during Task 3: with all Plan 16-05
changes reverted, the following tests still time out (>5s per it-block):

- `tests/check-cwd-handler.test.js` — 6 timeouts
- `tests/mkdir-cwd-handler.test.js` — 6 timeouts
- `tests/creator-preflight-integration.test.js` — file-level

Per executor SCOPE BOUNDARY rule: out of scope for Plan 16-05. Logged to
`.planning/2026-06-05-device-pairing-for-mobile-access/deferred-items.md`
for a dedicated test-infra fix.

## Deviations from plan

### Task 2 placement self-correction

Initial implementation placed `closeDevice()` BEFORE `broadcast()` in
sessions.js. The plan explicitly says "Place immediately AFTER `function
broadcast(msg) { ... }`". JavaScript hoisting makes the runtime order
irrelevant, but for plan fidelity and reader cognition I repositioned it
to AFTER `broadcast()` before committing. No behavior change; same
function bytes. Caught and fixed within the same edit session, pre-commit.

### Boot time longer than expected

The plan's verification block assumes `sleep 2` after boot is sufficient.
On this WSL host the server takes ~6 seconds to fully boot (plugin
seeding, transcript init, etc.). I adapted the smoke script to poll for
`bootstrap.otp` appearance instead of fixed-sleep, which is a more robust
pattern and matches CLAUDE.md §1 (verify before claiming). No commit
needed — this was a smoke-test-script change, not a project-code change.

### No other deviations

No Rule 1 / 2 / 3 / 4 deviations encountered. The plan was unusually
prescriptive (RESEARCH §10.1 + §10.6 provided canonical splice code) so
implementation was largely transcription with comments + commit-message
context added per CLAUDE.md §5 (verbose, beautiful, all-encompassing
on personal projects).

## Phase 15 merge-order recheck

Per PATTERNS §3 the eventual Phase 15 merge will shift `handlers.js:267`
(`sessions.clients.add(ws)`) and `handlers.js:755` (`ws.on('close')`)
by adding a `sessions.broadcast({ type:'clients.count', count:
sessions.clients.size })` call after each. Re-grep post-Phase-15-merge:

- `sessions.clients.add(ws)` at handlers.js:267 — Phase 16's auth gate
  in server.js's verifyClient runs BEFORE `wss.emit('connection')`, so
  unpaired sockets never reach line 267. Phase 15's `clients.count`
  broadcast remains correct by construction.
- The new `device.list.get` / `device.revoke` arms in handlers.js
  (inserted between the existing `pill.getLogs` and `remote.status`
  arms) are far from Phase 15's switch additions (Phase 15 added
  `case 'clients.count':` near the `closed` arm at app.js:215, not
  in handlers.js's switch). No conflict expected.

## Files & key links

```
auth-gate.js  ──── makeVerifyClient({ devices, isAllowedWsOrigin })
                              │
server.js  ──── new WebSocketServer({ verifyClient: makeVerifyClient(...) })
                              │
                              ├── handleProtocols echoes 'clideck-device-token'
                              │
                              └── wss.on('connection', (ws, req) => {
                                       ws.deviceId       = req.clideckDevice.id
                                       ws.deviceTokenHash = req.clideckDevice.token_hash
                                       devices.touchLastSeen(...)
                                       onConnection(ws)
                                  })

handlers.js   ──── case 'device.list.get'  ──── reads devices.list() + sessions.clients
              ──── case 'device.revoke'    ──── devices.remove → sessions.closeDevice → broadcast → ack
                              │
sessions.js   ──── function closeDevice(deviceId)
                       for c of clients: if c.deviceId===deviceId && c.readyState===1
                          try { c.close(4401, 'revoked'); closed++ } catch {}
                       return closed
```

## What's next

- **Plan 16-06** — client side: `public/js/app.js` boot-time localStorage
  read, WS subprotocol injection, hybrid 1006/4401 onclose redirect to
  `/pair`. Closes e2e/pair-flow's "fresh load → /pair" gate.
- **Plan 16-07** — Settings UI: Linked Devices panel rendering
  `device.list`, click-to-edit label, D-06 own-device vs other-device
  confirm modals, calls `device.revoke`.
- **Plan 16-08** — Playwright e2e specs flip GREEN; final smoke covering
  AC1-AC9 end-to-end.

## Self-Check: PASSED

Files created/modified verification:

```
$ [ -f auth-gate.js ] && echo "FOUND: auth-gate.js"
FOUND: auth-gate.js

$ git log --oneline -4
433a380 feat(handlers): add device.list.get and device.revoke WS message arms (Phase 16 D-06)
447c713 feat(server): wire Phase 16 WS auth gate into WebSocketServer construction (AC4 connect side)
c6d927a feat(sessions): add closeDevice(deviceId) iterator for Phase 16 revoke flow (AC5)
5779d71 feat(auth-gate): Phase 16 WS upgrade auth gate via Sec-WebSocket-Protocol token (AC4 server side)
```

All four commit hashes present and on the current branch
(`feat/device-pairing-for-mobile-access`).
