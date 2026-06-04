# SPEC — Visible Ctrl+C shutdown feedback (ack, progress, hard timeout)

**Status:** planned (not yet discussed/planned — seeded from one pending todo 2026-06-04)
**Owner:** Lance Keay
**Date:** 2026-06-04

## What this delivers

Replaces the current "press Ctrl+C, watch dead silence, eventually close the
terminal window" UX of a `clideck` shutdown with a noisy, observable, hard-
timed sequence:

1. Immediate (~50 ms) acknowledgement banner the moment SIGINT/SIGTERM lands.
2. Per-step progress lines with completion time so the user can see *where*
   in shutdown the server is.
3. A heartbeat tick every 3 s while shutdown drags on, naming the current step
   and elapsed time.
4. A hard-timeout watchdog (~10 s) that forces `process.exit(0)` rather than
   hanging the terminal forever.
5. A final `[clideck] goodbye.` line before exit so success is unambiguous.

## Why

`onShutdown` at **`server.js:385-390`** today logs only on the *error* path:

```js
function onShutdown() {
  try { plugins.shutdown(); }            catch (e) { console.error('[shutdown] plugins:',  e.message); }
  try { activity.stop(); }               catch (e) { console.error('[shutdown] activity:', e.message); }
  try { sessions.shutdown(getConfig()); } catch (e) { console.error('[shutdown] sessions:', e.message); }
  process.exit(0);
}
```

The user perspective: hit Ctrl+C, see nothing, wait, eventually the prompt
returns — or doesn't. Lance's stated expectation, verbatim from the source
todo:

> *"I would like some sort of feedback when I hit control C. And then some
> sort of logging messages to let me know what's happening. It should shut
> down pretty instantly. But if it's got things to do, then just throw a
> message every few seconds until it's done. Let me know how long it's
> gonna take."*

The current workaround — close the terminal window entirely — risks
orphaning child processes and is heavier than necessary. Worse, when a step
blocks synchronously (`node-pty.kill()` on Windows ConPTY has known hang
modes), `process.exit(0)` is never reached and the symptom looks identical
to "everything is fine, just slow" — there's no diagnostic signal.

## Scope

**In scope**

### 1 — Immediate SIGINT ack (must be first; bare-minimum win)

- First statement inside `onShutdown` (before any try/catch step):
  ```
  console.log('\n[clideck] Ctrl+C received — shutting down…');
  ```
- Leading newline separates the message from the shell's `^C` glyph on the
  same line.
- Same banner for SIGTERM (text adjusted: "SIGTERM received").

### 2 — Per-step labels with timing

- Wrap the three existing try/catch steps in a `step(label, fn)` helper that
  prints `[clideck] <label>… ` then `done (Xms)` or `failed: <msg>` on the
  same line.
- Step names: `flushing plugins`, `stopping activity`, `persisting sessions`.
- **Preserve the isolated try/catch shape** — one step's failure must never
  prevent later steps or `process.exit(0)` from running. This is load-bearing
  per the 2026-05-18 stranded-PID-12980 incident; see comments at
  `server.js:380-383`.

### 3 — Heartbeat while shutdown is in flight

- After ~3 s of unfinished shutdown, log `[clideck] still shutting down…
  (current step: <label>, elapsed: <s>s)` every 3 s.
- Heartbeat clears as soon as `process.exit` is reached or the watchdog fires.

### 4 — Hard-timeout watchdog

- Start a `setTimeout` at `onShutdown` entry. If it fires before normal exit,
  log `[clideck] shutdown took too long — forcing exit` and call
  `process.exit(0)` regardless of in-flight work.
- Default cap: 10 s. Configurable via env or `getConfig().shutdownTimeoutMs`
  if low effort, otherwise hard-coded.

### 5 — Signal-path validation through `bin/clideck.js`

- Confirm the SIGINT/SIGTERM the user sends actually reaches the server
  process and isn't swallowed by the wrapper at `bin/clideck.js`. If the
  wrapper is involved in the signal path, it must either:
  - Forward the signal and log `[clideck] forwarding Ctrl+C to server…` so
    the signal path is debuggable, OR
  - Be confirmed to be a thin `require()` (in which case no wrapper logging
    needed — note this in the verification report).
- This is verification work, not a forced refactor: if the wrapper already
  forwards correctly, leave it.

### 6 — Implementation note: async vs sync

- The cleanest implementation makes `onShutdown` async, awaiting each step
  so the heartbeat timer can interleave on the event loop. The defensive
  isolated-try shape adapts cleanly: each step becomes
  ```
  await stepAsync('persisting sessions', () => sessions.shutdown(getConfig()));
  ```
  with `stepAsync` wrapping in try/catch internally.
- If any step is synchronous-only (`sessions.shutdown` may be), wrap it in
  `await Promise.resolve().then(() => syncStep())` so the heartbeat interval
  still gets to fire between steps.

**Out of scope**

- Reviving the in-UI server restart (removed 2026-05-27, Phase 4 is parked).
- Changing the shutdown work itself — this phase adds observability and a
  safety net around `onShutdown`; the steps it runs stay the same.
- Persisting a "last shutdown took X" stat anywhere.
- Re-architecting `bin/clideck.js`'s launch model. Validate the signal path;
  don't redesign it.

## Acceptance criteria

1. Pressing Ctrl+C in the terminal running `clideck` prints
   `[clideck] Ctrl+C received — shutting down…` within **≤ 50 ms** of the
   keypress.
2. Each shutdown step prints its label and completion time
   (`<label>… done (Xms)`) or failure (`<label>… failed: <msg>`).
3. The isolated-try/catch shape is preserved: a step throwing does NOT
   prevent later steps or the final `process.exit(0)` from running. Verify
   with a unit test that injects a throwing fake for one step.
4. If total shutdown exceeds 3 s, a heartbeat fires every 3 s naming the
   current step and elapsed time.
5. If total shutdown exceeds the watchdog cap (default 10 s), the server
   force-exits with `[clideck] shutdown took too long — forcing exit`.
6. Final line on the happy path: `[clideck] goodbye.` (or close equivalent),
   printed before `process.exit(0)`.
7. SIGTERM (e.g. `taskkill /PID <pid>` without `/F`) behaves the same as
   SIGINT — same banner, same step output, same watchdog.
8. On Windows: SIGINT actually reaches the server process. If a wrapper
   forwards it, the wrapper logs the forward; if not, the verification
   report names where the signal lands.
9. The user can recover from a hung shutdown via Ctrl+C alone — closing the
   terminal window is no longer required.
10. All existing Vitest suites pass plus the new isolated-try regression
    test.
11. All existing Playwright suites pass (no UI behaviour should change).

## ⚠ Footgun — do not iterate inside the host clideck

This is **lifecycle work**, exactly the category
[[../../memory/feedback_clideck-meta-work.md]] warns about. Don't iterate on
shutdown from inside the host clideck session — work in an external terminal
(PowerShell / Windows Terminal), boot the candidate build manually with
`PORT=4099 DATA_DIR=… node bin/clideck.js`, exercise Ctrl+C there, and lean
on `[[../../memory/feedback_verify-clideck-ui-altport-playwright.md]]` for
the throwaway-port verification pattern.

## Cross-cutting constraints

- Per the project version-bump rule, bump `package.json` patch on the
  code-changing commit so the connection lozenge surfaces the new build.
- **Do not push to `origin`** — origin is GitHub.

## Relation to shipped work

- **2026-05-18 stranded-PID-12980 incident** — gave `onShutdown` its current
  isolated-try shape. That shape must be preserved here; this phase only
  layers logging + a watchdog on top.
- **Phase 4 — `2026-05-18-restart-architecture` (parked)** — the broken
  in-UI server restart was removed on 2026-05-27 (v1.31.9). This phase does
  NOT revive that work; it just makes the manual `Ctrl+C → relaunch
  clideck` flow tolerable in the interim.

## Source todo

Seeded from (and supersedes for tracking purposes):

- `.planning/todos/completed/2026-06-04-shutdown-feedback-and-progress.md`

That file has the verbatim Lance quote, the `server.js:385-390` line citation,
the async-refactor sketch, and the heartbeat/watchdog implementation notes.
This SPEC has not yet been through `/gsd-discuss-phase` or `/gsd-plan-phase`
— refine before executing.
