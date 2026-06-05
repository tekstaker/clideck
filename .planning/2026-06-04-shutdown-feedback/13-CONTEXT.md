# Phase 13: shutdown-feedback - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the silent Ctrl+C → close-the-terminal-window UX of a `clideck`
shutdown with a noisy, observable, hard-timed sequence: ~50 ms ack banner,
per-step labels with timing, 3 s heartbeat while shutdown drags, 10 s
hard-timeout watchdog that force-exits rather than hanging, and a final
`[clideck] goodbye.` line on the happy path.

Implementation surface is **`server.js` (onShutdown + step helper +
heartbeat + watchdog) and `sessions.js` (shutdown becomes async, yields
between PTY kills)**. `bin/clideck.js` is **not modified** — code review
established it's a thin in-process require, so the SPEC's scope item #5
(wrapper signal-path validation) is resolved by inspection.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**11 acceptance criteria are locked.** See `2026-06-04-shutdown-feedback/SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `2026-06-04-shutdown-feedback/SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):** Immediate SIGINT ack, per-step labels with timing, heartbeat while shutdown is in flight, hard-timeout watchdog, signal-path validation through `bin/clideck.js`, implementation note on sync-vs-async.

**Out of scope (from SPEC.md):** Reviving in-UI server restart; changing the shutdown work itself; persisting a "last shutdown took X" stat; re-architecting `bin/clideck.js`'s launch model.

### ⚠ SPEC.md correction — wrapper signal-path is resolved by inspection

The SPEC names scope item #5 "Signal-path validation through `bin/clideck.js`"
as needing verification. **Code inspection during discuss-phase resolves it
without runtime testing.** `bin/clideck.js` is 8 lines:

```js
#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'ask') {
  require('../clideck-ask-cli').run(args.slice(1));
} else {
  require('../server.js');
}
```

No `spawn`, no child process. The server runs in the same Node process the
user typed `clideck` to start, so SIGINT/SIGTERM lands directly on
`server.js:391` `process.on('SIGINT', onShutdown)`. There is nothing to
forward and no wrapper logging is needed. SPEC AC 8 ("On Windows: SIGINT
actually reaches the server process") is satisfied trivially by this
inspection — no per-machine signal trace required.

### Additional finding: the per-PTY kill loop is the real worst-case

`sessions.js:739-745` `shutdown(cfg)`:

```js
function shutdown(cfg) {
  clearInterval(autoSaveInterval);
  saveSessions(cfg);
  for (const [, s] of sessions) {
    try { s.pty.kill(); } catch {}
  }
}
```

The synchronous per-PTY `pty.kill()` loop runs N times, blocking the event
loop. THIS — not the outer 3-step boundaries — is the real hang multiplier
on Windows ConPTY. D-01 below addresses it directly.

</spec_lock>

<decisions>
## Implementation Decisions

### Event-loop blocking strategy

- **D-01: Make `onShutdown` and `sessions.shutdown` async; yield between
  PTY kills.** Smallest change that makes the heartbeat and watchdog
  actually fire on time during shutdown work. Concretely:
  - `sessions.js` `shutdown(cfg)` becomes `async function`, with
    `await new Promise(r => setImmediate(r))` after each `try { s.pty.kill() } catch {}` inside the for-loop. The clearInterval + saveSessions calls before the loop stay synchronous.
  - `server.js` `onShutdown` becomes `async function`. Each `step()` call is
    awaited.
  - The isolated try/catch shape is **preserved** — async or not, each
    step's failure must not prevent later steps or the final
    `process.exit(0)`. This is load-bearing per the 2026-05-18
    stranded-PID-12980 incident.
  - **Rejected alternatives:** accepting the caveat sync-everywhere
    (heartbeats appear late retrospectively — defeats their point);
    full `Promise.all` parallel-kill refactor of `sessions.shutdown`
    (bigger surgery in a load-bearing path; the 2026-05-18 incident
    counsels against gratuitous changes here).

### Step helper + logging

- **D-02: `step(label, fn)` helper writes `[clideck] <label>… ` (no
  newline), awaits fn, then `done (Xms)` or `failed: <msg>` on the same
  line.** Step names: `flushing plugins`, `stopping activity`,
  `persisting sessions`. Implementation lives in `server.js`. The helper
  wraps the existing try/catch shape so one step throwing does NOT prevent
  later steps from running.
- **D-03: Inside `sessions.shutdown`, log the PTY-kill count.** After
  `saveSessions(cfg)`, before the kill loop, write
  `[clideck] killing N PTYs… ` (where N = `sessions.size`) and after the
  loop write `done (Xms)`. This makes the "where was time spent inside
  sessions.shutdown" question diagnosable (PTYs vs saveSessions) without
  per-PTY noise. Per-PTY logging is deferred — see Deferred Ideas.

### Heartbeat & watchdog

- **D-04: Heartbeat fires every 3 s while shutdown is in flight.**
  Format: `[clideck] still shutting down… (current step: <label>,
  elapsed: <s>s)`. The current-step name is tracked by a module-scope
  variable updated at the start of each `step()` call (e.g.
  `currentStep = label`); the heartbeat formatter reads it. First
  heartbeat at +3 s, not faster — the ack banner at <50 ms already
  covers the "did clideck see my Ctrl+C" question.
- **D-05: Hard-timeout watchdog at 10 s.** `setTimeout` armed at
  `onShutdown` entry. If it fires before normal exit, log
  `[clideck] shutdown took too long — forcing exit` and call
  `process.exit(0)`. The timer is `clearTimeout()`'d on the happy path
  immediately before `process.exit(0)`. Default cap value is hard-coded;
  configurable-via-env is deferred.
- **D-06: Heartbeat is `clearInterval()`'d on the happy path too,**
  immediately before the `[clideck] goodbye.` line, so a stray
  heartbeat can't print after goodbye.
- **D-07: Garbled-output mitigation (Claude's discretion).** The
  step helper writes a label with no trailing newline; if a heartbeat
  fires between the label write and the `done (Xms)` write, output is
  visually broken. Implementer's call: either suppress heartbeats with
  a `stepInProgress` flag, OR print heartbeats with a leading `\n`
  to break cleanly, OR change the step format to always print
  label-on-its-own-line and completion-on-its-own-line. Picked at
  implementation time based on what looks best in a real terminal.

### Sequencing

- **D-08: Order of operations inside `onShutdown`:**
  1. `console.log('\n[clideck] Ctrl+C received — shutting down…')` (or
     `SIGTERM received` if the signal was SIGTERM — pass the signal
     name through the handler).
  2. Arm watchdog (`setTimeout(watchdog, 10000)`).
  3. Arm heartbeat (`setInterval(heartbeat, 3000)`).
  4. `await step('flushing plugins', () => plugins.shutdown())`.
  5. `await step('stopping activity', () => activity.stop())`.
  6. `await step('persisting sessions', () => sessions.shutdown(getConfig()))`.
  7. `clearInterval(heartbeat)` then `clearTimeout(watchdog)`.
  8. `console.log('[clideck] goodbye.')`.
  9. `process.exit(0)`.

### Test surface

- **D-09: Vitest coverage required:**
  - Isolated-try regression: inject a throwing fake for one of the three
    steps (e.g. mock `plugins.shutdown` to throw); assert the later
    steps still run and `process.exit(0)` is reached. SPEC AC 3.
  - Watchdog armed: assert that `onShutdown` schedules a timeout with the
    expected cap. Don't fire it; just assert the timer exists.
  - Heartbeat-format unit (optional, low priority): given a known
    elapsed time + current step name, the heartbeat string matches
    `[clideck] still shutting down… (current step: …, elapsed: …s)`.
  - sessions.shutdown async signature: existing tests that call
    `sessions.shutdown(cfg)` synchronously must be updated to await it,
    OR the helper test surface must accept both.
- **D-10: Manual smoke from an external terminal is the real
  verification.** Per the SPEC's footgun warning + the
  [[../../memory/feedback_clideck-meta-work.md]] memory: do NOT iterate
  on shutdown from inside the host clideck session. Boot a candidate
  build via `PORT=4099 DATA_DIR=… node bin/clideck.js` from PowerShell /
  Windows Terminal, exercise Ctrl+C with 0, 1, and 4 active PTYs, observe
  the banner / step labels / goodbye output. Also: inject an artificial
  slow step (e.g. a 6-second await inside one step) and watch the
  heartbeats fire on time and the watchdog force-exit a 12-second hang.

### Claude's Discretion

- Exact heartbeat string format wording — D-04 is a sketch. Implementer
  picks the final phrasing.
- Garbled-output mitigation choice (D-07) — three options enumerated;
  implementer picks based on terminal feedback.
- Whether the per-PTY `pty.kill()` catches log to stderr (today they
  swallow silently with `try { } catch {}`) or stay silent. Slight
  preference for logging at debug level since the user already has the
  PTY-count log from D-03.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements
- `.planning/2026-06-04-shutdown-feedback/SPEC.md` — Locked requirements (with the SPEC corrections above: wrapper validation resolved by inspection; PTY-kill loop is the worst-case multiplier).
- `.planning/todos/completed/2026-06-04-shutdown-feedback-and-progress.md` — Source todo with verbatim Lance quote and the async-refactor sketch.

### Code touchpoints
- `server.js:380-392` — current `onShutdown`. **Replaced** with the async sequenced version from D-08.
- `server.js:391-392` — `process.on('SIGINT'/'SIGTERM', onShutdown)`. The handler arg must pass the signal name through (D-08 step 1 conditionally banners "SIGTERM received").
- `sessions.js:739-745` — current `shutdown(cfg)`. **Modified** to async with `setImmediate` yields between PTY kills (D-01) and the PTY-count log (D-03).
- `bin/clideck.js` (8 lines, entire file) — **not modified**. Inspection-resolved per SPEC correction above.

### Historical context
- `memory/feedback_clideck-meta-work.md` — don't iterate on lifecycle work inside the host clideck.
- `memory/feedback_verify-clideck-ui-altport-playwright.md` — the throwaway :4099 verification pattern for D-10.
- `memory/project_restart-button-broken.md` — the 2026-05-27 forensic notes that surround the parked Phase 4. Confirms why this phase doesn't revive in-UI restart.
- `memory/feedback_bump-version-on-code-changes.md` — bump `package.json` patch on the code-changing commit.

### Existing tests to NOT regress
- Any tests that currently call `sessions.shutdown(cfg)` synchronously — they need to be awaited after D-01.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The existing isolated-try/catch shape at `server.js:386-388` is the pattern the new `step()` helper must preserve. The shape exists because of the 2026-05-18 stranded-PID-12980 incident; D-01 keeps it intact.
- `console.log` / `process.stdout.write` are the only output sinks needed. No new dependency, no logger refactor.
- Node's `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` cover heartbeat + watchdog.

### Established Patterns
- **Same-line label-then-result** matches the existing tone of clideck's startup output (e.g. listen-retry log on EADDRINUSE at `server.js:399-409`). Step labels in D-02 should harmonise with that style.
- **`activity.stop`, `plugins.shutdown`, `sessions.shutdown`** — the three existing shutdown steps. Their semantics don't change; this phase only wraps them with timing and logs.

### Integration Points
- `getConfig()` is already imported at `server.js:384` for the current `onShutdown` call. The async version uses the same call.
- The retry-listen logic at `server.js:399-441` is unchanged — it's the inbound-bind logic, not the outbound-exit logic.

</code_context>

<specifics>
## Specific Ideas

- The leading `\n` on the SIGINT ack banner is load-bearing — the shell prints `^C` on the current line, so the newline separates the banner from that. Don't drop it.
- Heartbeat tracks `currentStep` via a module-scope mutable so the formatter can read it cheaply. Updated at the start of each `step()` call.
- The `[clideck] goodbye.` line is the success signal. Without it, the user can't distinguish "exited cleanly" from "exited via crash" in a terminal that scrolls.

</specifics>

<deferred>
## Deferred Ideas

- **Per-PTY logging inside the kill loop.** Today D-03 logs a count
  (`killing N PTYs… done`). If a single PTY is the consistent source of
  hangs, future instrumentation could log per-PTY with an id +
  elapsed-ms. Deferred until a real hang report exists to motivate the
  noise.
- **Configurable watchdog cap via env / config.** Hard-coded 10 s for v1.
  A future phase could expose `getConfig().shutdownTimeoutMs` if a
  particular environment (long-saving sessions, slow disks) makes the
  default wrong.
- **Per-PTY `pty.kill()` error logging.** Today swallowed silently. D-03
  + D-04 give the user a good-enough signal; surfacing kill errors is
  diagnostic and worth its own follow-up if a kill ever genuinely fails.
- **Async-aware `sessions.shutdown` tests.** D-09 names this as a
  catch-up to D-01. If the existing test harness already supports await,
  the migration is free; if not, a small adapter may be warranted as a
  separate small task.
- **Restart-from-the-UI.** Out of scope (Phase 4 parked); explicitly
  excluded by SPEC. Phase 13 only fixes the manual `Ctrl+C → relaunch`
  experience.

</deferred>

---

*Phase: 13-shutdown-feedback*
*Context gathered: 2026-06-04*
