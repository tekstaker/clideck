---
phase: 14-replayable-shell-sessions
plan: 03
subsystem: server-boot / release
tags: [wire-up, server-boot, version-bump, regression-guard]
provides: boot-time rehydrate wire-up + version 1.31.17
requires: ["14-02"]
affects: [server.js, package.json]
key-files:
  modified:
    - server.js
    - package.json
decisions:
  - "rehydrateReplayable wired AFTER loadSessions, BEFORE transcript init (replayable PTYs must be live before the transcript builds its resumable-id set)"
  - "Version bumped to 1.31.17 (orchestrator-assigned for this branch; plan's 1.31.15 superseded)"
metrics:
  completed: 2026-06-04
  commit: 8f6fdc2
status: autonomous-parts-complete; human smoke + Playwright DEFERRED
---

# Phase 14 Plan 03: Wire-up + Verify Summary

Wired `rehydrateReplayable` into the server boot sequence, bumped the version, and ran the full Vitest regression guard. The external-terminal restart-survival smoke and Playwright e2e are **deferred to a human** (both require booting a real clideck server — a recursive footgun inside the host session).

## What changed (autonomous)

- **server.js** — added `sessions.rehydrateReplayable(require('./handlers').getConfig());` immediately after `sessions.loadSessions();` and before the `transcript.init(...)` call, with a comment explaining the ordering (replayable PTYs must be live in the sessions Map before the transcript builds its resumable-id set, which is sourced from `getResumable()` not replay entries) and why `handlers.getConfig()` is safe here (handlers already required). No reorder of transcript/telemetry/opencode-bridge init.
- **package.json** — `1.31.14` → `1.31.17`.

## Verification (autonomous)

- Wire-up ordering + version asserted: `node -e "...before<mid && mid<after..."` → `ok` (loadSessions@2555 < rehydrateReplayable@2967, and the real `transcript.init` call follows the rehydrate; version === 1.31.17).
- **Full Vitest suite**: `npx vitest run` → **18 test files passed, 153 passed | 1 skipped (154)**, VITEST_FULL_EXIT=0. No failures, no regression. The 1 skipped is pre-existing and unrelated to this work (this phase only added passing tests).
- `git diff --name-only main` → exactly: `agent-presets.json`, `config.js`, `package.json`, `server.js`, `sessions.js`, `tests/resumable-handlers.test.js`.
- The explicit `canReplay` partition (not else-fallthrough) confirmed in sessions.js; resume() byte-unchanged (see 14-02-SUMMARY).

## Deviations from plan

1. **[Rule 3 — blocking] Comment reworded to unblock the plan's verify script.** The plan's wire-up verify uses `indexOf('transcript.init')`, which matched my initial comment text (`BEFORE transcript.init`) before the real call, producing a false exit-3. Reworded the comment to "BEFORE the transcript initializes below" (no literal `transcript.init` token) so the ordering assertion measures the real call site. No behaviour impact. Files: server.js. Commit: 8f6fdc2.
2. **Version 1.31.17 instead of the plan's 1.31.15.** Orchestrator-assigned for this branch (the plan's 1.31.15 was a pre-branch estimate). Verify adapted to assert 1.31.17.
3. **Task 2 Playwright + Task 3 manual smoke not run (DEFERRED, per scope).** Both require a real server boot, which is prohibited from inside the host clideck session (lifecycle footgun). See below.

## Deferred to human smoke

Run all of the following from an **EXTERNAL terminal** (not inside the host clideck session) against a throwaway :4099 instance with an isolated data dir. References: `memory/feedback_clideck-meta-work.md`, `memory/feedback_verify-clideck-ui-altport-playwright.md`.

### AC 1 — headline restart survival
1. `PORT=4099 CLIDECK_DATA_DIR=/tmp/clideck-smoke-14 node server.js` (fresh temp data dir).
2. Open http://localhost:4099, open a plain Shell tab, `cd /home/clideck/projects` (or any existing dir), confirm the prompt.
3. Wait 35s for the autosave tick (watch for the `sessions.saved` broadcast / log line).
4. Confirm the entry landed (AC 2): `jq '[.[] | select(.replayable == true)] | length' /tmp/clideck-smoke-14/sessions.json` → ≥1.
5. Stop the server (Ctrl-C / taskkill the :4099 process), restart with the same PORT + CLIDECK_DATA_DIR.
6. Reload http://localhost:4099 — the Shell tab is back; run `pwd` → reports the directory from step 2 (AC 1).

### AC 5 — missing-cwd → $HOME fallback
7. Stop the server. Edit `/tmp/clideck-smoke-14/sessions.json`: change the replayable entry's `cwd` to a nonexistent path (e.g. `/tmp/gone-1234`). Restart.
8. Confirm the tab still rehydrates (no crash), the server logs a WARN about the missing cwd, and `pwd` in the rehydrated tab reports `$HOME`.

### AC 4 — pre-fix file upgrade
9. Stop the server. Replace `sessions.json` with a pre-fix-shape file (flat array, NO `replayable` key on any entry — e.g. an old agent-only sessions.json). Restart.
10. Confirm the server loads cleanly (logs `Loaded N resumable ... session(s)`), no entries lost, no replay shell spuriously spawned from the pre-fix entries.

### Cleanup
11. taskkill the :4099 process and `rm -rf /tmp/clideck-smoke-14`.

### Playwright (AC 7)
Run the e2e suite externally (it boots a server): `npx playwright test`. Expect green — no UI behaviour change is introduced by this phase.

## Self-Check: PASSED

- server.js contains `rehydrateReplayable`; package.json version === 1.31.17.
- Commit `8f6fdc2` exists.
