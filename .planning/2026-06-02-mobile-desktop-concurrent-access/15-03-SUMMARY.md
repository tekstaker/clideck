---
phase: 15-mobile-desktop-concurrent-access
plan: 03
subsystem: server-websocket
tags: [r1, r5, deletion-sweep, broadcast, presence, clideck-remote-retirement]
requires:
  - 12-01  # wave 0 RED-state tests authored
  - 12-02  # sessions.resize lock (independent in this wave but landed first)
provides:
  - "Server-side R1 sweep — all clideck-remote bridges removed from handlers.js"
  - "{type:'clients.count', count:N} broadcast wiring on connect + close (D-08, D-09, D-11)"
affects:
  - handlers.js (-88, +5 net)
tech_stack:
  added: []
  patterns:
    - "WS broadcast on lifecycle event (connect/close) — same fan-out substrate as session.* messages"
key_files:
  created: []
  modified:
    - handlers.js
decisions:
  - "compareVersions / parseVersion / getInstalledVersion KEPT (consumed by checkAvailability — Phase 12 RESEARCH G6)"
  - "Single on-connect broadcast (no per-client ws.send in initial-payload) — sessions.broadcast iterates clients set and fans to the just-added new client per G8"
  - "Close handler extended in-place (block form) — both heartbeat and presence close handlers fire in registration order per G7"
  - "remoteCliEnv() deleted outright (no surviving consumers after the 5 case arms went)"
metrics:
  duration: "single-task plan, ~5 minutes wall"
  completed: 2026-06-02
  edits: 6
  files_modified: 1
  lines_deleted: 88
  lines_added: 5
---

# Phase 12 Plan 03: clideck-remote server bridges retired + clients.count broadcast wired — Summary

Removed the server-side `clideck-remote` plumbing entirely from `handlers.js` (R1, D-01..D-03) and added two `{type:'clients.count', count: sessions.clients.size}` broadcasts at the WebSocket connect/close lifecycle points (R5, D-08..D-11). One file changed, six logical edits, 88 lines deleted, 5 lines added, no regressions.

## What changed

### Deletions (R1 / D-02) — handlers.js

| Symbol | Original lines (HEAD~1) | Rationale |
|---|---|---|
| `// Check for clideck-remote updates (cached, once per hour)` comment | 46 | header for the cache state below |
| `let remoteUpdateCache = null;` | 47 | cached version-check result, dead with `checkRemoteUpdate` |
| `let remoteUpdateCheckedAt = 0;` | 48 | cache timestamp, dead |
| `const REMOTE_UPDATE_INTERVAL = 3600000;` | 49 | hour-throttle const, dead |
| `function checkRemoteUpdate(ws)` | 73–98 | the `npm list -g clideck-remote` / `npm view clideck-remote version` driver — only call site was the `case 'remote.status':` arm below |
| `function remoteCliEnv()` | 246–248 | only consumers were the 5 deleted case arms |
| `case 'remote.status':` block | 601–612 | execFile `clideck-remote status --json` + piggy-backed `checkRemoteUpdate(ws)` |
| `case 'remote.pair':` block | 614–621 | execFile `clideck-remote pair --json` |
| `case 'remote.unpair':` block | 623–632 | execFile `clideck-remote unpair --json` |
| `case 'remote.getHistory':` block | 634–637 | per-client transcript turn slice, only consumed by the retired mobile UI |
| `case 'remote.install':` block | 639–650 | `npm install -g clideck-remote` spawn + progress fan-out |

Total deletion: 88 source lines + their surrounding blank-line separators.

### Preservations (G6) — handlers.js

| Symbol | Why kept |
|---|---|
| `function compareVersions(a, b)` (now line 46) | Called by `checkAvailability` at line 75 to gate `versionOk` |
| `function parseVersion(text)` (now line 57) | Called by `getInstalledVersion` |
| `function getInstalledVersion(bin)` (now line 62) | Called by `checkAvailability` at line 74 |

All three are still consumed by the agent-version detection path (the Claude Code / Codex / Gemini-CLI / OpenCode binaries probed at startup). Verified `grep -cE "^function compareVersions\|^function parseVersion\|^function getInstalledVersion" handlers.js` → 3.

### Additions (R5 / D-08..D-11) — handlers.js

**Site 1 — onConnection (line 216):** Immediately after `sessions.clients.add(ws);`:

```javascript
function onConnection(ws) {
  sessions.clients.add(ws);
  sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
  // …heartbeat setup follows…
```

Per `sessions.broadcast` (sessions.js:36) iterating the `clients` Set with `readyState === 1` filter, this one call delivers the new count to every client INCLUDING the just-added one — no separate per-client `ws.send` is needed in the initial-payload block (which would have introduced a possible race with the fan-out, per RESEARCH §10 G8).

**Site 2 — onConnection close handler (lines 572–575):** Extended from the original one-line arrow:

```javascript
// Before
ws.on('close', () => sessions.clients.delete(ws));

// After
ws.on('close', () => {
  sessions.clients.delete(ws);
  sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
});
```

Delete BEFORE broadcast so remaining clients see the correct decremented count. The pre-existing `ws.on('close', () => clearInterval(heartbeat))` on line ~213 was NOT touched — both close handlers fire in registration order per `ws` event-emitter semantics (RESEARCH §10 G7); decoupling avoids any chance of the heartbeat's interval still ticking while we're broadcasting.

## Verification (all green)

| Gate | Command | Result |
|---|---|---|
| Syntax | `node --check handlers.js` | exit 0 |
| Module load | `node -e "const h = require('./handlers.js'); console.log(Object.keys(h))"` | `onConnection,getConfig` |
| Server-side R1 grep | `grep -cE "remote-modal\|clideck-remote\|remote\.(update\|error\|installing\|status\|pair\|unpair\|history\|paired\|unpaired\|install\.progress\|install\.done\|getHistory)\|remoteCliEnv\|remoteUpdateCache\|REMOTE_UPDATE_INTERVAL\|checkRemoteUpdate" handlers.js` | **0** |
| Broadcast call sites | `grep -cE "sessions\.broadcast.{0,40}clients\.count\|clients\.count.{0,40}sessions\.clients\.size" handlers.js` | **2** (connect + close) |
| Preserved helpers | `grep -cE "^function compareVersions\|^function parseVersion\|^function getInstalledVersion" handlers.js` | **3** |
| `remote.*` case arms | `grep -cE "case 'remote\." handlers.js` | **0** |
| Vitest unit suite | `npm run test` | **15/16 files green, 139/143 tests pass** |
| Boot smoke | `timeout 3 node server.js 2>&1 \| grep -cE "Error\|TypeError\|ReferenceError"` | **0** |

The 4 failing tests are all in `tests/other-client-indicator.test.js` — the **pre-existing RED-state contract** for `updateOtherClientIndicator` (the client-side state mutator). This is Plan 05's territory and was explicitly out of scope for Plan 03; `tests/sessions-resize.test.js` (Plan 02's GREEN contract) and `tests/display-sizing.test.js` (Phase 9) stay green.

## Deviations from Plan

None. Six edits as specified, broadcast positioning per PATTERNS.md §1, preservation set per RESEARCH §1a/G6, file diff matches the expected ~120-line server-side deletion budget (actual: 88 — slightly leaner because the comment block and blank-line separators packed tighter than the RESEARCH inventory estimated).

## Out-of-scope follow-ups (other plans)

| Item | Owner |
|---|---|
| Client-side R1 sweep — `public/index.html` `#remote-modal`, `#btn-remote`, `#version-remote`; `public/js/app.js` lines 1523–1816; `public/js/settings.js`, `public/js/state.js` residual handlers | **Plan 04** |
| `updateOtherClientIndicator(count)` export + DOM toggle on `.other-client-indicator` spans | **Plan 05** |
| Session-row glyph + colour choice for the indicator | **Plan 05 / UI-SPEC** |
| Two-client concurrent-attach Playwright validation (`e2e/concurrent-input.spec.js` flip to GREEN) | **Plan 04+05+06 integration wave** |
| Phone responsive walkthrough (≤480px), touch-keyboard verification (D-13/D-14) | **Plan 06** |

The Wave-0 grep gate in `e2e/clideck-remote-deletion.spec.js` (line 96 onwards) will not flip green until Plan 04 finishes the client-side deletions — the spec scans the whole repo, and the four `public/*` files still carry remote refs. That's expected and tracked.

## Self-Check: PASSED

- handlers.js: present (modified, 5 ins / 88 del per `git diff --stat`)
- Both broadcast call sites verified via `grep -nA 1 "sessions.clients.add"` and `grep -nA 2 "sessions.clients.delete"`
- All three preserved helpers verified via `grep -nE "^function compareVersions|^function parseVersion|^function getInstalledVersion"`
- Server-side R1 grep returns 0
- Vitest: 139 passing, 4 failing (all expected pre-existing Plan-05 RED)
- Boot smoke: clean, no stack traces

Commit hashes will be appended below by the verifier in the integration wave; the code commit lands first, this summary commits second.
