---
phase: 15-mobile-desktop-concurrent-access
plan: 04
subsystem: public/{index.html, js/{app,settings,state}.js}
tags: [R1, deletion-sweep, client-side, phase-15]
requires: [15-01, 15-02, 15-03]
provides: full-repo-R1-grep-clean
affects: [public/index.html, public/js/app.js, public/js/settings.js, public/js/state.js]
tech_stack:
  added: []
  removed: [clideck-remote-client-driver, remote.*-WS-arms, state.remoteVersion]
key_files:
  modified:
    - public/index.html (rail button + version-remote row + #remote-modal block removed)
    - public/js/app.js (onopen remote.status + 7 onmessage arms + 340-line driver block removed)
    - public/js/settings.js (version-remote read in updateVersionFooter removed)
    - public/js/state.js (remoteVersion field removed)
decisions: [D-01, D-02, D-03]
metrics:
  duration_minutes: ~12
  completed: 2026-06-09
  tasks_completed: 2
  files_modified: 4
  loc_deleted: 465
  loc_added: 0
---

# Phase 15 Plan 04: Client-side R1 deletion sweep Summary

One-liner: completed the R1 client-side `clideck-remote` retirement — rail
button, modal markup, WS handler arms, 340-line driver block, version-footer
read, and `state.remoteVersion` field all gone; the full-repo R1 grep
(verbatim from D-03 / RESEARCH §1h) now returns zero matches outside
CHANGELOG / .planning / Docker artefacts / the e2e contract spec.

## Context

Wave-2 execution against post-Phase-16 main (HEAD 9ab5a17, branch
feat/mobile-desktop-concurrent-access-v2). This plan was originally
authored against 9f6a111 but Phase 16 PR #15 landed between authoring
and execution, drifting line numbers significantly. The plan's
runtime_context (Plans 4.1 + 4.2) explicitly enumerated Phase 16 surface
to preserve; all splice anchors were re-grepped before each Edit rather
than using the RESEARCH §1c-1e line numbers verbatim.

## Tasks Completed

### Task 4.1 — public/index.html DOM deletions (commit 51ec2d0)

Three deletion sites:

1. **Rail button** (was line 154-156): `<button id="btn-remote"
   title="Mobile Remote">…</button>` — the phone-shaped SVG launcher in
   the rail's bottom-section icon stack. The preceding `<div
   class="flex-1"></div>` spacer was preserved (flex handles the reflow
   per 15-UI-SPEC "Rail layout reflow"; bottom-section icon stack
   shrinks from 3 → 2: theme + settings).

2. **Sidebar version-footer row** (was line 262): `<div class="text-slate-600">clideck
   remote version: <span id="version-remote"
   class="text-slate-500"></span></div>`. The sibling `version-clideck`
   row above survives.

3. **Modal block** (was lines 409-497 — 89 lines): `<!-- Remote modal -->`
   comment + entire `<div id="remote-modal">…</div>` block. Contained
   "Mobile Remote" heading, `#remote-close`, `#remote-intro` (with "Add
   to CliDeck" + "Installs the clideck-remote package via npm"),
   `#remote-installing` (with "Installing clideck-remote…"),
   `#remote-connecting` (with "Connecting to relay…"), `#remote-qr`
   (QR scan + copy link), `#remote-active` (Connected stats),
   `#remote-error`. End boundary verified to be immediately before the
   surviving `<!-- Confirmation dialog -->` `#confirm-close` block.

**File shrank:** 543 → 449 lines (94 lines deleted; matches plan
estimate of ~92).

**Phase 16 surface preserved:** `@media (max-width: 960px)` block
intact (Plan 05 will extend it with R6 CSS), `#mobile-nav-toggle` and
`#mobile-nav-close` markup intact, `#settings-devices` settings panel +
`#linked-devices-list` container (added by Phase 16 PR #15) intact.

### Task 4.2 — JS trio sweep (commit 8826a0c)

**Sub-task 4.2a — public/js/state.js:** Removed `remoteVersion: null,`
from the state literal (the only line touched). Phase 16's
`linkedDevices: []` and `deviceId: null` fields preserved with their
multi-line comments.

**Sub-task 4.2b — public/js/settings.js:** Removed the two-line
`version-remote` read inside `updateVersionFooter`:

```
const remoteEl = document.getElementById('version-remote');
if (remoteEl) remoteEl.textContent = state.remoteVersion || '';
```

The `version-clideck` read above stays; the `window.__refreshStatusBadge()`
nudge below stays. Phase 16's `renderLinkedDevices` (settings.js lines
134-174 post-edit), `window.__refreshLinkedDevices` hook, and the
delegated revoke click handler on `#linked-devices-list` were not
touched.

**Sub-task 4.2c — public/js/app.js:** Three edits (largest file
deletion in the plan):

- **Edit A (was line 158):** Removed the lone `send({ type:
  'remote.status' });` inside `state.ws.onopen`, between
  `startHeartbeat();` and Phase 16's `send({ type: 'device.list.get' });`.
- **Edit B (was lines 534-558):** Removed all 7 `case 'remote.*':`
  arms in the onmessage switch — `remote.status`, `remote.paired`,
  `remote.unpaired`, `remote.error`, `remote.install.progress`,
  `remote.install.done`, `remote.update`. The `case 'plugin.delete.error':`
  arm above and the `default:` branch below stitched together cleanly.
  Phase 16's `case 'device.list'` / `case 'device.revoked'` /
  `case 'device.revoke.result':` arms (which sit above the deleted
  block) were preserved.
- **Edit C (was lines 1630-1970 — 341 lines):** Removed the entire
  `// --- Remote (thin connector to clideck-remote CLI) ---` driver
  block. Includes the module-level identifiers (`remoteModal`,
  `btnRemote`, `remotePanes`, `remoteUpdateInfo`, `remotePreflight`,
  `remoteStatusPoll`, `remoteLastStatus`, `remoteState`,
  `remoteInstalled`, `remoteModalOpen`), the handler functions
  (`handleRemoteStatus`, `handleRemotePaired`, `handleRemoteUnpaired`,
  `handleRemoteError`, `appendInstallLog`, `handleInstallDone`,
  `finishRemotePreflight`, `setRemotePane`, `startRemotePoll`,
  `stopRemotePoll`, `startRemoteStats`, `openRemoteModal`,
  `closeRemoteModal`, `doRemoteDisconnect`), and the DOM event
  listeners on `#remote-close`, `#remote-error-dismiss`, `#remote-copy`,
  `#remote-url-box`, `#remote-disconnect`, `#remote-disconnect2`, and
  the rail-button `#btn-remote` click.

  Verified: the next live line after the deleted block, `// ── Font-size
  keyboard shortcuts (Phase 9 — terminal display sizing) ──`, is
  preserved. `initDrag();` near the file tail is preserved.

  **NO** `case 'clients.count':` arm was added here — that's Plan 05's
  territory (it imports `updateOtherClientIndicator` from terminals.js
  which Plan 05 modifies).

**file shrank:** 2071 → 1703 lines (368 lines deleted).

**Phase 16 surface preserved:**
- WS subprotocol injection on `new WebSocket(...)` —
  `clideck-device-v1.{token}`.
- Boot-time `localStorage.getItem('clideck.deviceToken')` /
  `clideck.deviceId` redirect gate.
- `state.ws.onclose` hybrid auth-fail handler — code 4401 OR
  1006-with-token-and-never-connected → clear localStorage + redirect
  to /pair.
- Three `case 'device.*':` WS arms.

## Splice Anchors (Current Line Numbers)

| File | Pre-Phase-16 anchor (RESEARCH §1) | Actual post-Phase-16 anchor |
|------|-----------------------------------|------------------------------|
| public/index.html — btn-remote | line 154 | line 154 (unchanged) |
| public/index.html — version-remote row | line 249 | line 262 (drifted +13) |
| public/index.html — modal block start | line 405 (comment) | line 409 (drifted +4) |
| public/index.html — modal block end | line 493 | line 497 (drifted +4) |
| public/js/app.js — send remote.status in onopen | line 107 | line 158 (drifted +51) |
| public/js/app.js — first case 'remote.*' arm | line 437 | line 534 (drifted +97) |
| public/js/app.js — last case 'remote.update' break | line 461 | line 558 (drifted +97) |
| public/js/app.js — driver block start | line 1523 | line 1630 (drifted +107) |
| public/js/app.js — driver block end | line 1863 | line 1970 (drifted +107) |
| public/js/app.js — initDrag(); (preserved) | line 1865 | line 1972 → 1631 post-deletion |
| public/js/settings.js — version-remote read | lines 103-104 | lines 258-259 (drifted ~+155) |
| public/js/state.js — remoteVersion field | line 13 | line 13 (unchanged) |

Plan 05 deltas (Phase 16 added):
- public/index.html `#settings-devices` settings panel + `#linked-devices-list`
  list container.
- public/js/state.js `linkedDevices: []` (line 17) + `deviceId: null` (line 22).
- public/js/settings.js `renderLinkedDevices` function (lines 134-174) +
  `window.__refreshLinkedDevices` hook (line 179) + delegated revoke
  click handler (lines 194-221).
- public/js/app.js WS subprotocol on `new WebSocket(...)` + boot
  localStorage gate + 3x `case 'device.*':` arms + `case 'closed':`
  4401-onclose-hybrid auth-fail handler.

## Verification

### Full-repo R1 grep (D-03 gate)

```
git grep -nE "remote-modal|clideck-remote|remote\.(update|error|installing|status|pair|unpair|history|paired|unpaired|install\.progress|install\.done|getHistory)|btn-remote|version-remote|remoteCliEnv|remoteUpdateCache|REMOTE_UPDATE_INTERVAL|checkRemoteUpdate|remoteVersion|remoteUpdateInfo|remotePreflight|remoteStatusPoll|remoteState|remoteInstalled|remoteModalOpen|remoteLastStatus|btnRemote|remoteModal" -- ':!CHANGELOG.md' ':!.planning/' ':!docker-compose*.yml' ':!Dockerfile*' ':!e2e/clideck-remote-deletion.spec.js'
```

Returns **zero matches** (exit 1).

Note: the e2e contract spec `e2e/clideck-remote-deletion.spec.js`
itself contains the R1 patterns as test assertions (it asserts
`toHaveCount(0)` on `#btn-remote`, `#remote-modal`, `#version-remote`
selectors); per the plan's verification block it is explicitly excluded
from the grep.

### Syntax check (all 3 ESM files parse)

Workaround for `node --check` defaulting to CommonJS: copied each file
to `/tmp/*.mjs` and ran `node --check` against the `.mjs` copy.

- `public/js/state.js` — OK
- `public/js/settings.js` — OK
- `public/js/app.js` — OK

### Test suite (`npm run test`)

Vitest matrix: **2 files failed, 27 passed, 1 file-level timeout
(skipped). Tests: 4 failed, 210 passed, 8 skipped (222 total).**

Per the plan's expected baseline:

| Suite | Status | Notes |
|-------|--------|-------|
| `tests/sessions-resize.test.js` | **3/3 GREEN** | Plan 02 contract — preserved. |
| `tests/other-client-indicator.test.js` | **4/4 RED** | Plan 05 contract — `updateOtherClientIndicator` not yet exported from terminals.js (Plan 05 adds it). Failure mode: `TypeError: updateOtherClientIndicator is not a function`. Expected. |
| `tests/creator-preflight-integration.test.js` | **File-level Timeout, 8 skipped** | Pre-existing environmental flake at tryConnect line 77. Unchanged from baseline. |
| All other suites | **GREEN** | 210 passed including Phase 16's vitest tests. |

No new regressions introduced.

### Playwright E2E

Not run in this execution (no Chromium libs available in the sandbox).
The e2e contract `e2e/clideck-remote-deletion.spec.js` was authored as
Wave-0 RED and is expected to flip GREEN after this plan; verification
will happen at the Phase 15 closeout when full Playwright runs are
available.

## Deviations from Plan

None — plan executed exactly as written. The runtime_context warned about
Phase 16 drift across all 4 files; that drift was confirmed by re-grep
before each Edit and all preservation markers held intact.

## Self-Check

Files modified are present in HEAD~1 (Task 4.1, commit 51ec2d0) and HEAD
(Task 4.2, commit 8826a0c) with the expected deletion counts:

```
51ec2d0  1 file changed,  94 deletions(-)
8826a0c  3 files changed, 371 deletions(-)
```

Total: 4 files, 465 lines deleted, 0 added.

Plan 05 will follow up in Wave 3 to add the R5 client wiring (state
`otherClientsConnected`, indicator markup in terminals.js, `case
'clients.count':` WS arm in app.js with `updateOtherClientIndicator`
import) and the R6 CSS (`overflow-x: auto` on `.term-wrap` inside the
existing 960px block).

## Self-Check: PASSED

Verified:
- commit 51ec2d0 exists in `git log`.
- commit 8826a0c exists in `git log`.
- public/index.html: 449 lines, 0 R1 markers.
- public/js/app.js: 1703 lines, 0 R1 union grep matches, 3 Phase 16
  `case 'device.*':` arms preserved, 2 `initDrag` references preserved.
- public/js/settings.js: 783 lines, 0 R1 markers, `renderLinkedDevices`
  function preserved.
- public/js/state.js: 39 lines, 0 R1 markers, `linkedDevices` and
  `deviceId` fields preserved.
- Full-repo R1 grep: 0 matches (D-03 gate satisfied).
- `npm run test`: baseline preserved (sessions-resize GREEN,
  other-client-indicator RED, creator-preflight environmental).
