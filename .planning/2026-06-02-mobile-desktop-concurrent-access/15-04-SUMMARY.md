---
phase: 15-mobile-desktop-concurrent-access
plan: 04
subsystem: client-dashboard
tags: [r1, deletion-sweep, clideck-remote-retirement, client-side, dom, ws-arms, state-cleanup]
requires:
  - 12-01  # wave 0 RED-state tests authored (e2e/clideck-remote-deletion.spec.js)
  - 12-03  # server-side R1 sweep (handlers.js bridges retired)
provides:
  - "R1 client-side deletion sweep — all clideck-remote markup, state, settings, and driver removed from public/"
  - "Full-repo R1 grep is now clean (D-03 / RESEARCH §1h pattern returns zero matches outside CHANGELOG / .planning / approved e2e spec exemption)"
  - "Wave-0 e2e/clideck-remote-deletion.spec.js DOM-side gates flip RED → GREEN"
affects:
  - public/index.html (-94)
  - public/js/app.js (-368)
  - public/js/settings.js (-2)
  - public/js/state.js (-1)
tech_stack:
  added: []
  patterns:
    - "Surgical-deletion sweep across markup + driver + state in a single phase (D-01)"
    - "Atomic per-task commits with verbose context per CLAUDE.md §5"
key_files:
  created: []
  modified:
    - public/index.html
    - public/js/app.js
    - public/js/settings.js
    - public/js/state.js
decisions:
  - "Three sub-tasks of 4.2 (state.js / settings.js / app.js) merged into a single commit per the plan structure — together they're one logical 'JS trio R1 sweep'"
  - "Used Bash sed for the final ~150-line app.js range delete to bypass the Edit tool's literal-vs-rendered character mismatch on a \\u00b7 escape in source vs. middot character in the Read display"
  - "Wave-0 spec exempts itself from its own grep gate (line 131) — adopted the same exemption in the SUMMARY verification grep so the 'PASS' state matches the test's own definition of success"
  - "tests/other-client-indicator.test.js stays RED — Plan 05's territory (acceptance criterion documented as expected RED-state, NOT a regression)"
  - "Did NOT add otherClientsConnected to state.js (Plan 05), case 'clients.count': arm to app.js (Plan 05), or updateOtherClientIndicator helper (Plan 05) — sequence per plan dependency graph"
  - "Did NOT touch the @media (max-width: 960px) responsive CSS block at index.html line 60 — Plan 06's R6 territory"
metrics:
  duration: "~25 minutes wall, two atomic commits + one summary"
  completed: 2026-06-02
  edits: 6  # 3 Edits in index.html, 2 Edits + 1 sed in JS files
  files_modified: 4
  lines_deleted: 465  # 94 + 368 + 2 + 1
  lines_added: 0
commits:
  - 4476aff  # Task 4.1 — public/index.html R1 DOM sweep
  - 5a0f69a  # Task 4.2 — JS trio (app.js + settings.js + state.js) R1 sweep
---

# Phase 12 Plan 04: client-side R1 deletion sweep complete — Summary

Completed the client-side half of the Phase 12 R1 "surgical removal" contract — every reference to the retired `clideck-remote` integration is gone from the four client files (`public/index.html`, `public/js/app.js`, `public/js/settings.js`, `public/js/state.js`). 465 lines of dead code deleted, two atomic commits, no new code added. The full-repo R1 verification grep is now clean and the wave-0 `e2e/clideck-remote-deletion.spec.js` DOM-side gates flip RED → GREEN. The companion `npm run test` suite is 139/143 — the only reds are 4 tests in `tests/other-client-indicator.test.js` which assert on a helper Plan 05 still has to author (documented expected RED-state, not a regression).

## What changed

### Task 4.1 — public/index.html (commit 4476aff, -94 lines)

Three regions of the dashboard markup deleted in a single commit:

| Region | Original lines (HEAD~2) | Lines removed | Rationale |
|---|---|---|---|
| `#btn-remote` rail launcher | 154-156 | 3 | "Mobile Remote" rail button between `<div class="flex-1"></div>` and the theme/settings buttons; rail-bottom now reflows from 3 icons to 2 (theme + settings) automatically via flex per UI-SPEC §"Deletion contract → Rail layout reflow" |
| `#version-remote` row | 249 | 1 | The "clideck remote version:" row inside `#version-footer`; sibling `version-clideck` row preserved as the build-tag survivor |
| `<!-- Remote modal -->` + `<div id="remote-modal">…</div>` | 405-493 | 90 (88 content + comment + blank-separator) | Full modal markup including `#remote-intro`, `#remote-installing`, `#remote-connecting`, `#remote-qr`, `#remote-active`, `#remote-error` panes plus every child element (`#remote-add`, `#remote-close`, `#remote-copy`, `#remote-disconnect`, `#remote-disconnect2`, `#remote-error-dismiss`, `#remote-stat-time`, `#remote-stat-sessions`, `#remote-device-info`, `#remote-install-log`, `#remote-qr-img`, `#remote-url-box`, `#remote-intro-title`, `#remote-intro-text`, `#remote-intro-foot`, `#remote-error-text`) |

What stayed untouched per plan scoping:

- `@media (max-width: 960px)` block at line 60 (Plan 06 R6 territory).
- `<div class="flex-1"></div>` spacer at the (former) line 153 — flex handles rail reflow automatically.
- `#version-footer` container itself (only its remote-version child row deleted).
- `<!-- Confirmation dialog -->` (`#confirm-close`) at the next-sibling position — fully preserved with intact blank-line separator.
- Every other modal: `#settings-overlay`, `#folder-picker`, etc.

### Task 4.2 — JS trio (commit 5a0f69a, -371 lines across 3 files)

#### Sub-task 4.2a — public/js/state.js (-1 line)

Removed `remoteVersion: null,` (was line 13) from the state literal. Per 15-04-PLAN.md acceptance: "State.js literal does NOT yet contain `otherClientsConnected` (Plan 05 adds it; this task only removes `remoteVersion`)." The literal now has exactly 12 fields (was 13).

#### Sub-task 4.2b — public/js/settings.js (-2 lines)

Removed the two lines inside `updateVersionFooter` that read `#version-remote` and wrote `state.remoteVersion` (was lines 103-104). The function now matches 15-PATTERNS.md §5b's target shape exactly: read `#version-clideck`, set its `textContent` from `state.cfg.version`, then nudge `window.__refreshStatusBadge`.

#### Sub-task 4.2c — public/js/app.js (-368 lines)

Three deletion regions:

**A. `state.ws.onopen` initial-send (was line 107, 1 line)**

`send({ type: 'remote.status' });` removed. The `onopen` handler keeps `connectedAt = Date.now()`, `renderStatusBadge()`, `reconnectReplaySkip` setup, the post-reconnect toast suppression, and `startHeartbeat()`.

**B. WS `onmessage` switch — 7 `case 'remote.*':` arms (was lines 437-461, 25 lines)**

Removed in a single contiguous block:
- `case 'remote.status':` → `handleRemoteStatus(msg);`
- `case 'remote.paired':` → `handleRemotePaired(msg);`
- `case 'remote.unpaired':` → `handleRemoteUnpaired();`
- `case 'remote.error':` → `handleRemoteError(msg.error);`
- `case 'remote.install.progress':` → `appendInstallLog(msg.text);`
- `case 'remote.install.done':` → `handleInstallDone(msg.success);`
- `case 'remote.update':` → `remoteUpdateInfo` / `finishRemotePreflight()` logic

The `case 'plugin.delete.error':` arm before and the `default:` arm after now sit directly adjacent.

**C. Driver block (was lines 1523-1863, 342 lines)**

Module-level identifiers removed: `remoteModal`, `remotePanes`, `btnRemote`, `remoteInstalled`, `remoteState`, `remoteModalOpen`, `remoteStatusPoll`, `remoteConnectedAt`, `remoteStatsTimer`, `remoteUpdateInfo`, `remotePreflight`, `remoteLastStatus`, `remoteLocked`.

Driver functions removed: `startRemotePoll`, `stopRemotePoll`, `setRemotePane`, `showRemoteIntro`, `showRemoteUpdateRequired`, `finishRemotePreflight`, `openRemoteModal`, `closeRemoteModal`, `remoteLockKeyTrap`, `setRemoteLock`, `startRemoteStats`, `stopRemoteStats`, `updateRemoteStats`, `updateRemoteButton`, `handleRemoteStatus`, `handleRemotePaired`, `handleRemoteUnpaired`, `handleRemoteError`, `appendInstallLog`, `handleInstallDone`, `doRemoteDisconnect`.

Event listeners removed: rail button click, install button (`#remote-add`), close + error dismiss (`#remote-close`, `#remote-error-dismiss`), URL/copy clipboard listeners (`#remote-copy`, `#remote-url-box`), disconnect handlers (`#remote-disconnect`, `#remote-disconnect2`).

The next live module-bottom line `initDrag();` (was line 1865) is now adjacent to the closing brace of `initSessionScrollbarVisibility()` — verified explicitly because the success criteria gate on this exact boundary.

## Verification (all green except expected RED-state Plan-05 gate)

| Gate | Command | Result |
|---|---|---|
| index.html R1 DOM sweep | `grep -cE "btn-remote\|remote-modal\|version-remote" public/index.html` | 0 |
| index.html "Mobile Remote" copy | `grep -c "Mobile Remote" public/index.html` | 0 |
| index.html `version-clideck` preserved | `grep -c "version-clideck" public/index.html` | 1 (preserved) |
| state.js R1 sweep | `grep -c "remoteVersion" public/js/state.js` | 0 |
| settings.js R1 sweep | `grep -cE "remoteVersion\|version-remote" public/js/settings.js` | 0 |
| app.js case arms gone | `grep -cE "case 'remote\\." public/js/app.js` | 0 |
| app.js driver identifiers gone | `grep -cE 'remoteModal\|btnRemote\|remoteUpdateInfo\|remotePreflight\|remoteStatusPoll\|remoteLastStatus\|remoteState\|remoteInstalled\|remoteModalOpen\|handleRemote\|appendInstallLog\|finishRemotePreflight' public/js/app.js` | 0 |
| app.js `initDrag();` preserved | `grep -c initDrag public/js/app.js` | 2 (import + call site) |
| state.js syntax | `node --check --input-type=module < public/js/state.js` | OK |
| settings.js syntax | `node --check --input-type=module < public/js/settings.js` | OK |
| app.js syntax | `node --check --input-type=module < public/js/app.js` | OK |
| Full-repo R1 union grep | `git grep -nE "[D-03 pattern]" -- ':!CHANGELOG.md' ':!.planning/' ':!docker-compose*.yml' ':!Dockerfile*' ':!e2e/clideck-remote-deletion.spec.js'` | zero matches |
| Unit suite | `npm run test` | 15/16 files green, 139/143 tests green |

### About the `node --check` invocation

The repo's `package.json` declares `"type": "commonjs"` (verified in 15-RESEARCH.md §"Project Constraints"), but the `public/js/*.js` files use ES module syntax (`import` / `export`) because they're served as `<script type="module">` from the browser. `node --check path/to/file.js` reads `package.json` and assumes commonjs, which produces a misleading `SyntaxError: Unexpected token 'export'` for any of these files even when they're perfectly valid ESM. The acceptance criteria's `node --check` step is satisfied by piping the file into `node --check --input-type=module <` instead, which tells Node to parse as ESM regardless of the package context. All three files passed.

### About the unit suite's 4 reds

`tests/other-client-indicator.test.js` exercises a yet-to-exist `updateOtherClientIndicator` export from `public/js/terminals.js` — that helper plus the matching DOM indicator markup, the `case 'clients.count':` WS arm, the `otherClientsConnected` state flag, and the `tailwind.css` rebuild for `text-amber-400` all land in Plan 05. The 4 reds are exactly the RED-state contract documented in 15-04-PLAN.md's acceptance criteria: "other-client-indicator stays RED (Plan 05 not yet landed)". `tests/sessions-resize.test.js` (Plan 02), `tests/display-sizing.test.js` (Phase 9 + this plan), and every other unit test file remain green.

### About the full-repo R1 grep's self-exemption

The Wave-0 spec at `e2e/clideck-remote-deletion.spec.js` itself contains literal occurrences of every R1 pattern string — by design — because that's where the test's `git grep` is constructed from a `pattern = [...].join('|')` array literal. The spec exempts itself from its own grep gate via `':!e2e/clideck-remote-deletion.spec.js'` (line 131). The plan's acceptance grep doesn't explicitly list that exemption but the wave-0 spec's exemption IS the canonical R1 gate, so this SUMMARY's verification table adopts the same exemption. Without that exemption the grep would return the spec's own pattern-array entries (a known artifact, not a real R1 leak). With it, the result is the genuine "zero matches" the contract requires.

## Deviations from plan

### Implementation-shape adjustments

**1. [Rule 3 — Blocker] Edit tool `·` mismatch — switched to `sed` for the final app.js chunk**

The Edit tool replaced a multi-hundred-line region in app.js by exact-text match. One line inside `handleRemoteStatus` (line 1710 in the pre-deletion file) contains the literal seven-character escape `·` in source (since the surrounding string is a single-quoted JS literal, not a template string), but the Read tool's display rendered it as a real middle-dot character. After two Edit attempts produced "String to replace not found in file" with the tool's own escape-vs-render hint, I split the deletion into 4 smaller Edit chunks and used `sed -i '1497,1650d'` for the final range containing the problem line. End-state byte-identical; commit content unaffected. Tracked here as a deviation in *method* rather than *outcome*.

**2. [Rule 3 — Blocker] `node --check` failed on ESM source without `--input-type=module`**

The plan's acceptance gate of `node --check public/js/*.js` produced spurious `SyntaxError: Unexpected token 'export'` because the repo's `package.json` is `"type": "commonjs"` but these files are ESM. Worked around with `node --check --input-type=module < public/js/file.js`. End-state: all three files parse cleanly as ESM. Documented in the verification table.

No code behavior changed, no semantic deviation from the plan.

### Out-of-scope items NOT touched

Per the plan's scope boundary and the dependency graph in 15-04-PLAN.md `depends_on: [12-01]` plus the wave-3 layout:

- **`otherClientsConnected: false` field NOT added to state.js** → Plan 05's territory.
- **`case 'clients.count':` arm NOT added to app.js** → Plan 05 (depends on `updateOtherClientIndicator` import from terminals.js, which Plan 05 creates).
- **`.term-wrap { overflow-x: auto }` CSS NOT added to the `@media (max-width: 960px)` block at index.html line 60** → Plan 06's R6 territory.
- **`text-amber-400` Tailwind rebuild NOT executed** → Plan 05's territory.
- **`updateOtherClientIndicator` helper NOT added to terminals.js** → Plan 05.

## Authentication gates

None. Plan executed without any environmental, credential, or auth interaction.

## Threat Flags

None. All deletions; no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Known Stubs

None. All deletions are complete; no half-wired data sources or placeholder UI introduced. The dashboard's rail-bottom now contains exactly two buttons (theme + settings), with flex correctly reflowing per UI-SPEC.

## TDD Gate Compliance

Plan 04 is `type: execute`, NOT `type: tdd`. The wave-0 RED-state contract at `e2e/clideck-remote-deletion.spec.js` was authored in Plan 01 (wave 0), and this plan's two commits flip those DOM-side gates from RED → GREEN. The matching unit-test gates for the indicator helper (`tests/other-client-indicator.test.js`) remain RED by design — they're Plan 05's RED → GREEN contract.

## Self-Check

**1. Created files exist:**

- `.planning/2026-06-02-mobile-desktop-concurrent-access/15-04-SUMMARY.md` → this file (being authored)

**2. Modified files match the plan's `files_modified` list:**

```
$ git show --stat 4476aff
 public/index.html | 94 -------------------------------------

$ git show --stat 5a0f69a
 public/js/app.js      | 368 --------------------------------------------------
 public/js/settings.js |   2 -
 public/js/state.js    |   1 -
 3 files changed, 371 deletions(-)
```

Both commits exactly the 4 files declared in `15-04-PLAN.md` `files_modified:`. ✔

**3. Commits exist and are reachable from current HEAD:**

```
$ git log --oneline | grep -E '^(4476aff|5a0f69a)'
5a0f69a feat(public): retire clideck-remote driver + state + settings — full-repo R1 grep now clean (Phase 12 R1 / D-01..D-03)
4476aff feat(public): delete clideck-remote DOM markup — rail button, version row, modal block (Phase 12 R1 / D-01..D-03)
```

Both commits present. ✔

**4. Acceptance criteria from 15-04-PLAN.md success_criteria:**

- [x] public/index.html: btn-remote, remote-modal, version-remote DOM all gone (Task 4.1 commit)
- [x] public/js/app.js: send remote.status removed; 7 case arms removed; driver block removed; initDrag() at line 1497 (post-deletion) still live (Task 4.2 commit)
- [x] public/js/settings.js: version-remote read removed; version-clideck stays (Task 4.2 commit)
- [x] public/js/state.js: remoteVersion field removed; otherClientsConnected NOT yet added (Plan 05's territory) (Task 4.2 commit)
- [x] Full-repo R1 grep returns zero matches per D-03 / RESEARCH §1h pattern (with wave-0 spec self-exemption per the spec's own internal definition)
- [x] Unit suite passes (`npm run test` exit code reflects test failures, but the only reds are 4 tests in tests/other-client-indicator.test.js — the documented expected Plan-05 RED-state gate, NOT a regression)
- [x] Commit messages verbose per CLAUDE.md §5, references R1 + D-01..D-03

## Self-Check: PASSED

All acceptance criteria satisfied; all gates green (or RED by documented design); both per-task commits present and reachable.

## What lands in Plan 05

The companion plan in this wave (12-05) is responsible for:
1. Adding `otherClientsConnected: false` to `public/js/state.js`.
2. Adding the new `case 'clients.count':` arm to `public/js/app.js`'s WS switch.
3. Importing `updateOtherClientIndicator` from `./terminals.js` in `app.js`.
4. Adding the indicator span markup (two outlined amber circles SVG) into both `addTerminal` and `buildResumableRow` row templates in `public/js/terminals.js`.
5. Adding the new `updateOtherClientIndicator(count)` export to `public/js/terminals.js`.
6. Running `npm run build:css` so the `text-amber-400` utility class compiles into the shipped `public/tailwind.css`.
7. Optionally activating the D-15 contingency `touchstart → focusTerminal()` listener if D-13 mobile-emulation verification fails.

Plan 05 is the matching RED → GREEN gate for `tests/other-client-indicator.test.js` plus the corresponding wave-0 `e2e/session-indicator-mutex.spec.js` extension if any. Plan 06 carries the `.term-wrap { overflow-x: auto }` extension to the existing `@media (max-width: 960px)` block.

---

*Phase 12 Plan 04 complete — 2026-06-02*
*Commits: 4476aff (Task 4.1 markup) + 5a0f69a (Task 4.2 JS trio) + this SUMMARY*
