---
phase: 15-mobile-desktop-concurrent-access
plan: 02
subsystem: api
tags: [websocket, pty, node-pty, vitest, server-no-op]

# Dependency graph
requires:
  - phase: 12-mobile-desktop-concurrent-access
    provides: "Wave-0 RED-state contract at tests/sessions-resize.test.js (Plan 12-01)"
provides:
  - "PTY size is locked at session creation server-side — no longer reshapable via WS resize frame"
  - "sessions.resize() preserved as a documented no-op (function declaration, export, dispatch all intact)"
  - "GREEN baseline for tests/sessions-resize.test.js (3/3 contract tests)"
affects: [12-03-handlers, 12-04-client-indicator, 12-05-ui-cleanup, 12-06-mobile-responsive, future-phases-touching-pty-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Documented no-op pattern: keep function declaration + export + dispatch intact when SPEC requires the message type to stay accepted"
    - "Underscore-prefixed unused parameter (`_msg`) as idiomatic 'intentionally unused' marker"

key-files:
  created:
    - .planning/2026-06-02-mobile-desktop-concurrent-access/15-02-SUMMARY.md
  modified:
    - sessions.js (line 368 — function resize body replaced with documented no-op)

key-decisions:
  - "Adopted RESEARCH.md §3 Option (a) — body-only replacement, leaving signature/export/dispatch syntactically valid for maximum surface-area preservation and minimum-diff history"
  - "Kept `_msg` underscore-prefix for the unused param — codebase-idiomatic and lint-rule-tolerant"
  - "Confirmed handlers.js:355 dispatch stays untouched this plan (Plan 12-03 territory)"
  - "Confirmed client terminals.js untouched this plan (D-05 — clients keep sending resize, server silently absorbs)"

patterns-established:
  - "Server-side no-op with in-code rationale comment + reference to .planning/phases/{phase}/ — anchors future grep + onboarding"
  - "Atomic single-file plan execution — one code commit + one summary commit, no scope creep"

requirements-completed: [R2]

# Metrics
duration: 4min
completed: 2026-06-02
---

# Phase 12 Plan 02: Lock PTY Resize Summary

**`sessions.resize(_msg)` at sessions.js:368 is now a documented server no-op — `pty.resize()` is unreachable from the WebSocket message path; the creator's cols/rows at spawnSession() time are the locked value for the session's lifetime.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-02T17:46:00Z (approx — first Read of plan)
- **Completed:** 2026-06-02T17:48:20Z
- **Tasks:** 1 / 1
- **Files modified:** 1 (sessions.js)

## Accomplishments
- Replaced the one-line body of `function resize(msg)` at sessions.js:368 with the multi-line documented no-op from PATTERNS.md §2c.
- Flipped `tests/sessions-resize.test.js` from RED (1 failed / 2 passed in Wave-0 baseline) to GREEN (3 / 3 passing).
- Verified `tests/display-sizing.test.js` still GREEN (28 / 28) — Phase 9's client-side fit/resize logic is independent of the server change per D-05.
- Confirmed zero ripple: `handlers.js:355` dispatch unchanged, `sessions.js:749` exports unchanged, no client code touched.

## Task Commits

Each task was committed atomically:

1. **Task 2.1: Replace `sessions.resize` body with documented no-op** — `612e42b` (feat)

**Plan metadata:** _to be appended after SUMMARY commit lands_ (docs)

## Files Created/Modified
- `sessions.js` (modified) — line 368: replaced `function resize(msg) { sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows); }` with a six-line no-op body that documents (a) PTY size is locked at session creation per Phase 12 R2, (b) the message type stays accepted for older clients per the SPEC tolerance constraint, (c) per-client viewport changes do not reshape the PTY, (d) reference to `.planning/2026-06-02-mobile-desktop-concurrent-access/` for context. Function parameter renamed to `_msg` to mark intentional non-use.
- `.planning/2026-06-02-mobile-desktop-concurrent-access/15-02-SUMMARY.md` (created) — this file.

## Decisions Made
- **D-04 minimum-diff path: Option (a) confirmed at execution time.** RESEARCH.md §3 enumerated three D-04 fulfilment paths: (a) replace the body, (b) delete the handlers.js dispatch, (c) drop `resize` from the exports. Plan 12-02 was already locked to (a); execution confirmed it remained the right call after re-checking that no other module imports `sessions.resize` outside the handlers.js dispatch (verified via grep — only one consumer). Body-replacement preserves the entire call graph at the cost of six lines, vs. the cascading edits options (b) and (c) would require.
- **Underscore-prefix on `_msg`** — chosen to signal "intentionally unused" both to humans reading sessions.js later and to any future lint rule that flags unused parameters. The codebase doesn't presently enforce no-unused-params, but the pattern is idiomatic across the JS/TS ecosystem and costs nothing now.
- **No SPEC.md re-derivation needed.** CONTEXT.md D-04 + the test file's docblock (commit 7f3d3c8) both clearly pin the contract; no ambiguity to resolve at execution time.

## Deviations from Plan

None — plan executed exactly as written. The PATTERNS.md §2c splice was used verbatim. The line number in PLAN.md (368) was correct — no drift since RESEARCH.md was authored at commit 9f6a111.

## Issues Encountered

- **Accidental `git stash` invocation during pre-commit verification.** While trying to confirm whether `tests/other-client-indicator.test.js` failures were pre-existing or caused by this change, I ran `git stash` to A/B the working tree. The user's global CLAUDE.md forbids `git stash` inside worktree contexts (#3542 — stash list is shared across worktrees and main checkout), but this project is on the main checkout, not a worktree. I still consider this a process violation: even on the main checkout, `git stash` is the wrong tool for "is this change in the diff or was it already there?" — `git diff` would have answered the same question without moving WIP off the working tree. The stash was immediately popped (no data loss, the resize no-op edit was restored intact), and I will not use `git stash` again in this session regardless of worktree status. Resolution: noted as a lesson, no code impact.

- **Pre-existing Wave-0 RED-state failures in `tests/other-client-indicator.test.js`.** The full `npm run test` run shows 4 failures in that file. They are out-of-scope for Plan 12-02 — they're the Wave-0 contract authored in commit `7f3d3c8` pinning `updateOtherClientIndicator` from `public/js/terminals.js`, which Plan 12-04 will land. Verified via `git log --oneline -n 1 -- public/js/terminals.js` (latest commit is the unrelated `2c7b1be` from Phase 11). Logged per the executor's scope-boundary rule; not fixed in this plan.

## User Setup Required

None — server-side code change only; no environment variables, no external service config, no dashboard work.

## Next Phase Readiness

- **Plan 12-03 (handlers.js — delete clideck-remote bridges + add clients.count broadcast)** is unblocked. The handlers.js:355 dispatch arm stays exactly as it was; Plan 12-03's edits at handlers.js:46-98, 246-248, 251-252, 601-650, 658 do not touch line 355.
- **Plan 12-04 (client-side indicator)** continues to depend on `updateOtherClientIndicator` and the `state.otherClientsConnected` flag — neither touched by this plan, both still pending.
- **No blockers introduced.** No new dependencies, no new env vars, no schema changes, no migration steps.

## Self-Check: PASSED

- sessions.js:368 contains `function resize(_msg)` followed by a multi-line no-op comment — verified via Read.
- `grep -c "pty.resize" sessions.js` → 0 — verified via Bash (call gone).
- `grep "case 'resize'" handlers.js` → still at line 355 — verified, dispatch unchanged.
- `grep "resize," sessions.js` at line 749 → still in the exports list — verified.
- `node --check sessions.js` → OK — verified.
- `npx vitest run tests/sessions-resize.test.js tests/display-sizing.test.js` → 31 / 31 passed — verified.
- Commit `612e42b` exists on `feat/mobile-desktop-concurrent-access` — verified via `git log`.
- Commit author is `Samuel Harding <dev1@lancetek.com>` per CLAUDE.md §4 (GitHub-persona override) — verified.
- handlers.js shows no diff — verified via `git diff -- handlers.js`.

---
*Phase: 12-mobile-desktop-concurrent-access*
*Completed: 2026-06-02*
