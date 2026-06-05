---
phase: 13-shutdown-feedback
plan: 01
subsystem: server-lifecycle
tags: [shutdown, sessions, async, event-loop, pty]
requires: []
provides:
  - "async sessions.shutdown(cfg) that yields to the event loop between PTY kills"
  - "[clideck] killing N PTYs… done (Xms) diagnostic line"
affects:
  - sessions.js
  - tests/session-pause.test.js
tech-stack:
  added: []
  patterns: ["setImmediate yield in a sync kill loop to unblock the event loop"]
key-files:
  created: []
  modified:
    - sessions.js
    - tests/session-pause.test.js
decisions:
  - "D-01: sessions.shutdown async with `await new Promise(r => setImmediate(r))` after each pty.kill()"
  - "D-03: PTY-count diagnostic line (count + loop timing), no per-PTY noise"
  - "D-09: migrate the one synchronous test caller to await"
metrics:
  duration: "~10m"
  completed: "2026-06-04"
---

# Phase 13 Plan 01: sessions.shutdown async refactor — Summary

Made `sessions.shutdown(cfg)` async so the per-PTY `pty.kill()` loop yields to
the event loop between kills (the foundation that lets Plan 02's heartbeat and
watchdog fire DURING a worst-case Windows ConPTY hang), and added a
`[clideck] killing N PTYs… done (Xms)` diagnostic line.

## What changed

### Task 1 — `sessions.js`: async shutdown + setImmediate yields + PTY-count log
- `function shutdown(cfg)` → `async function shutdown(cfg)`.
- `clearInterval(autoSaveInterval)` and `saveSessions(cfg)` stay synchronous and
  first, before the loop — on-disk state is correct before any await.
- Before the loop: `const n = sessions.size; const t0 = Date.now();` then
  `process.stdout.write(`[clideck] killing ${n} PTYs… `)` (no newline).
- Inside the loop: the existing `try { s.pty.kill() } catch {}` is UNCHANGED,
  followed by `await new Promise(r => setImmediate(r))` (one yield per PTY).
- After the loop: `process.stdout.write(`done (${Date.now() - t0}ms)\n`)`.
- With 0 PTYs the loop body never runs but the count line still prints
  (confirmed live in the full-suite run: `[clideck] killing 0 PTYs… done (0ms)`).
- **Commit:** `1493ac7`

### Task 2 — `tests/session-pause.test.js`: await the now-async shutdown
- `it('persists the resumable record to sessions.json', …)` callback made `async`.
- L127 `sessions.shutdown?.(CFG_WITH_RESUME)` → `await sessions.shutdown?.(…)`.
- Grep confirmed this was the only `.shutdown` caller in `tests/`.
- **Commit:** `eaf3fe2`

## Isolated-try preservation
The inner per-PTY `try { s.pty.kill() } catch {}` is byte-for-byte unchanged —
the silent catch is load-bearing (one failing kill can't strand the loop;
preserves the 2026-05-18 stranded-PID-12980 protection). Only an `await` was
added after the try/catch.

## Verification
- `npx vitest run tests/session-pause.test.js` → **exit 0** (judged by exit code).
- Full suite (`npx vitest run`) → **exit 0**, 151 passed / 1 skipped (19 files).

## Deviations from Plan
None — plan executed exactly as written.

## Self-Check: PASSED
- `sessions.js` modified, contains `async function shutdown` — FOUND.
- `tests/session-pause.test.js` contains `await sessions.shutdown` — FOUND.
- Commits `1493ac7`, `eaf3fe2` — FOUND in git log.
