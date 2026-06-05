---
phase: 14-replayable-shell-sessions
plan: 02
subsystem: sessions / persistence
tags: [replayable, saveSessions, loadSessions, rehydrate, tdd, partition]
provides: replayable persistence track (partitioned save/load + rehydrateReplayable)
requires: ["14-01"]  # consumes cmd.canReplay
affects: [sessions.js, tests/resumable-handlers.test.js]
key-files:
  modified:
    - sessions.js
    - tests/resumable-handlers.test.js
decisions:
  - "saveSessions partitions on an EXPLICIT `else if (cmd.canReplay)` branch — a cmd with neither capability is persisted to NEITHER bucket (D-01, the Replace difference vs the candidate's else-fallthrough)"
  - "Shape-1 discriminator: one flat sessions.json array, replay entries tagged replayable:true (D-02)"
  - "MAX_REPLAY_REHYDRATE = 50 named constant; overflow WARNs the dropped count (D-03)"
metrics:
  completed: 2026-06-04
  commits: [7981def, 53c6de2]
  tests-added: 7
---

# Phase 14 Plan 02: Persistence + Rehydrate Summary

Implemented the replayable persistence track in `sessions.js` (TDD: RED `7981def` → GREEN `53c6de2`). The track shares `sessions.json` and the existing autosave/shutdown machinery, partitioned off the explicit `canReplay` capability from Plan 01.

## What changed

### tests/resumable-handlers.test.js (RED — `7981def`)
Appended a `// --- Phase 14: replayable persistence track ---` block with `SHELL_CFG` (shell cmd `canResume:false canReplay:true` + claude cmd `canResume:true canReplay:false`) and `REPLAYABLE_ENTRY` fixtures, plus 7 new tests:
1. **save round-trip** — resumable persists WITHOUT a `replayable` key; shell persists WITH `replayable:true` and no `sessionToken`.
2. **load partition** — mixed file routes ids to the correct buckets via the accessors.
3. **pre-fix upgrade (AC 4)** — file with no `replayable` key → ALL entries resumable, replayable empty.
4. **rehydrate happy path** — cwd=TEST_DATA_DIR → returns 1, drains to `[]`.
5. **cwd fallback (AC 5)** — nonexistent cwd → still spawns 1 (in `$HOME`).
6. **unknown commandId** — `no-such-command` → returns 0, array still drained.
7. **cap (D-03)** — 60 valid entries → spawns ≤50, drained, `console.warn` spy sees the dropped count (10).

At RED: 7 new tests FAIL, existing 7 PASS — confirmed.

### sessions.js (GREEN — `53c6de2`)
- **`let replayable = []`** beside `resumable`, with a comment framing replay (fresh PTY in saved cwd, no token, no history) vs resume (token-driven `--resume`).
- **`const MAX_REPLAY_REHYDRATE = 50`** named constant.
- **`__setReplayableForTest` / `__getReplayableForTest`** — test-only guarded accessors mirroring the resumable pair.
- **`saveSessions` rewritten** to a two-bucket loop over the live Map:
  - `if (cmd.canResume && cmd.resumeCommand)` → resumable (keeps the `{{sessionId}}` token-skip + `skippedNoToken` warn unchanged);
  - `else if (cmd.canReplay)` → replayable (no `sessionToken`, with `replayable: true`);
  - **else → persisted to NEITHER bucket** (no silent replay — the Replace difference, D-01).
  - Each bucket merges with still-pending module-array entries by id; writes one flat `[...resumableArr, ...replayableArr]`.
- **`loadSessions` rewritten** — `resumable = all.filter(e => !e.replayable)`, `replayable = all.filter(e => e.replayable)`; logs both counts; on catch resets both to `[]`.
- **`rehydrateReplayable(cfg)`** — guards `cfg.commands`; resolves home from `HOME || USERPROFILE`; if `replayable.length > 50` WARNs the dropped count and processes only `slice(0,50)`; per entry: lookup cmd by commandId (skip+WARN if absent), `existsSync(cwd)` gate → `$HOME` fallback + WARN, spawn via `createProgrammatic`; drains `replayable = []` after; returns spawned count.
- Exported `rehydrateReplayable`, `__setReplayableForTest`, `__getReplayableForTest`.

## Verification

- `npx vitest run tests/resumable-handlers.test.js` → **14 passed (14)**, VITEST_EXIT=0.
- **resume() body byte-identical** to main (extracted both functions, `diff` → `RESUME() BYTE-IDENTICAL`).
- The explicit `else if (cmd.canReplay)` partition is in place; the neither-capability case is a no-op (no persist).

### Note on `AttachConsole failed` stderr
Tests 4/5/7 spawn real PTYs via `createProgrammatic`. On Windows, node-pty's `conpty_console_list_agent.js` helper prints `Error: AttachConsole failed` to stderr during PTY teardown. This is a node-pty/conpty environmental artifact, NOT a test failure — vitest exits 0 with 14 passed. The candidate branch's identical spawn tests exhibit the same noise. No action needed; the real-server smoke (deferred) runs on Linux/Docker where this does not occur.

## Deviations from plan

None — plan executed exactly as written. Tasks 2 and 3 (GREEN) were committed together as a single GREEN commit since they jointly turn the RED suite green and resume()-unchanged is asserted across both.

## Self-Check: PASSED

- sessions.js contains `rehydrateReplayable`, `replayable`, both accessors.
- tests/resumable-handlers.test.js contains 7 new tests referencing `rehydrateReplayable` / `__getReplayableForTest`.
- Commits `7981def` (RED) and `53c6de2` (GREEN) exist.
