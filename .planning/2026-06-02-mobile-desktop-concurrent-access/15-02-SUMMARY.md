---
phase: 15-mobile-desktop-concurrent-access
plan: 02
subsystem: backend
tags: [pty, websocket, sessions, node-pty, tdd, no-op-mutator]

# Dependency graph
requires:
  - phase: 15-01
    provides: tests/sessions-resize.test.js (RED-state vitest contract for R2)
  - phase: 12-01
    provides: cols/rows parameters on spawnSession (sessions.js:85) — the locked-at-create value
provides:
  - sessions.resize is a documented server no-op (Phase 15 R2 / D-04)
  - tests/sessions-resize.test.js flips RED → GREEN (3/3 pass)
  - The `resize` WS message type stays accepted (no throw, no close) for older / third-party clients
affects: [15-03, 15-04, 15-05, 15-VERIFY]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mutator-becomes-no-op pattern: keep function declaration, keep export, keep handlers.js dispatch — only the body changes. Minimum-diff path for retiring a server-side mutator while preserving WS message-type acceptance."

key-files:
  created: []
  modified:
    - sessions.js (one function body replaced — `function resize(_msg) { /* documented no-op */ }`)

key-decisions:
  - "Per 15-CONTEXT.md D-04: Option (a) from 15-RESEARCH.md §3 — keep the function declaration, the module.exports entry, AND the handlers.js dispatch unchanged. Only the function body becomes a no-op. This preserves message-type acceptance per the SPEC R2 constraint and gives the smallest possible diff."
  - "Per 15-CONTEXT.md D-05: client code (terminals.js, display-sizing.js) is NOT touched. Older clients, third-party clients, and Phase 9's `display-sizing.js` re-fit routine all continue to send `{type:'resize', id, cols, rows}` on viewport changes — the server simply ignores them. Defensive-server / trusting-client posture."
  - "Per 15-CONTEXT.md D-06: spawnSession signature at sessions.js:85 (and its two call sites) is unchanged. The cols/rows passed at create time become the locked value."
  - "Parameter renamed from `msg` to `_msg` to follow the project's underscore-prefixed-unused-parameter convention and signal intent."
  - "Line drifted from sessions.js:368 (15-CONTEXT.md / 15-PATTERNS.md / 15-PLAN.md frontmatter) to sessions.js:417 today after Phases 13–16 landed on main. Re-grep before splice — line-number contract verified."

patterns-established:
  - "Documented no-op mutator: when retiring a server-side state mutator while keeping the WS message type accepted (for older clients), replace the function body with an empty body + multi-line comment explaining (a) why the no-op exists, (b) which SPEC requirement locks it, (c) what the message type's role becomes, (d) reference to the .planning/ phase folder for full context. Underscore-prefix the unused parameter."

requirements-completed: [R2]

# Metrics
duration: ~10 min
completed: 2026-06-09
---

# Phase 15 Plan 02: PTY Resize Lock Summary

**`sessions.resize` is now a documented server no-op — the PTY's cols/rows are locked at session creation, per-client `{type:'resize'}` messages are accepted-but-ignored, and `tests/sessions-resize.test.js` flips RED → GREEN.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-09T12:10:49Z
- **Completed:** 2026-06-09T12:13:30Z
- **Tasks:** 1 (Task 2.1 — Replace sessions.resize body with documented no-op)
- **Files modified:** 1 (sessions.js — +11 / -1)

## Accomplishments

- **R2 server contract delivered.** `function resize(msg)` at sessions.js:417 (the one-liner `sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows)`) is replaced by `function resize(_msg) { /* documented no-op ... */ }`. The PTY's cols/rows are now fixed at the value passed to `spawnSession(...)` at session-creation time.
- **TDD red→green flip.** Wave 0's `tests/sessions-resize.test.js` was authored RED at 550ddf1 with three test cases. Test 1 (`does NOT call pty.resize when a resize message arrives for a known session`) was failing with `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times — [40, 10]`. After this plan: 3/3 pass.
- **WS message type still accepted.** The `case 'resize':` dispatch at handlers.js:371 is unchanged. The export at sessions.js:918 is unchanged. Older clients, third-party clients, and Phase 9's `display-sizing.js` re-fit routine all continue to send `{type:'resize', id, cols, rows}` on viewport changes — those messages now flow into a documented no-op rather than reshaping the PTY.
- **Zero client-side blast radius.** No terminals.js / app.js / display-sizing.js changes. Plan 03's handlers.js territory is left alone. The phase's other plans (15-03 / 15-04 / 15-05) can land independently with no merge conflicts on this file.

## Task Commits

Each task was committed atomically:

1. **Task 2.1: Replace sessions.resize body with documented no-op** — `5a0adee` (`feat`)

**Plan metadata:** _(this SUMMARY commit hash will be recorded after commit lands)_

## Files Created/Modified

- `sessions.js` — Replaced the body of `function resize(...)` at line 417 with a documented no-op. Function signature changed from `(msg)` to `(_msg)`. The 11 added lines are entirely comment + empty body; the 1 removed line is the original `sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows);` call.
- `.planning/2026-06-02-mobile-desktop-concurrent-access/15-02-SUMMARY.md` — this file.

## Decisions Made

- **Followed the plan as specified.** All five decisions in `key-decisions:` above are SPEC/CONTEXT-locked (D-04, D-05, D-06) — no executor discretion was exercised against the plan.
- **Underscore-prefixed parameter `_msg`.** The plan called for the underscore-prefix convention; applied.
- **Rationale comment includes Phase 15 (not Phase 12) reference.** The PATTERNS.md §2c splice template at the time was written when this phase was named "Phase 12" (the directory is `2026-06-02-mobile-desktop-concurrent-access`, originally `2026-06-01-...` and originally tagged Phase 12). The phase is now Phase 15 per ROADMAP. The comment was updated to say "Phase 15 R2 / D-04" rather than copying "Phase 12 R2" verbatim — same meaning, current naming.

## Deviations from Plan

None — plan executed exactly as written. The only adjustment was line-number drift (368 → 417 after Phases 13–16 landed on main), which the PLAN.md frontmatter pre-flagged ("if line drift has occurred since 15-RESEARCH.md was written... grep for `function resize(msg)` to find the actual line").

## Issues Encountered

**1. `tests/display-sizing.test.js` referenced by the plan does not exist on this branch.**

PLAN.md `<verify><automated>` and `<success_criteria>` both expect `tests/display-sizing.test.js` to be a regression baseline ("display-sizing was GREEN, still GREEN" / "client SEND behaviour unchanged per D-05"). That file is **absent** from the current `tests/` directory — `ls tests/display-sizing.test.js` returns "No such file or directory".

Investigation:
- Phase 9 (`2026-05-27-terminal-display-sizing`) shipped the `display-sizing.js` module and related logic but did NOT add a `tests/display-sizing.test.js`. The closest live tests touching that subsystem are:
  - `tests/config-defaults.test.js` — "Terminal-display-sizing phase — config DEFAULTS contract"
  - `tests/sidebar-width-clamp.test.js` — "Terminal-display-sizing phase — sidebar width clamp helper"
  - `tests/font-size-clamp.test.js` — "Terminal-display-sizing phase — font-size clamp helper"
- The plan's reference appears to be aspirational / stale — written when the planner expected a `display-sizing.test.js` to exist as the regression target.

Resolution: Substituted the full vitest suite (`npm run test`) as the regression baseline instead. The three Phase-9-tagged tests above all stay green (verified in the full-suite run below).

**2. Pre-existing test failures unrelated to this change.**

Running `npm run test` after the splice shows 4 failures across 2 files. Both are pre-existing on this branch (not regressions from Plan 15-02) and are documented here so the verifier doesn't flag them later:

- **`tests/other-client-indicator.test.js` (3 failing tests, 1 passing).** `updateOtherClientIndicator is not a function` — Wave 0 authored these as RED-state TDD contracts for Plan **15-04** (R5 indicator export), not 15-02. Will flip green when Plan 15-04 lands the `updateOtherClientIndicator` export in `terminals.js`.
- **`tests/creator-preflight-integration.test.js` (suite fails, 8 tests skipped).** `Error: server boot timeout. stderr=` — environmental / infrastructural failure where the harness can't spawn the test server (matches the sudo-gated test-environment caveat noted in 15-CONTEXT.md D-19 / `clideck-docker/TEST-ENV-DEPS.md`). Not touched by sessions.resize at all.

Per CLAUDE.md §1 scope-boundary, both are out-of-scope for this plan.

## Verification

- ✅ `grep -n "function resize" sessions.js` → `417:function resize(_msg) {` (one match, no-op declaration)
- ✅ `grep -A 11 "^function resize" sessions.js | grep -c "pty.resize"` → `0` (call to pty.resize is gone)
- ✅ `grep "function resize" sessions.js | grep -c "_msg"` → `1` (underscore-prefixed-unused-parameter convention applied)
- ✅ Rationale comment present and references "Phase 15 R2 / D-04", "locked at session creation", and `.planning/2026-06-02-mobile-desktop-concurrent-access/`
- ✅ Export unchanged at sessions.js:918 (`resize` still in `module.exports`)
- ✅ Dispatch unchanged at handlers.js:371 (`case 'resize': sessions.resize(msg); break;`)
- ✅ `node --check sessions.js` succeeds (no syntax errors)
- ✅ `tests/sessions-resize.test.js` flips RED → GREEN: 3/3 pass (was 1 failed | 2 passed before this plan)
- ✅ Phase-9-tagged tests (config-defaults, sidebar-width-clamp, font-size-clamp) all stay green
- ✅ `git diff --stat sessions.js` shows +11 / -1 — entirely inside the `resize` function body
- ✅ `git diff -- handlers.js` shows zero changes (handlers.js is Plan 03's territory)

### Manual testing you can do

This is a server-side behaviour change that's most directly observable via the WS connection. If you want to eyeball it:

1. Start the dev server: `npm run dev` (or `node server.js`).
2. Open `http://localhost:<port>/` in two browser tabs at deliberately different viewport sizes (one fullscreen desktop, one resized narrow to ~390px wide to mimic a phone).
3. Create a session in Tab A.
4. Open the same session in Tab B (it should appear in the session list).
5. Resize Tab B's window aggressively — the desktop user in Tab A should see **no change** to the agent's terminal cols/rows. (Before this plan: Tab A's terminal would shrink under them.)
6. Optionally use the browser DevTools Network → WS panel to confirm that Tab B is still sending `{type:'resize', id, cols, rows}` frames (per D-05 — defence-in-depth, the server just ignores them now).

### Testing gaps

- **No E2E test for the cross-client cols/rows lock yet.** Wave 0 authored `e2e/pty-size-locked.spec.js` as a RED-state contract but the spec polls xterm internals (`state.terms.get(id)?.term.cols`) which depends on the full app being up. That spec runs in Plan 15-VERIFY when the whole phase is wired together. This plan's unit-test contract (does-not-call-the-spy) is correct but narrower than the E2E.
- **No manual smoke yet on a real phone over VPN.** Per 15-CONTEXT.md D-14, the real-phone verification step is deferred to phase-end after `clideck-docker-lance` is up. Out of scope for this plan.
- **The two pre-existing failing-test files** (`other-client-indicator.test.js`, `creator-preflight-integration.test.js`) are deliberately not investigated here — they're Plan 15-04 territory and a known environmental issue, respectively.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 15-03 (handlers.js — clideck-remote surgical removal + clients.count broadcast)** can start immediately. This plan deliberately did NOT touch handlers.js so 15-03's diff is clean.
- **Plan 15-04 (terminals.js indicator markup + updateOtherClientIndicator export)** can start immediately. Will flip the 3 failing `other-client-indicator.test.js` cases green when it lands.
- **Plan 15-05 (responsive CSS / mobile viewport)** can start immediately.
- **Phase 15 R2 requirement** is now satisfied at the unit-test contract level. The E2E lock (`e2e/pty-size-locked.spec.js`) and the manual cross-client smoke land in Plan 15-VERIFY.

## Self-Check: PASSED

- ✅ `sessions.js` exists and contains the no-op `function resize(_msg)` at line 417 (verified via `grep -n "function resize" sessions.js`)
- ✅ `.planning/2026-06-02-mobile-desktop-concurrent-access/15-02-SUMMARY.md` exists (this file)
- ✅ Commit `5a0adee` exists in git log (verified — landed at `feat(sessions): lock PTY size at session creation — resize WS message becomes a documented server no-op (Phase 15 R2 / D-04)`)

---
*Phase: 15-mobile-desktop-concurrent-access*
*Plan: 02*
*Completed: 2026-06-09*
