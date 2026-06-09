---
phase: 15-mobile-desktop-concurrent-access
plan: 03
subsystem: backend
tags: [websocket, sessions, presence-broadcast, deletion-sweep, clideck-remote-retirement, phase-16-coexistence]

# Dependency graph
requires:
  - phase: 15-01
    provides: tests/other-client-indicator.test.js (RED-state vitest contract for R5) + e2e/clideck-remote-deletion.spec.js (R1 server-side grep gate)
  - phase: 12-01
    provides: sessions.clients (the Set<WebSocket> populated on connect/close, exported from sessions.js:21)
provides:
  - server-side R1 deletion sweep is complete (handlers.js — five `case 'remote.*':` arms + remoteCliEnv + checkRemoteUpdate + remote-update cache vars all gone)
  - server broadcasts {type:'clients.count', count: sessions.clients.size} on connect AND on close
  - compareVersions / parseVersion / getInstalledVersion preserved for checkAvailability() (per RESEARCH §10 G6)
  - tests/sessions-resize.test.js stays GREEN (Plan 02's locked-PTY contract holds)
affects: [15-04, 15-05, 15-VERIFY]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-internal broadcast: `sessions.broadcast({type, …})` invoked from the connect/close lifecycle hooks themselves, not from a client-message case arm. Skips the usual WS-message → handler-case → mutator → broadcast pipeline because presence is server-state-derived, not client-message-derived."
    - "Delete-then-broadcast ordering on close: surviving clients see the correctly-decremented count because the broadcast fires AFTER `sessions.clients.delete(ws)`. `sessions.broadcast`'s `readyState === 1` filter skips the just-departed socket automatically."
    - "Single-source-of-truth broadcast on connect: because `sessions.broadcast` iterates the `clients` Set and the new ws was already added by the previous line, the broadcast reaches the new client too — no redundant per-client `ws.send` in the initial-payload block (RESEARCH §10 G8)."

key-files:
  created: []
  modified:
    - handlers.js (-88 / +17 — five `case 'remote.*':` arms deleted, remoteCliEnv + checkRemoteUpdate + cache vars deleted, two clients.count broadcasts added)

key-decisions:
  - "Per 15-CONTEXT.md D-02 / RESEARCH §1a: KEEP compareVersions, parseVersion, getInstalledVersion. They were grouped with the remote-update cache helpers in the original file but are SHARED dependencies of checkAvailability() (post-edit handlers.js:79-97), which is called on every onConnection to report per-agent installed-version + version-OK status. Deleting them would break agent presence detection."
  - "Per RESEARCH §10 G8: the connect-broadcast is the single source of truth. Do NOT also add a per-client ws.send in the initial-payload block — sessions.broadcast already reaches the just-added client because broadcast iterates the clients Set and the ws is in the set by the time the broadcast call iterates."
  - "Per RESEARCH §10 G7: there are TWO `ws.on('close', …)` handlers in onConnection — the heartbeat-cleanup one above and the clients-delete one below. Both fire in registration order (ws/EventEmitter semantics). The presence broadcast goes ONLY in the lower (clients-delete) handler for locality with the delete call."
  - "Phase 16 device.* arms (device.list.get at line ~681, device.revoke at line ~720) are untouched — disjoint message types, no overlap. Phase 16's WS auth infra (verifyClient / handleProtocols / ws.deviceId tagging) lives in server.js, not handlers.js, so nothing in this plan's edit surface touches it."
  - "Line numbers from 15-RESEARCH.md / 15-PATTERNS.md (pinned to pre-PR-#8 commit 9f6a111) drifted significantly after Phases 13–16 landed. Re-greped each splice anchor: `sessions.clients.add` (line 231), close handler (line 823), `case 'remote.*':` block (lines 766-815). Line-number contract re-verified pre-splice."

patterns-established:
  - "Presence broadcast on lifecycle hooks: when server-internal state changes (a client joins or leaves) need to fan out to every connected client, invoke `sessions.broadcast(...)` directly from the connect/close handler. No client-message case-arm pipeline involved. Pair with comment explaining (a) why the broadcast site exists, (b) the ordering rationale (add-before-broadcast on connect, delete-before-broadcast on close), (c) the single-source-of-truth note for new connections."

requirements-completed: [R1-server, R5-server]
# Note: R1 client-side deletion (public/*) is Plan 04's responsibility.
# Note: R5 client-side indicator wiring + render is Plan 05's responsibility.

# Metrics
duration: ~12 min
completed: 2026-06-09
---

# Phase 15 Plan 03: clideck-remote Server Retirement + clients.count Broadcast Summary

**handlers.js loses all five clideck-remote WS bridges and their supporting helpers (~88 LOC removed); gains two `clients.count` broadcasts on connect and close (~17 LOC added). Server-side R1 grep is clean. Plan 02's PTY-lock contract still holds. Phase 16's device-pairing infrastructure is untouched.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-09T12:11:00Z (approx; estimated from per-task verification timestamps)
- **Completed:** 2026-06-09T12:23:00Z
- **Tasks:** 1 (Task 3.1 — Delete clideck-remote bridges + add clients.count broadcasts)
- **Files modified:** 1 (handlers.js — -88 / +17)

## Accomplishments

### What goes (R1 server half — clideck-remote retirement)

Five `case 'remote.*':` arms in the `ws.on('message')` switch deleted:

| Arm | Behaviour (gone) |
|-----|------------------|
| `case 'remote.status'` | execFile `clideck-remote status --json` + checkRemoteUpdate(ws) |
| `case 'remote.pair'` | execFile `clideck-remote pair --json` |
| `case 'remote.unpair'` | execFile `clideck-remote unpair --json` |
| `case 'remote.getHistory'` | per-client transcript read (dead code — no client caller) |
| `case 'remote.install'` | spawn `npm install -g clideck-remote` + progress stream |

Supporting infrastructure also deleted:

- `remoteUpdateCache` / `remoteUpdateCheckedAt` / `REMOTE_UPDATE_INTERVAL` — module-level update-throttle cache (was used only by the deleted `checkRemoteUpdate`).
- `checkRemoteUpdate(ws)` — the once-per-hour `npm list -g clideck-remote` / `npm view clideck-remote version` bridge that broadcast `remote.update` frames.
- `remoteCliEnv()` — env-augmentation helper for clideck-remote child processes (no surviving caller after the case arms are gone).

### What stays preserved (per RESEARCH §10 G6)

- `compareVersions(a, b)` — generic version comparator.
- `parseVersion(text)` — `\b\d+\.\d+\.\d+\b` extractor.
- `getInstalledVersion(bin)` — runs `bin --version` / `bin -v` and parses.

These three were CO-LOCATED with the deleted update-check code, but they're called by the surviving `checkAvailability()` for every non-remote preset (`bin = binName(p.command)` → `getInstalledVersion(bin)` → `compareVersions(p.version, p.minVersion)`). Deleting them would break the agent-version display on every WS connect. Verified post-edit: `grep -c "^function (compareVersions|parseVersion|getInstalledVersion)" handlers.js` returns 3.

### What gets added (R5 server half — presence broadcast)

Two `sessions.broadcast({type:'clients.count', count: sessions.clients.size})` call sites, both inside `onConnection(ws)`:

#### 1. On connect (handlers.js:238)

```javascript
sessions.clients.add(ws);
// Phase 15 R5 / D-08+D-09: server-wide "other client connected" presence.
// `sessions.broadcast` iterates the `clients` Set with a `readyState === 1`
// guard (sessions.js:53-74), so this single fan-out reaches the just-added
// client too — no separate per-client ws.send needed in the initial-payload
// block. Fires AFTER `sessions.clients.add(ws)` so `count` already includes
// the new connection.
sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
```

Per RESEARCH §10 G8, this is the **single source of truth** for the new connection's "current count" message. Because `sessions.broadcast` iterates the `clients` Set (which the new ws is already a member of by line 231), the broadcast reaches the new client too. NO redundant per-client `ws.send({type:'clients.count', …})` in the initial-payload block at lines 254-262.

#### 2. On close (handlers.js:749-751)

```javascript
// Phase 15 R5 / D-08+D-09: presence-broadcast on disconnect. Delete FIRST so
// the `count` in the broadcast reflects the post-disconnect state seen by
// every surviving client. The heartbeat-cleanup ws.on('close', ...) above
// is a separate registration — both fire in registration order (ws/EE
// semantics, per RESEARCH.md G7). `sessions.broadcast` filters by
// readyState=1 so the just-departed ws is skipped automatically.
ws.on('close', () => {
  sessions.clients.delete(ws);
  sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
});
```

Delete-then-broadcast ordering means surviving clients observe the correctly-decremented count. `sessions.broadcast`'s `readyState === 1` filter automatically skips the just-departed socket.

### What stays untouched (re-execute hazard map)

Post-Phase-16 main introduced several new neighbours in `handlers.js` that were NOT in scope for 15-03. Preserving them was the trickiest part of the re-execute — line numbers drifted, but identifier-based grep located each splice anchor cleanly:

| Construct | Lines (post-edit) | Why untouched |
|-----------|------------------|---------------|
| `case 'device.list.get'` | ~681 | Phase 16 (D-06) — settings-panel pull for linked-devices admin |
| `case 'device.revoke'` | ~720 | Phase 16 (D-06) — revoke action with 4-step ordering |
| `case 'resize'` | ~340 | Plan 02 already made `sessions.resize()` a no-op (commit 5a0adee); dispatch stays so older clients keep sending |
| heartbeat `ws.on('close', () => clearInterval(heartbeat))` | ~286 | Separate close-handler registration. Both close handlers fire in registration order per ws/EE semantics (RESEARCH §10 G7) |
| Initial-payload sends (config / themes / presets / sessions / sessions.resumable / transcript.cache / plugins / pills / sendBuffers) | ~254-262 | New client picks up clients.count via the broadcast at the add-site — no extra ws.send needed |
| Phase 16 WS auth infra (`verifyClient` / `handleProtocols` / `ws.deviceId` tagging) | server.js:404-433 | Lives in `server.js`, not `handlers.js`. Confirmed via grep — no edit surface overlap |

## Verification Gates — All GREEN

### Syntax + grep gates

| Gate | Pattern | Expected | Actual |
|------|---------|----------|--------|
| `node --check handlers.js` | exit code | 0 | 0 |
| Server-side R1 union grep | `remote-modal\|clideck-remote\|remote\.(update\|error\|installing\|status\|pair\|unpair\|history\|paired\|unpaired\|install\.progress\|install\.done\|getHistory)\|remoteCliEnv\|remoteUpdateCache\|REMOTE_UPDATE_INTERVAL\|checkRemoteUpdate` | 0 matches | **0 matches** |
| `clients.count` broadcast | `clients\.count.*sessions\.clients\.size\|clients\.size.*clients\.count` | ≥ 2 | **2 matches** (lines 238 + 751) |
| Preserved helpers | `^function (compareVersions\|parseVersion\|getInstalledVersion)` | 3 | **3 matches** |
| `case 'remote.*':` arms | `case 'remote\.` | 0 | **0 matches** |
| Phase 16 device arms intact | `case 'device\.list\.get'\|case 'device\.revoke'` | 2 | **2 matches** (lines 681 + 720) |

### Test gates

| Test | Result | Notes |
|------|--------|-------|
| `npx vitest run tests/sessions-resize.test.js` | **3/3 GREEN** | Plan 02's PTY-lock contract still holds |
| Full vitest baseline | **27/29 files GREEN · 210/214 active tests pass** | See "Expected RED" below |
| `tests/other-client-indicator.test.js` | 4 RED | **Expected** — Plan 05's contract (needs `updateOtherClientIndicator` export from terminals.js) |
| `tests/creator-preflight-integration.test.js` | 8 skipped + file-level FAIL | **Expected** — documented environmental flake (`Timeout.tryConnect`) inherited from baseline |

### Boot smoke

```
CLIDECK_PORT=4099 CLIDECK_DATA_DIR=$(mktemp -d) timeout 4 node server.js
```

Output (excerpt):

- `[plugin] seeded autopilot / trim-clip / voice-input`
- `[clideck] bootstrap pair code: 2KU-AKN` (Phase 16's bootstrap-OTP banner — confirms Phase 16 infra still works)
- `[clideck] booted v1.31.17 pid=… bootId=… on 127.0.0.1:4099`
- ASCII clideck banner
- `▸ Ready at http://127.0.0.1:4099`
- Clean SIGTERM at timeout (exit 143)

**No error stacks. No EADDRINUSE on 4099. Bootstrap-OTP banner intact (Phase 16 unaffected).**

## What this Unblocks

- `e2e/clideck-remote-deletion.spec.js` — the server-side R1 grep portion is now satisfiable. Full E2E green still pending Plan 04's client-side sweep (public/index.html `#btn-remote` / `#remote-modal` / `#version-remote` + public/js/{app,settings,state}.js).
- `e2e/concurrent-input.spec.js` + the R5 indicator branch of the indicator-mutex tests — the server now broadcasts the `clients.count` message that the client needs to receive. Indicator DOM wiring + `updateOtherClientIndicator` export still pending Plan 05.

## Deviations from Plan

None. Plan 03 executed exactly as written. Three notes on re-execute-specific differences (not deviations, just transparent record):

1. **Line numbers drifted from RESEARCH.md / PATTERNS.md.** RESEARCH §1a pinned its line numbers to pre-PR-#8 main commit 9f6a111. After Phases 13–16 landed, the actual positions shifted (`sessions.clients.add` from 251 → 231, remote-case arms from 601-650 → 766-815, close handler from 658 → 823). Each splice anchor was re-located via identifier grep before edit, per the runtime_context guidance.
2. **`compareVersions` / `parseVersion` / `getInstalledVersion` preserved.** This was explicitly anticipated in 15-PLAN.md and RESEARCH §10 G6 — these three functions are shared dependencies of `checkAvailability()` and have non-remote consumers.
3. **Phase 16 coexistence verified.** The post-Phase-16 main introduced `case 'device.list.get'` and `case 'device.revoke'` in the same `switch (msg.type)` block where the remote arms used to live. Both were preserved untouched. Phase 16's WS auth infrastructure (`verifyClient`, `handleProtocols`, `ws.deviceId` tagging) lives in `server.js`, not `handlers.js`, so it was outside the edit surface — confirmed via grep.

## Commits

| Commit | Type | Summary |
|--------|------|---------|
| `f01d543` | feat | retire clideck-remote bridges + broadcast clients.count on connect/close |
| _(this commit)_ | docs | summary — clideck-remote server bridges retired, clients.count broadcast wired |

## Self-Check: PASSED

- handlers.js modifications committed in `f01d543` (verified via `git show --stat f01d543`).
- All success-criteria gates GREEN (see Verification Gates section above).
- No state-file updates required (non-standard GSD project, per runtime_context).
