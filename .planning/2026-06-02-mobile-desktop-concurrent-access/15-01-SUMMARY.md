---
phase: 15-mobile-desktop-concurrent-access
plan: 01
subsystem: testing
tags: [tdd, wave-0, vitest, playwright, red-state]
requires: []
provides:
  - tests/sessions-resize.test.js
  - tests/other-client-indicator.test.js
  - e2e/clideck-remote-deletion.spec.js
  - e2e/pty-size-locked.spec.js
  - e2e/mobile-touch.spec.js
  - e2e/concurrent-input.spec.js
  - e2e/mobile-viewport.spec.js
  - "e2e/session-indicator-mutex.spec.js — extended with R5 slot-independence test"
affects:
  - Plan 12-02 (sessions.resize no-op) — turned green by sessions-resize.test.js
  - Plan 12-03 (handlers.js clients.count broadcast) — turned green by concurrent-input.spec.js test 2
  - Plan 12-04 (clideck-remote DOM/driver deletion) — turned green by clideck-remote-deletion.spec.js
  - Plan 12-05 (terminals.js indicator markup + updateOtherClientIndicator export + .term-wrap CSS) — turned green by other-client-indicator.test.js + mobile-viewport.spec.js + session-indicator-mutex.spec.js R5 test
tech-stack:
  added: []
  patterns:
    - "vitest @vitest-environment node — server-side mutator+spy unit tests"
    - "vitest @vitest-environment happy-dom — DOM-touching client-module unit tests"
    - "Playwright per-test mobile context — browser.newContext({ ...devices['iPhone 12'] })"
    - "Playwright two-context concurrency — two browser.newContext() inside one test sharing one server (workers: 1 + fullyParallel: false makes it work)"
    - "Inlined installWsRecorder + waitForAppReady + spawnSession helpers per spec (no shared e2e/helpers.js yet)"
key-files:
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
  - "spawnSession() extended to accept opts.cols/opts.rows (default 80x24) — needed by pty-size-locked.spec.js's 120x30 case. Existing single-context spec call sites stay compatible because the parameter is optional."
  - "Inlined helpers verbatim across all 5 new specs rather than creating e2e/helpers.js — per 15-PATTERNS.md Shared 7 the existing repo convention is inline-per-spec; refactoring is optional cleanup for a future phase."
  - "clideck-remote-deletion.spec.js's automated grep gate self-exempts its own pathname from the union pattern so the spec file (which mentions the deleted tokens in comments) doesn't trip the gate."
  - "R5 slot-independence assertion in the extended mutex spec synthesises state.otherClientsConnected = true via page.evaluate rather than waiting for the real server clients.count broadcast — keeps the test self-contained even before Plan 12-03 lands the server-side wiring. The selectors (.flex.items-baseline .other-client-indicator vs .flex.items-center .other-client-indicator) match the actual row DOM that Plan 12-05 will inject into."
  - "concurrent-input.spec.js injects 'echo A\\r' / 'echo B\\r' directly over the recorded WebSocket rather than through xterm.fit/textarea — bypasses xterm focus arbitration which is irrelevant for R4 (the contract is 'PTY accepts concurrent input', not 'two browsers race for focus')."
metrics:
  duration_minutes: 18
  completed_date: 2026-06-02
  tasks_completed: 2
  files_created: 7
  files_modified: 1
  commits: 2
---

# Phase 12 Plan 01: Wave 0 — Failing Tests Authored Summary

Authored the eight Wave 0 test/spec files (two vitest + five Playwright + one
extended existing spec) that define done for Plans 12-02..12-05. Per CLAUDE.md
§2 (TDD-first) and Phase 12's Validation Architecture (15-VALIDATION.md), these
tests are the contract — they fail today on purpose and turn green only when
the corresponding implementation tasks land. No production code was touched in
this plan.

## What changed

### Task 1.1 — vitest unit tests (2 files, commit `7f3d3c8`)

| File | Env | R# | Tests | RED reason today |
|------|-----|----|-------|------------------|
| `tests/sessions-resize.test.js` | node | R2 | 3 | `sessions.js:368` still invokes `pty.resize` — spy fails `not.toHaveBeenCalled()`. The two defensive "does not throw" tests pass today (optional chaining already guards). |
| `tests/other-client-indicator.test.js` | happy-dom | R5 + G9 | 4 | `updateOtherClientIndicator` is not exported from `public/js/terminals.js`. ALL 4 tests fail with `TypeError: updateOtherClientIndicator is not a function` at the call site (vitest reports the import resolves to `undefined`). |

Vitest run output (verbatim, abridged):

```
 FAIL  tests/sessions-resize.test.js > sessions.resize — locked at session creation (Phase 12 R2) > does NOT call pty.resize when a resize message arrives for a known session
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
Received:
  1st vi.fn() call: Array [ 40, 10 ]

 FAIL  tests/other-client-indicator.test.js > updateOtherClientIndicator (Phase 12 R5) > removes .hidden from every .other-client-indicator when count > 1
TypeError: (0 , __vite_ssr_import_2__.updateOtherClientIndicator) is not a function

 Test Files  2 failed (2)
      Tests  5 failed | 2 passed (7)
```

Both failure modes are the **expected** RED state. They will turn green when:
- Plan 12-02 replaces `sessions.js:368`'s body with a no-op (D-04 Option (a) — keep export, keep dispatch, empty body).
- Plan 12-05 adds `export function updateOtherClientIndicator(count)` to `public/js/terminals.js` adjacent to `focusTerminal`.

The G9 (newly-added-row) test specifically pins the construction-time risk from
15-RESEARCH.md §10 G9: when the count flag flips and a new row is injected
later, the helper must re-walk the live DOM, not a snapshot. This is the safety
net against silent indicator-missing on freshly-created sessions.

### Task 1.2 — 5 new Playwright specs + extend mutex (commit `3f94406`)

| File | R# | Approach | RED reason today |
|------|----|----------|------------------|
| `e2e/clideck-remote-deletion.spec.js` | R1 | DOM `toHaveCount(0)` + automated `git grep` gate via `execSync` | `public/index.html` has 3 clideck-remote refs (Plan 04); `public/js/app.js` has 6 (Plan 04); `handlers.js` has 10 (Plan 03). Grep gate exits 0 (matches found) instead of expected exit 1. |
| `e2e/pty-size-locked.spec.js` | R2 | Spawn 120×30 session, send malicious `{type:'resize', cols:40, rows:10}` over WS, poll `term.cols` for 2s | `sessions.js:368` still calls `pty.resize` → xterm fit addon re-reads shrunk size → poll fails (`cols !== 120`). Plan 02 flips green. |
| `e2e/mobile-touch.spec.js` | R3 / D-13 | iPhone 12 context, tap `.term-wrap`, assert `document.activeElement.classList.contains('xterm-helper-textarea')` | Depends on Plan 12-04/05 keeping the Phase-11 focus path intact under the deletion sweep. If the path holds, this passes once Plan 05 builds the row. If it fails, D-15's commented `touchstart` contingency in `terminals.js` gets uncommented. |
| `e2e/concurrent-input.spec.js` | R4 + R5 | Two `browser.newContext()` per test; Test 1 sends `echo A\r` / `echo B\r` via WS, both observe both outputs; Test 2 polls `.other-client-indicator.hidden` toggling on B connect/close | Test 1's existing `sessions.broadcast({type:'output'})` plumbing should largely work (sessions.js:151) — surfaces any latent two-client races. Test 2 fails today because `.other-client-indicator` selector matches zero spans (Plan 05) and `clients.count` isn't broadcast (Plan 03). |
| `e2e/mobile-viewport.spec.js` | R6 / D-18 | iPhone 12 context, assert `document.body.scrollWidth ≤ window.innerWidth` at first load AND after walkthrough [spawn → toggle sidebar → close] | Test 1 may pass today (no sessions, no overflow). Test 2 fails because Plan 05 hasn't added `.term-wrap { overflow-x: auto; }` to the existing `@media (max-width: 960px)` block, so a live `.term-wrap` rendered after spawnSession spills past 390px on iPhone 12. |
| `e2e/session-indicator-mutex.spec.js` (extended) | R5 (slot independence) | Synthesises `state.otherClientsConnected = true` via `page.evaluate`, asserts `.other-client-indicator` lives in `.flex.items-baseline` (top row) and NOT in `.flex.items-center` (bottom row, which holds `.unread-dot` + `.session-status`) | Today the selector matches zero everywhere because Plan 05 hasn't injected the span yet. After Plan 05, the slot-independence assertion validates that the new amber indicator coexists with Phase 5's mutex without visual collision. |

#### Helper inlining (per 15-PATTERNS.md Shared 7)

All 5 new specs inline `installWsRecorder`, `waitForAppReady`, and (where
relevant) `spawnSession` verbatim from `e2e/session-indicator-mutex.spec.js` —
the canonical richer recorder that parses received frames into `w.__rxMessages`,
which R2 (filter `type === 'created'`), R4 (filter `type === 'output'`), and R5
(observe `clients.count` toggles) all need. There is no shared `e2e/helpers.js`
in the repo today; the planner's call per 15-PATTERNS.md Shared 7 was to
inline-per-spec rather than create one. A future plan can factor them out if
duplication grows beyond Phase 12.

`spawnSession` was extended to accept `opts.cols`/`opts.rows` (defaulting to
80×24) so `pty-size-locked.spec.js` can create a 120×30 session. The existing
single-context usages in `session-indicator-mutex.spec.js` stay compatible
because the parameter is optional.

## Files

**Created:**
- `tests/sessions-resize.test.js` (105 lines)
- `tests/other-client-indicator.test.js` (132 lines)
- `e2e/clideck-remote-deletion.spec.js` (139 lines)
- `e2e/pty-size-locked.spec.js` (123 lines)
- `e2e/mobile-touch.spec.js` (122 lines)
- `e2e/concurrent-input.spec.js` (191 lines)
- `e2e/mobile-viewport.spec.js` (143 lines)

**Modified:**
- `e2e/session-indicator-mutex.spec.js` (+60 lines — appended R5 slot-independence test)

## Verification performed

### Achieved (RED-state proven)

1. `npx vitest run tests/sessions-resize.test.js tests/other-client-indicator.test.js`
   → exit code 1; 5 failed / 2 passed (the two defensive "does not throw" tests
   in sessions-resize pass today; the rest fail with the expected RED reasons
   documented above).
2. `npx vitest run tests/display-sizing.test.js` → **28/28 passing** (no
   regression to the existing client-side resize-sending assertion per D-05).
3. `node --check` passes on all 6 spec files (5 new + 1 extended). No syntax
   errors.
4. Selector / token presence verified by grep for every `<acceptance_criteria>`
   bullet in 15-01-PLAN.md:
   - `#btn-remote`, `#remote-modal`, `#version-remote`, `toHaveCount(0)` present in deletion spec
   - `type: 'resize'`, `cols: 120`, `cols: 40` present in pty-size-locked
   - `devices['iPhone 12']`, `xterm-helper-textarea` present in mobile-touch
   - 4× `browser.newContext` (two per test, two tests) + `other-client-indicator` in concurrent-input
   - `devices['iPhone 12']`, `scrollWidth`, `#mobile-nav-toggle` in mobile-viewport
   - `other-client-indicator` appears 7 times in extended mutex spec
5. Each new spec inlines `installWsRecorder` ≥ 2 times (function definition +
   call site) and `waitForAppReady` ≥ 2 times. `pty-size-locked`,
   `mobile-touch`, `mobile-viewport`, and `concurrent-input` additionally
   reference `spawnSession`. (clideck-remote-deletion.spec.js correctly does
   NOT use spawnSession — it tests deletion absence at page load before any
   session exists.)

### Deferred — Playwright local-run gap (per CLAUDE.md §1 honesty)

Per the Phase 11 SUMMARY.md history, this dev environment does **NOT** have
Chromium libraries available (sudo-gated per
`clideck-docker/TEST-ENV-DEPS.md` — missing `libnss3`, `libasound2`, and
related deps). `npx playwright test` cannot run locally today; running it
surfaces dynamic-link errors before any test executes. The achievable
verification gate for this commit is:

- **Syntactic** (`node --check` pass on every new spec) ✓
- **Structural** (every acceptance criterion's selector/assertion is present) ✓
- **Behavioural** (vitest unit tests RED with the documented expected reasons) ✓

Per CLAUDE.md §1 we **do NOT claim these Playwright specs "work" or "pass"** —
we claim they are syntactically valid Playwright specs wired with the correct
selectors, helpers, and assertion patterns to fail today for the RED-state
reasons documented above, and turn green once Plans 12-02..12-05 land their
implementations.

The deferred manual Playwright run is documented in 15-VERIFICATION.md (to be
authored in Plan 12-06 per D-19), matching the Phases 9/10/11 precedent.

## Deviations from Plan

### Auto-fixed Issues

None. The plan executed as written. Two judgment calls worth noting (neither
amounts to a deviation — both were within the planner's intent):

1. **`clideck-remote-deletion.spec.js` grep-gate self-exemption.** The
   automated grep gate runs the same union pattern as 15-RESEARCH.md §1h. The
   spec file itself mentions the tokens (`clideck-remote`, `remote-modal`,
   etc.) in comments to document what it's gating. Without an exemption, the
   gate would forever trip on its own filename. Added
   `':!e2e/clideck-remote-deletion.spec.js'` to the pathspec list alongside
   the existing `':!CHANGELOG.md'` and `':!.planning/'` exemptions. Documented
   in the spec file's comments. This is a Rule-3-style mechanical fix
   (without it the gate cannot ever return green); not surfaced as a Rule-4
   architectural decision.

2. **`spawnSession` cols/rows parameterisation.** 15-01-PLAN.md task 1.2's
   action list explicitly anticipates this: "Extended `spawnSession(page,
   opts = { cols: 80, rows: 24 })` accept cols/rows parameters for
   pty-size-locked.spec.js's 120×30 case." Default args preserve backwards
   compatibility with the existing single-context usages.

### Auth gates encountered

None.

## Threat surface scan

The changes in this plan are **test-only files** — no new network endpoints,
no new authentication paths, no new file-system access patterns. The
`clideck-remote-deletion.spec.js` grep gate runs `git grep` via
`child_process.execSync`, but `git grep` is read-only and operates on the
already-checked-out working tree (no network, no shell-injection vector — the
pattern string is a hardcoded constant). No threat flags.

## Known Stubs

None. Every test file authored is functional (it can run; it produces a
deterministic pass/fail) — the RED state is a contract, not a stub.

## Self-Check: PASSED

Verified the eight files exist on disk and the two commits land in git log:

```
$ ls tests/sessions-resize.test.js tests/other-client-indicator.test.js
FOUND: tests/sessions-resize.test.js
FOUND: tests/other-client-indicator.test.js

$ ls e2e/clideck-remote-deletion.spec.js e2e/pty-size-locked.spec.js e2e/mobile-touch.spec.js e2e/concurrent-input.spec.js e2e/mobile-viewport.spec.js
FOUND: all 5 new specs

$ git log --oneline --all | grep -E "7f3d3c8|3f94406"
FOUND: 7f3d3c8 test(phase-12-wave-0): author R2 + R5 + G9 vitest RED-state ...
FOUND: 3f94406 test(phase-12-wave-0): author 5 Playwright specs + extend mutex ...
```

All acceptance criteria from 15-01-PLAN.md satisfied:

- [x] Both vitest files exist and FAIL with the documented red-state reasons
- [x] All 5 new Playwright spec files exist and pass `node --check`
- [x] `e2e/session-indicator-mutex.spec.js` extended (`other-client-indicator` appears 7 times)
- [x] `tests/display-sizing.test.js` still passes (28/28 — no regression)
- [x] Each task committed atomically with a verbose commit message
- [x] No modifications to STATE.md, ROADMAP.md, sessions.js, handlers.js, `public/`, or `src/` (this plan touches ONLY tests/ and e2e/)

## Commits

- `7f3d3c8` — `test(phase-12-wave-0): author R2 + R5 + G9 vitest RED-state — sessions.resize lock + other-client indicator updater`
- `3f94406` — `test(phase-12-wave-0): author 5 Playwright specs + extend mutex — R1/R2/R3/R4/R5/R6 RED-state gates`

## Next plan

Plan 12-02 (Wave 2, parallel-safe with 12-03 and 12-04): replace
`sessions.js:368`'s `function resize(msg)` body with the documented no-op
comment per D-04 Option (a). After Plan 02 lands, `tests/sessions-resize.test.js`
turns green (the spy stops being called). E2E `e2e/pty-size-locked.spec.js`
test 1 also turns green at that point because the integration path no longer
reshapes the PTY.
