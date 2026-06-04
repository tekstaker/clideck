---
phase: 13-shutdown-feedback
plan: 02
subsystem: server-lifecycle
tags: [shutdown, heartbeat, watchdog, signals, factory, dependency-injection]
requires: ["13-01: async sessions.shutdown"]
provides:
  - "shutdown.js createShutdown factory: banner + step + heartbeat + watchdog, deps injected"
  - "server.js wired to createShutdown on SIGINT/SIGTERM with the signal name threaded through"
  - "package.json version 1.31.16"
affects:
  - shutdown.js
  - server.js
  - tests/shutdown.test.js
  - package.json
tech-stack:
  added: []
  patterns:
    - "factory + dependency injection so a port-binding module's lifecycle code is unit-testable"
    - "isolated-try step() helper that swallows per-step throws (never aborts later steps or exit)"
    - "setTimeout watchdog + setInterval heartbeat around an async sequence"
key-files:
  created:
    - shutdown.js
    - tests/shutdown.test.js
  modified:
    - server.js
    - package.json
decisions:
  - "D-02: step(label, fn) writes '<label>… ' then 'done (Xms)'/'failed: <msg>' on the same line, swallows throws"
  - "D-04: 3s heartbeat naming currentStep + elapsed seconds"
  - "D-05: 10s watchdog force-exit (hard-coded default, env-config deferred)"
  - "D-06: clearInterval(heartbeat) then clearTimeout(watchdog) on the happy path"
  - "D-07: shipped the stepInProgress-flag garbled-output mitigation"
  - "D-08: exact order of operations preserved"
  - "AC 8: bin/clideck.js untouched (thin require; signal lands on server.js directly)"
metrics:
  duration: "~25m"
  completed: "2026-06-04"
---

# Phase 13 Plan 02: observable hard-timed shutdown sequence — Summary

Built the observable shutdown sequence (signal-named ack banner, per-step
timing, 3s heartbeat, 10s watchdog, goodbye) in a new injectable `shutdown.js`
factory, unit-tested the load-bearing behaviours, wired it into `server.js`
threading the signal name, and bumped the version to 1.31.16.

## What changed

### Task 1 — `shutdown.js`: `createShutdown` factory
- Exports `createShutdown({ plugins, activity, sessions, getConfig, log, write,
  exit, timeoutMs=10000, heartbeatMs=3000 })` → `{ onShutdown, step }`.
- `step(label, fn)`: sets `currentStep`, writes `[clideck] <label>… ` (no
  newline), awaits `fn` (sync or Promise), writes `done (Xms)` or `failed: <msg>`,
  and SWALLOWS a throw — the isolated-try shape that must never abort later steps
  or the exit.
- `onShutdown(signal)` follows D-08 exactly: banner FIRST (no await before it,
  `SIGTERM received` vs `Ctrl+C received`, leading `\n`) → arm watchdog → arm
  heartbeat → three awaited steps → `clearInterval` then `clearTimeout` →
  `[clideck] goodbye.` → `exit(0)`.
- Heartbeat format: `[clideck] still shutting down… (current step: <label>,
  elapsed: <s>s)`. Watchdog: `[clideck] shutdown took too long — forcing exit`.
- The load-bearing stranded-PID-12980 isolated-try rationale is migrated into the
  module header.
- **Commit:** `9fa973e`

### Task 2 — `tests/shutdown.test.js`: 5 tests (all fakes, no server boot)
- **Isolated-try regression (AC 3):** throwing `plugins.shutdown` → `activity.stop`
  and `sessions.shutdown` still run, `exit(0)` reached, `failed: boom` surfaced,
  `goodbye.` still printed.
- Banner/order: SIGINT banner first, three `… done (Xms)` lines, goodbye, exit(0).
- SIGTERM banner variant (AC 7).
- **Watchdog (AC 5):** hung `sessions.shutdown` + fake timers; +9999ms no exit,
  +10001ms → `shutdown took too long — forcing exit` + `exit(0)`.
- **Heartbeat (AC 4):** hung step + fake timers; +3000ms emits a line matching
  `/\[clideck\] still shutting down… \(current step: .+, elapsed: \d+s\)/`.
- **Commit:** `17becd5`

### Task 3 — `server.js` wiring + `package.json` bump
- Inline `onShutdown` replaced with `const { onShutdown } = createShutdown({
  plugins, activity, sessions, getConfig })`.
- Handlers: `process.on('SIGINT', () => onShutdown('SIGINT'))` and the SIGTERM
  equivalent — signal name threaded through.
- Isolated-try / stranded-PID comment preserved above the wiring.
- `bin/clideck.js` untouched (verified NOT in the diff).
- `package.json` 1.31.14 → **1.31.16** (orchestrator-assigned for this branch).
- **Commit:** `06cfb81`

## D-07 garbled-output mitigation shipped
**Chosen option: the `stepInProgress` flag.** It is set `true` around the
dangling-label write span (`write('<label>… ')` until the `done`/`failed`
completion). When the heartbeat fires, if `stepInProgress` is true it prefixes
its line with a leading `\n` so it breaks cleanly off the dangling label;
otherwise it prints normally. (The always-leading-`\n` and label-on-its-own-line
alternatives were the documented fallbacks; the flag was shipped.)

## Isolated-try preservation
Asserted by the unit test (Test A): a throwing first step does not prevent later
steps or `exit(0)`. The rationale comment is preserved in both `server.js`
(above the wiring) and `shutdown.js` (module header).

## Verification
- `npx vitest run tests/shutdown.test.js` → **exit 0**, 5 passed.
- Task 1 factory smoke + Task 3 wiring node-verify → **both exit 0**.
- Full suite (`npx vitest run`) → **exit 0**, 151 passed / 1 skipped (19 files).
- `git diff --name-only main` → exactly: `package.json`, `server.js`,
  `sessions.js`, `shutdown.js`, `tests/session-pause.test.js`,
  `tests/shutdown.test.js` — and **NOT** `bin/clideck.js`.

## Full-suite tail
```
Test Files  19 passed (19)
     Tests  151 passed | 1 skipped (152)
```

## Deviations from Plan
**[Rule 1 — Test correctness] Heartbeat test in-flight step.** The plan's Test C
sketch implied hanging `sessions.shutdown` to assert `current step: persisting
sessions`. Under vitest fake timers the awaits between steps don't auto-flush, so
the in-flight step when the 3s tick fires is the FIRST hung step, not a later
one. Fixed by hanging `activity.stop` and asserting `current step: stopping
activity` — the D-04 format regex (the load-bearing assertion) is unchanged and
still proves the heartbeat contract. No production-code change; test-only.

## Deferred to human smoke (all of Plan 13-03 — wave 3)
These need a real foreground terminal + real OS signals and CANNOT be verified
headlessly. Run from an EXTERNAL terminal (PowerShell / Windows Terminal),
NEVER inside the host clideck session (recursive lifecycle footgun). Throwaway
port + isolated data dir.

### Playwright e2e (AC 11)
```
npx playwright test
```
Must exit 0 — no UI behaviour changed this phase.

### External-terminal manual smoke (AC 1, 2, 4, 5, 6, 7, 9)

1. **AC 1 (ack ≤50ms) + AC 6 (goodbye), 0 PTYs** — in PowerShell:
   ```powershell
   $env:PORT=4099; $env:DATA_DIR="$env:TEMP\clideck-13smoke"; node bin/clideck.js
   ```
   Wait for the boot banner, press **Ctrl+C**. Confirm:
   - `[clideck] Ctrl+C received — shutting down…` appears effectively instantly,
     on its own line (separated from the shell's `^C`).
   - Three step lines: `flushing plugins… done (Xms)`, `stopping activity… done
     (Xms)`, `persisting sessions…` (with nested `killing 0 PTYs… done (Xms)`)
     `done (Xms)`.
   - Final `[clideck] goodbye.`, then the prompt returns (clean exit).

2. **AC 1/2 with 1 and 4 PTYs** — re-boot, open http://127.0.0.1:4099, create 1
   terminal session, Ctrl+C in the launching terminal → confirm `killing 1 PTYs…
   done (Xms)`. Repeat with 4 sessions → confirm `killing 4 PTYs… done`.

3. **AC 4 (heartbeat) + AC 5 (watchdog), injected slow step** — temporarily edit
   `shutdown.js` so `flushing plugins` awaits a 12-second sleep, e.g. make the
   step fn `() => new Promise(r => setTimeout(r, 12000))`. Boot, Ctrl+C. Confirm:
   - ~+3s: `[clideck] still shutting down… (current step: flushing plugins,
     elapsed: 3s)`.
   - ~+6s and ~+9s: further heartbeats with rising elapsed.
   - ~+10s: `[clideck] shutdown took too long — forcing exit`, process exits
     (the 12s sleep never completes — the watchdog won).
   - **REVERT the injected delay afterwards.**

4. **AC 7 (SIGTERM parity)** — re-boot, note the pid from the boot banner. In a
   SECOND terminal: `taskkill /PID <pid>` (WITHOUT `/F`). Confirm the launching
   terminal shows `[clideck] SIGTERM received — shutting down…` then the same step
   lines and `[clideck] goodbye.`.

5. **AC 9 (recover via Ctrl+C alone)** — during the step-3 hang, confirm Ctrl+C
   alone returned you to a prompt within the 10s watchdog window — no need to
   close the terminal window.

Clean up the throwaway data dir (`$env:TEMP\clideck-13smoke`) when done. Per the
inspection-resolved AC 8, the signal lands on `server.js` directly (bin/clideck.js
is a thin in-process require — no forwarding).

## Self-Check: PASSED
- `shutdown.js` created, contains `function createShutdown` — FOUND.
- `tests/shutdown.test.js` created with `// @vitest-environment node` — FOUND.
- `server.js` contains `createShutdown` + signal-threaded handlers — FOUND.
- `package.json` version 1.31.16 — FOUND.
- Commits `9fa973e`, `17becd5`, `06cfb81` — FOUND in git log.
