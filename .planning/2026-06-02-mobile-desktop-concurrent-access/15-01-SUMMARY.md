---
phase: 15-mobile-desktop-concurrent-access
plan: 01
subsystem: testing
tags: [tdd, vitest, playwright, wave-0, re-execute]
type: execute
status: complete
wave: 0
re_executed: true
re_execute_baseline_branch: feat/mobile-desktop-concurrent-access-v2
re_execute_baseline_head: 13f345e
re_execute_prior_branch: feat/mobile-desktop-concurrent-access
re_execute_prior_head: d13c978
dependency_graph:
  requires: []
  provides:
    - "tests/sessions-resize.test.js — vitest unit R2 gate"
    - "tests/other-client-indicator.test.js — vitest unit R5 + G9 gate"
    - "e2e/clideck-remote-deletion.spec.js — Playwright R1 gate"
    - "e2e/pty-size-locked.spec.js — Playwright R2 E2E gate"
    - "e2e/mobile-touch.spec.js — Playwright R3 mobile-context gate"
    - "e2e/concurrent-input.spec.js — Playwright R4 + R5 two-context gate"
    - "e2e/mobile-viewport.spec.js — Playwright R6 mobile-context gate"
    - "e2e/session-indicator-mutex.spec.js (extended) — R5 slot non-collision gate"
  affects:
    - "Plans 02–05 — failing tests are the GREEN-gate contracts they implement against"
    - "Plan 06 (15-06 VERIFICATION) — these specs are the suite Wave 3 runs"
tech_stack:
  added: []
  patterns:
    - "vitest @vitest-environment node — freshSessionsModule + vi.fn() pty spy (analog: tests/session-pause.test.js)"
    - "vitest @vitest-environment happy-dom — state.js + terminals.js import + per-test reset (analogs: tests/font-size-clamp.test.js, tests/terminal-size-estimate.test.js)"
    - "Playwright single-context + inline installWsRecorder/waitForAppReady/spawnSession helpers (analog: e2e/smoke.spec.js + e2e/session-indicator-mutex.spec.js)"
    - "Playwright two-context — browser.newContext × 2 inside the shared single-worker server (15-PATTERNS.md §14b derivation)"
    - "Playwright mobile-context — browser.newContext({ ...devices['iPhone 12'] }) (15-PATTERNS.md §13/§15 derivation; no in-repo precedent)"
key_files:
  created:
    - tests/sessions-resize.test.js
    - tests/other-client-indicator.test.js
    - e2e/clideck-remote-deletion.spec.js
    - e2e/pty-size-locked.spec.js
    - e2e/mobile-touch.spec.js
    - e2e/concurrent-input.spec.js
    - e2e/mobile-viewport.spec.js
  modified:
    - e2e/session-indicator-mutex.spec.js
decisions:
  - "Used the richer WS recorder from session-indicator-mutex.spec.js (records __rxMessages array, not just __rxTypes Set) as the canonical inline-helper shape in all five new specs. R2/R4/R5 specs need to filter received messages by type and read m.data, which the leaner smoke.spec.js variant cannot do."
  - "Extended spawnSession to accept { cols, rows } via opts parameter rather than introducing a parallel spawnSessionSized helper. Keeps the helper surface area small and matches 15-PATTERNS.md §12a guidance."
  - "Test describe / it labels use 'Phase 15' (per the renumbering note in SPEC.md, applied forward to new code), even though planner-locked describe strings in 15-PATTERNS.md §9c read 'Phase 12 R2'. The runtime_context for this dispatch said to label new code as 'Phase 15' — labels in the two vitest files reflect that."
  - "Inlined helpers verbatim in every new spec rather than introducing e2e/helpers.js. Matches Shared 7 + 15-PATTERNS.md guidance that creating helpers.js was deliberately out of scope for this plan; the 5x duplication is intentional for now."
  - "Did NOT include a creator-preflight regression in this plan. tests/creator-preflight-integration.test.js fails with 'server boot timeout' on current main as a pre-existing environmental issue (the test spawns its own server child-process which times out in WSL2). Confirmed independent of this plan's changes: that file has zero imports from the new test files. Documented as out-of-scope under 'Pre-existing baseline failures' below."
metrics:
  duration_minutes: 12
  completed_date: "2026-06-09"
  files_created: 7
  files_modified: 1
  tests_authored: 16
  vitest_files_red: 2
  vitest_tests_red: 5
  playwright_specs_authored: 5
  playwright_specs_extended: 1
  baseline_vitest_files_passed: 26
  baseline_vitest_tests_passed: 209
  baseline_vitest_tests_skipped: 8
---

# Phase 15 Plan 01: Wave 0 — Author Failing Tests Summary

Authored 7 new test/spec files and extended 1 existing spec as the TDD RED-state
contracts that Plans 02–05 will turn green. Per CLAUDE.md §2 these tests are the
DEFINITION OF DONE for the implementation plans; per CLAUDE.md §1 the RED state
is honestly documented in commits + here rather than pretended green.

## Re-execute context

This is the **second execution** of Phase 15's plans. The first execution was on
the orphan-branch `feat/mobile-desktop-concurrent-access` (preserved locally at
HEAD `d13c978` for reference). The branch never merged because origin/main moved
forward with Phases 9–14 plus Phase 16 (device-pairing), and the orphan-branch
work was rebased / salvaged onto a fresh branch `feat/mobile-desktop-concurrent-access-v2`
pointed at current main (HEAD `13f345e`).

Effects of running against post-Phase-16 main rather than pre-PR-#8 main:

| Pre-PR-#8 main reference                    | Current main (post-Phase-16)                   | Impact on this plan                                                                                  |
| ------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sessions.js:368 function resize(msg)`      | `sessions.js:417 function resize(msg)`         | Line drifted +49; body identical. R2 contract unchanged.                                             |
| `public/js/state.js` literal (3 fields)     | Now includes `linkedDevices` + `deviceId`       | No collision with the future `otherClientsConnected` Phase 15 addition.                              |
| 4 Settings panel sections                   | 5 (Phase 16 added "Linked devices")            | R6 walkthrough may surface a Phase 16-shaped overflow not present in original execution.             |
| WS upgrade unauthenticated                  | Requires `clideck-device-token` Sec-WS-Protocol header unless bootstrap-mode | Playwright specs run in bootstrap mode (empty devices.json) so upgrades succeed.                     |
| `tests/terminal-focus.test.js` (analog)     | does not exist on current main                 | Used `tests/font-size-clamp.test.js` + `tests/terminal-size-estimate.test.js` as happy-dom analogs.  |
| `tests/display-sizing.test.js` (baseline)   | does not exist on current main                 | Used `tests/font-size-clamp.test.js` + `tests/terminal-size-estimate.test.js` for the baseline regression check (both stayed GREEN: 16/16 tests). |

The locked contracts (test assertions, exact DOM markup, exported names, AC
patterns) remained valid; only line numbers and analog-file names drifted.

## Files authored

### `tests/sessions-resize.test.js` (R2 — vitest unit gate)

- **Environment:** `@vitest-environment node`
- **Analog:** `tests/session-pause.test.js` — same `freshSessionsModule` helper,
  same per-test `CLIDECK_DATA_DIR` tmpdir setup, same `vi.fn()` PTY-spy idiom
  (spy target switched from `pty.kill` to `pty.resize`).
- **Tests:** 3 (sessions.resize on known id does not invoke pty.resize spy;
  ghost id does not throw; empty message does not throw).
- **Describe label:** `'sessions.resize — locked at session creation (Phase 15 R2)'`
- **Expected RED-state reason today:** Current `sessions.js:417` reads
  `function resize(msg) { sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows); }`
  so Test 1 fails with `expected "vi.fn()" to not be called at all, but actually
  been called 1 times with [40, 10]`. Confirmed via direct run.
- **Turns green via:** Plan 15-02 (R2 server no-op).

### `tests/other-client-indicator.test.js` (R5 + G9 — vitest unit gate)

- **Environment:** `@vitest-environment happy-dom`
- **Analogs:** `tests/font-size-clamp.test.js` + `tests/terminal-size-estimate.test.js`
  — same `import { state } from '../public/js/state.js'` +
  `import { ... } from '../public/js/terminals.js'` shape, same per-test
  `state.X = default; document.body.innerHTML = ''` reset.
- **Tests:** 4 (count > 1 removes .hidden; count <= 1 re-adds .hidden;
  G9 newly-added row inherits the visible state; empty DOM is a no-op + flag still updates).
- **Describe label:** `'updateOtherClientIndicator (Phase 15 R5)'`
- **Expected RED-state reason today:** `public/js/terminals.js` does not yet
  export `updateOtherClientIndicator`, so the named import resolves to `undefined`
  and every test fails at the `expect(() => updateOtherClientIndicator(...))` call
  with `TypeError: ... is not a function`. Confirmed via direct run.
- **Turns green via:** Plan 15-05 (R5 client indicator markup + updater export).

### `e2e/clideck-remote-deletion.spec.js` (R1 — Playwright)

- **Analog:** `e2e/smoke.spec.js` — same `pageerror` + `console.error` listener
  pattern, same `installWsRecorder` + `waitForAppReady` shape.
- **Tests:** 2 (DOM absence + console-error gate; automated repo `git grep` gate
  per CONTEXT D-03 with exemptions for CHANGELOG.md, .planning/, docs/, README.md,
  lib/install-clideck-remote*, docker-compose*, Dockerfile*, .docker/, and the
  spec file itself).
- **Expected RED-state reason today:** Per pre-execute grep on current main —
  `public/index.html` still carries `#btn-remote` (line 154), `#remote-modal`
  (line 414), `#version-remote` (line 262); `handlers.js` still has 5 case arms
  for `remote.{status, pair, unpair, getHistory, install}` (lines 766+);
  `public/js/app.js` still has the entire remote-modal driver block
  (lines 1656+). All deleted by Plan 15-04.
- **Turns green via:** Plan 15-04 (R1 deletion sweep + grep verification).

### `e2e/pty-size-locked.spec.js` (R2 — Playwright E2E)

- **Analog:** `e2e/session-indicator-mutex.spec.js` — full WS recorder + extended
  `spawnSession(page, { cols, rows })`.
- **Tests:** 1 (spawn at 120×30, send hand-crafted `{type:'resize', id, cols: 40, rows: 10}`,
  poll `term.cols / term.rows` for 2 seconds asserting they stay 120/30).
- **Expected RED-state reason today:** `sessions.js:417` reshapes the PTY; the
  client's xterm receives the new size and `term.cols` becomes 40. The poll
  detects the drop and fails.
- **Turns green via:** Plan 15-02 (R2 server no-op).

### `e2e/mobile-touch.spec.js` (R3 — Playwright mobile context)

- **Analog:** No mobile-context precedent in this repo. Derived from Playwright
  `devices['iPhone 12']` per 15-PATTERNS.md §13.
- **Tests:** 1 (iPhone 12 context, spawn session, tap session row, tap
  `.term-wrap`, assert `document.activeElement.classList.contains('xterm-helper-textarea')`).
- **Current state (per CLAUDE.md §1 honesty):** Undetermined RED-or-GREEN until
  Wave 3 runs against a real Chromium. Phase 11's wider focus-on-click target
  may already propagate to touch, in which case this passes today; otherwise
  CONTEXT D-15 contingency (`touchstart` -> `entry.term.focus()`) is required.
- **Turns green via:** Wave 3 verification confirms D-13 happy path, or Plan
  15-03/05 lands D-15 if D-13 fails.

### `e2e/concurrent-input.spec.js` (R4 + R5 — Playwright two-context)

- **Analog:** No two-context precedent in this repo. Derived from two
  `browser.newContext()` inside the single-worker single-process Playwright
  server (playwright.config.js: `workers: 1, fullyParallel: false`) per
  15-PATTERNS.md §14b.
- **Tests:** 2 (R4 concurrent input: A and B both observe each other's `echo A`
  / `echo B` outputs within 5s; R5 indicator visibility: hidden on A alone,
  appears within 5s when B connects, disappears within 10s when B closes —
  literal SPEC R5 budgets).
- **Expected RED-state reasons today:** R4 *may* already pass (SPEC R4
  background calls it "already works in principle but never exercised") since
  `sessions.broadcast` at `sessions.js:53` already fans output. R5 will fail
  because `.other-client-indicator` does not exist in the DOM yet (Plan 15-05
  adds the markup) and the `clients.count` broadcast is not sent (Plan 15-03
  adds the server hook).
- **Turns green via:** R4 confirmed by Wave 3; R5 by Plans 03 + 05 jointly.

### `e2e/mobile-viewport.spec.js` (R6 — Playwright mobile context)

- **Analog:** Same mobile-context idiom as `e2e/mobile-touch.spec.js`.
- **Tests:** 2 (no horizontal page-body overflow on load at iPhone 12 viewport;
  walkthrough: spawn session → tap `#mobile-nav-toggle` → assert
  `body.mobile-nav-open` → tap `#mobile-nav-close` → assert no
  `body.mobile-nav-open` → re-assert no overflow).
- **Current state (per CLAUDE.md §1 honesty):** Undetermined RED-or-GREEN until
  Wave 3. Depends on whether current rail icons + Phase 16's Settings additions
  push body width beyond viewport. Plan 15-04 adds the missing
  `.term-wrap { overflow-x: auto }` inside the existing 960px block per D-16.
- **Turns green via:** Plan 15-04 (R6 responsive CSS) + Wave 3 verification.

### `e2e/session-indicator-mutex.spec.js` (extended — Phase 5 mutex non-collision)

- **Existing tests preserved:** 6 (the original Phase 5 unread-dot / working
  mutex tests stay untouched).
- **New test appended (7th):** `'R5 — .other-client-indicator slot does not
  collide with unread-dot / session-status'`. Spawns a session, simulates
  the indicator-on state by setting `state.otherClientsConnected = true` and
  removing `.hidden` from every `.other-client-indicator` span, then asserts:
  (1) `.other-client-indicator` IS a descendant of `.session-time`'s parent
  (the TOP row, per UI-SPEC), (2) it is NOT a descendant of `.unread-dot`'s
  parent (the BOTTOM row). Pins the Phase 5 mutex-preserving placement.
- **Expected RED-state reason today:** `.other-client-indicator` doesn't exist
  in the row template yet — top-row locator returns count 0. Once Plan 15-05
  adds the markup at terminals.js:722 (the exact slot UI-SPEC locks), the
  top-row assertion finds count 1 and the bottom-row assertion stays at 0.
- **Turns green via:** Plan 15-05 (R5 indicator markup in row template).

## Verification (per CLAUDE.md §1 — honestly documented)

### Vitest

```
$ npx vitest run tests/sessions-resize.test.js tests/other-client-indicator.test.js
Test Files  2 failed (2)
Tests       5 failed | 2 passed (7)
```

Exact RED reasons confirmed:

- `sessions-resize.test.js` — Test 1 failed with
  `expected "vi.fn()" to not be called at all, but actually been called 1 times`
  with arguments `[40, 10]`. This is the current `pty.resize` passthrough,
  exactly as the plan predicted.
- `other-client-indicator.test.js` — All 4 tests failed with
  `TypeError: (0 , __vite_ssr_import_2__.updateOtherClientIndicator) is not a function`.
  The export does not exist, exactly as the plan predicted.

### Baseline regression

```
$ npx vitest run tests/font-size-clamp.test.js tests/terminal-size-estimate.test.js
Test Files  2 passed (2)
Tests       16 passed (16)
```

GREEN across both happy-dom baseline analogs after authoring the new tests.

### Full vitest suite (broad regression)

```
$ npx vitest run
Test Files  3 failed | 26 passed (29)
Tests       5 failed | 209 passed | 8 skipped (222)
```

Failures: the 2 newly-authored Phase 15 RED files (5 expected failures, intended)
plus 1 pre-existing baseline failure in `tests/creator-preflight-integration.test.js`
("server boot timeout. stderr=" — environmental, server-spawn timeout in WSL2;
confirmed independent of this plan since that file has zero imports from the
new test files).

### Playwright syntax checks

```
$ node --check on each of 5 new specs + the extended mutex spec
OK: clideck-remote-deletion
OK: pty-size-locked
OK: mobile-touch
OK: concurrent-input
OK: mobile-viewport
OK: session-indicator-mutex (extended)
```

All 6 PASS. Not actually executed against a Chromium (Wave 3 / Plan 06's job).

### Acceptance-criteria grep gates

| Pattern                                                      | File                              | Count | Required |
| ------------------------------------------------------------ | --------------------------------- | ----: | -------- |
| `#btn-remote\|#remote-modal\|#version-remote\|toHaveCount(0)` | clideck-remote-deletion.spec.js  | 7     | ≥ 4      |
| `type: 'resize'\|cols: 120\|cols: 40`                        | pty-size-locked.spec.js          | 4     | ≥ 3      |
| `devices['iPhone 12']\|xterm-helper-textarea`                | mobile-touch.spec.js             | 4     | ≥ 2      |
| `browser.newContext\|other-client-indicator`                 | concurrent-input.spec.js         | 10    | ≥ 3      |
| `devices['iPhone 12']\|scrollWidth\|#mobile-nav-toggle`      | mobile-viewport.spec.js          | 8     | ≥ 3      |
| `other-client-indicator` (existence in mutex spec)           | session-indicator-mutex.spec.js  | 6     | ≥ 1      |

All ACs pass.

## Deviations from plan

### None — plan executed as written

The plan was authored with full awareness of the re-execute context (the
`runtime_context` in the dispatch enumerated every Phase 16 interaction
concern). All seven file creations + one extension landed at their planned
paths with the planned contents.

### Minor adaptations within the plan's "Claude's Discretion" box

- The plan's `read_first` references `tests/terminal-focus.test.js` and
  `tests/display-sizing.test.js` as the happy-dom analog and the baseline
  regression file respectively. Neither exists on current main —
  `terminal-focus.test.js` was renamed and `display-sizing.test.js` was
  consolidated into other files during Phase 11/12. Used `tests/font-size-clamp.test.js`
  + `tests/terminal-size-estimate.test.js` as substitute happy-dom analogs
  (both follow the identical `import { state } from '../public/js/state.js';
  import { ... } from '../public/js/terminals.js'; beforeEach { ... DOM reset ... }`
  shape) and as the baseline regression check (both stayed GREEN after authoring).
  This is a documentation-drift adaptation, not a contract deviation.

## Phase 16 interaction concerns (Wave 3 / Plan 06 surface)

Origin/main now requires a `clideck-device-token` `Sec-WebSocket-Protocol`
header to upgrade the WS unless the server is in bootstrap mode (empty
`devices.json`). The `playwright.config.js` `webServer` launches with
`TEST_HOME` pointing at a fresh tempdir, which means `devices.json` starts
empty → bootstrap mode → upgrade succeeds for an unauthenticated browser.

If a future test-environment change starts the server with pre-populated
`devices.json` (e.g. an explicit fixture for some Phase 16 test), every
spec that drives a real WS handshake — all 5 new specs plus the mutex spec
extension — hits auth-rejection instead of testing the intended assertions.
Document in Plan 06 VERIFICATION.md if Wave 3 surfaces this.

Phase 16 also added a 5th Settings panel section ("Linked devices") that
the responsive walkthrough in `mobile-viewport.spec.js` may surface as an
unexpected overflow at iPhone 12 viewport — a Phase 16-introduced bug that
will look like a Phase 15 R6 regression. Flag in Wave 3 if so.

## Self-Check: PASSED

Files created (8 expected):

- `tests/sessions-resize.test.js` — FOUND
- `tests/other-client-indicator.test.js` — FOUND
- `e2e/clideck-remote-deletion.spec.js` — FOUND
- `e2e/pty-size-locked.spec.js` — FOUND
- `e2e/mobile-touch.spec.js` — FOUND
- `e2e/concurrent-input.spec.js` — FOUND
- `e2e/mobile-viewport.spec.js` — FOUND
- `e2e/session-indicator-mutex.spec.js` — MODIFIED (extension present;
  `grep -c "other-client-indicator"` = 6)

Commits (2 expected):

- `550ddf1` — `test(phase-15-wave-0): author R2 + R5 + G9 vitest RED-state TDD contracts`
- `d9ad6a2` — `test(phase-15-wave-0): author 5 Playwright specs + extend mutex — R1/R2/R3/R4/R5/R6 RED-state gates`

Baseline regression check: GREEN — `tests/font-size-clamp.test.js` (8 tests) +
`tests/terminal-size-estimate.test.js` (8 tests) both pass after authoring.

No production source modified — `git diff --stat HEAD~2..HEAD` confirms only
`tests/` and `e2e/` paths touched in these two commits.
