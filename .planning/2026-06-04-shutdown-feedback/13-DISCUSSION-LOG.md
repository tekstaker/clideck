# Phase 13: shutdown-feedback - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 13-shutdown-feedback
**Areas discussed:** Event-loop blocking

---

## Pre-discussion findings (code inspection)

Two SPEC items were resolved by reading code before discussion:

1. **`bin/clideck.js` is 8 lines** — thin `require('../server.js')` wrapper,
   no `spawn`, no child process. SIGINT/SIGTERM lands directly on
   `server.js:391`. SPEC scope item #5 (wrapper signal-path validation)
   and SPEC AC 8 (Windows SIGINT reaches the server) are satisfied by
   inspection; no runtime testing or wrapper logging needed. CONTEXT.md
   flags this as a SPEC correction.

2. **The per-PTY `pty.kill()` loop is the real hang multiplier.**
   `sessions.js:739-745` has a synchronous for-loop killing N PTYs. THIS,
   not the outer 3-step boundaries, is where Windows ConPTY hangs add up.
   The SPEC's outer-3-step instrumentation is necessary but not sufficient
   — the inner loop needed addressing too. This finding reshaped the
   "logging granularity" and "event-loop blocking" gray areas.

---

## Gray areas presented (4 — multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Event-loop blocking | Heartbeat + watchdog need the loop running; sessions.shutdown is sync and blocks. | ✓ |
| Logging granularity | Outer-step only vs +PTY-kill instrumentation. | |
| Timing defaults | 3s heartbeat / 10s watchdog or different. | |
| Test surface | Unit + manual smoke split. | |

**User's choice:** Event-loop blocking only.
**Notes:** Same pattern as Phase 12 — picking only the decision that actually changes the plan shape. The other three folded into Claude's discretion / reasonable defaults in CONTEXT.md.

---

## Event-loop blocking

| Option | Description | Selected |
|--------|-------------|----------|
| Yield between PTY kills + make onShutdown async (recommended) | ~6 line touch; sessions.shutdown becomes async with `await new Promise(r => setImmediate(r))` after each kill; onShutdown becomes async with awaited step() calls. Heartbeats + watchdog fire on time. Isolated try/catch shape preserved. | ✓ |
| Accept the caveat — sync everywhere | Heartbeats appear late retrospectively. Cheapest, but defeats the point. | |
| Full async refactor of sessions.shutdown | Promise.all parallel kill. Bigger surgery in a load-bearing path; 2026-05-18 stranded-PID incident counsels against. | |

**User's choice:** Yield between PTY kills + make onShutdown async.
**Notes:** The middle option — small surface change, preserves the load-bearing isolated-try shape, and is the smallest change that actually delivers the heartbeat/watchdog UX the SPEC asks for. Locked as D-01.

---

## Reasonable defaults applied (gray areas not selected for discussion)

The user didn't ask to discuss these three areas; CONTEXT.md fills them in with sensible defaults flagged as Claude's discretion where appropriate.

### Logging granularity

Going with **outer-step labels + a single PTY-kill count log inside `sessions.shutdown`** (D-02 + D-03). Per-PTY logging is deferred until a real hang report exists.

### Timing defaults

Going with **SPEC defaults: 3 s heartbeat, 10 s watchdog** (D-04 + D-05). First heartbeat at +3 s — the <50 ms ack banner already covers the "did clideck see my Ctrl+C" question, so a faster first heartbeat would be redundant.

### Test surface

Going with **SPEC AC 3's isolated-try regression test + a watchdog-armed unit + manual smoke from external terminal as the real verification** (D-09 + D-10). The manual smoke is non-negotiable per the meta-work footgun memory.

---

## Claude's Discretion

- Exact heartbeat string wording (D-04 is a sketch).
- Garbled-output mitigation (D-07): three options enumerated, implementer picks based on real terminal feedback.
- Whether per-PTY `pty.kill()` catch logs to stderr or stays silent.

## Deferred Ideas

- Per-PTY logging inside the kill loop.
- Configurable watchdog cap via env / config.
- Per-PTY `pty.kill()` error logging.
- Async-aware test-harness migration if existing tests don't already support await.
- In-UI server restart (Phase 4 parked, explicitly out of scope).
