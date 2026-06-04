---
phase: 14-replayable-shell-sessions
plan: 03
type: execute
wave: 3
depends_on: ["14-02"]
files_modified:
  - server.js
  - package.json
autonomous: false   # contains the external-terminal manual smoke checkpoint (D-05)
requirements: []    # no REQUIREMENTS.md — traces to SPEC AC 1, 3, 7, 8 + D-05
user_setup: []

must_haves:
  truths:
    - "On server boot, persisted plain-shell tabs are rehydrated as fresh PTYs in their saved cwd before the transcript initializes"
    - "A plain Shell tab survives a restart and reloads with the correct pwd (the headline user outcome)"
    - "Agent resumable sessions and the full Vitest + Playwright suites are unaffected"
  artifacts:
    - path: "server.js"
      provides: "rehydrateReplayable wire-up after loadSessions, before transcript.init"
      contains: "rehydrateReplayable"
    - path: "package.json"
      provides: "version bump to 1.31.15"
      contains: "1.31.15"
  key_links:
    - from: "server.js loadSessions()"
      to: "sessions.rehydrateReplayable(handlers.getConfig())"
      via: "boot sequence, before transcript.init"
      pattern: "rehydrateReplayable"
---

<objective>
Wire `rehydrateReplayable` into the server boot sequence (after `sessions.loadSessions()`, before `transcript.init(...)`), bump `package.json` to v1.31.15, run the full Vitest + Playwright suites as the AC 3/6/7 regression guard, and verify the headline user outcome (AC 1) via a manual smoke test from an EXTERNAL terminal on a throwaway :4099 instance per D-05.

Purpose: Deliver the live, end-to-end behaviour — a plain Shell tab survives a restart — and prove no regression to agent sessions or the UI. The manual smoke is the real proof (D-05); the meta-work footgun (iterating on lifecycle inside the host clideck) is avoided by using an external terminal + isolated data dir.

Output: server.js wire-up, version bump, green suites, and a confirmed AC 1/AC 4/AC 5 manual smoke.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/2026-06-04-replayable-shell-sessions/SPEC.md
@.planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md

<interfaces>
<!-- server.js boot sequence — exact insertion point. -->
server.js (~L58-64):
  const plugins = require('./plugin-loader');
  ensurePtyHelper();
  sessions.loadSessions();
  // <-- INSERT rehydrateReplayable HERE (after loadSessions, before transcript.init)
  transcript.init(sessions.broadcast, new Set(sessions.getResumable().map(s => s.id)), (...args) => plugins.notifyTranscript(...args));

require('./handlers').getConfig() is available here (handlers module already loaded) and supplies cfg.commands.
Note: transcript's id set is built from getResumable() (NOT replay entries) — replay shells have no transcript/token, which is correct.
</interfaces>

<reference>
git show 28d5683 -- server.js  → the exact wire-up line + comment (adapt verbatim; the candidate's position is correct per D-01 carry-over).
memory/feedback_clideck-meta-work.md  → do lifecycle/restart work from an EXTERNAL terminal, not inside host clideck.
memory/feedback_verify-clideck-ui-altport-playwright.md  → throwaway :4099 + isolated CLIDECK_DATA_DIR pattern; taskkill when done.
memory/feedback_phase-work-on-feat-branches.md  → ship on feat branch; gh is ltek-dev1 (may lack rights on tekstaker/clideck) — surface PR URL if gh pr create fails.
</reference>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wire rehydrateReplayable into server boot + bump version</name>
  <read_first>
    - server.js (boot sequence ~L56-66, the loadSessions → transcript.init lines)
    - git show 28d5683 -- server.js  (the exact insertion + comment)
    - package.json (version field L3, currently 1.31.14)
    - .planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md (code touchpoint: wire-up after loadSessions before transcript.init; version → 1.31.15)
  </read_first>
  <action>
    In server.js, immediately after `sessions.loadSessions();` and before the `transcript.init(...)` call, add `sessions.rehydrateReplayable(require('./handlers').getConfig());` with a comment explaining it must run before transcript.init so rehydrated live sessions exist when the transcript builds its resumable-id set, and that handlers.getConfig() is safe here because handlers is already required. Do NOT reorder transcript.init / telemetry.init / opencode-bridge.init.
    In package.json, bump version from 1.31.14 to 1.31.15 (the candidate's 1.31.10→1.31.12 is stale — ignore it).
  </action>
  <verify>
    <automated>node -e "const v=require('./package.json').version; if(v!=='1.31.15') process.exit(1); const s=require('fs').readFileSync('./server.js','utf8'); if(!/rehydrateReplayable/.test(s)) process.exit(2); const before=s.indexOf('loadSessions()'); const mid=s.indexOf('rehydrateReplayable'); const after=s.indexOf('transcript.init'); if(!(before<mid && mid<after)) process.exit(3); console.log('ok')"</automated>
  </verify>
  <acceptance_criteria>
    - server.js calls sessions.rehydrateReplayable(...) AFTER loadSessions() and BEFORE transcript.init (ordering asserted by the verify script)
    - getConfig is sourced from require('./handlers').getConfig()
    - package.json version === "1.31.15"
    - The verify node script prints `ok` and exits 0
  </acceptance_criteria>
  <done>Boot sequence rehydrates replay shells before transcript.init; version is 1.31.15.</done>
</task>

<task type="auto">
  <name>Task 2: Full-suite regression guard (Vitest + Playwright)</name>
  <read_first>
    - package.json (test scripts — confirm the vitest + playwright invocations)
    - .planning/2026-06-04-replayable-shell-sessions/SPEC.md (AC 3, AC 6, AC 7)
  </read_first>
  <action>
    Run the full Vitest unit suite and confirm zero failures (AC 6) and that the existing resumable-handlers tests are unchanged-and-green (AC 3 — no agent-session regression). Then run the Playwright e2e suite and confirm it passes unchanged (AC 7 — no UI behaviour change expected). If Playwright requires a running server, follow the project's standard e2e harness; if the harness needs an isolated port/data dir, reuse the throwaway pattern. Capture pass/fail counts in the SUMMARY. If any suite fails, STOP and report — do not proceed to the smoke checkpoint with a red suite.
  </action>
  <verify>
    <automated>npx vitest run 2>&1 | grep -v '^#' | grep -qiE 'Test Files.*passed|[0-9]+ passed' </automated>
  </verify>
  <acceptance_criteria>
    - `npx vitest run` exits 0 with the full suite green (baseline + 7 new replayable tests)
    - No test in the existing resumable-handlers suite regressed (AC 3)
    - Playwright e2e suite passes unchanged (AC 7); pass/fail counts recorded in SUMMARY
  </acceptance_criteria>
  <done>Both suites green; counts captured; no regression.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    A replayable persistence track: plain Shell tabs are now saved to sessions.json on the 30s autosave (tagged replayable:true) and rehydrated as fresh PTYs in their saved cwd on server boot, with cwd→$HOME fallback and a 50-spawn cap. Wired into server boot before transcript.init. Version bumped to 1.31.15. All automated suites pass.
  </what-built>
  <how-to-verify>
    Run this from an EXTERNAL terminal — NOT inside the host clideck session (lifecycle/restart work inside the host is a recursive footgun; see memory/feedback_clideck-meta-work.md). Use a throwaway instance on an isolated port + data dir (memory/feedback_verify-clideck-ui-altport-playwright.md):

    AC 1 — headline restart survival:
    1. From an external terminal: set an isolated CLIDECK_DATA_DIR (a fresh temp dir) and start clideck on port 4099 (e.g. `PORT=4099 CLIDECK_DATA_DIR=/tmp/clideck-smoke-14 node server.js`).
    2. Open http://localhost:4099, open a plain Shell tab, run `cd /home/clideck/projects` (or any existing dir on the host) and confirm the prompt is there.
    3. Wait 35 seconds for the autosave tick (watch for the `sessions.saved` broadcast / log line).
    4. Confirm the entry landed: `jq '[.[] | select(.replayable == true)] | length' /tmp/clideck-smoke-14/sessions.json` returns ≥1 (AC 2).
    5. Stop the server (Ctrl-C / taskkill the :4099 process), then restart it with the same PORT + CLIDECK_DATA_DIR.
    6. Reload http://localhost:4099 — the Shell tab is back; run `pwd` and confirm it reports the directory from step 2 (AC 1).

    AC 5 — missing-cwd fallback:
    7. Stop the server. Edit /tmp/clideck-smoke-14/sessions.json: change the replayable entry's cwd to a path that does not exist (e.g. /tmp/gone-1234). Restart.
    8. Confirm the tab still rehydrates (no crash), the server logs a WARN about the missing cwd, and `pwd` in the rehydrated tab reports $HOME.

    AC 4 — pre-fix file upgrade:
    9. Stop the server. Replace sessions.json with a pre-fix-shape file (a flat array with NO `replayable` key on any entry — e.g. an old agent-only sessions.json). Restart.
    10. Confirm the server loads cleanly (logs "Loaded N resumable ... session(s)"), no entries are lost, and no replay shell is spuriously spawned from the pre-fix entries.

    11. When done, taskkill the :4099 process and remove /tmp/clideck-smoke-14.
  </how-to-verify>
  <resume-signal>Type "approved" (AC 1, AC 4, AC 5 confirmed) or describe what failed.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| sessions.json on disk → boot-time PTY spawns | Same boundary as Plan 02; this plan exercises it live and verifies the mitigations end-to-end |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-cwd | Tampering | live rehydrate cwd handling | mitigate | Verified end-to-end by smoke step 7-8 (tampered cwd → $HOME + WARN), the live counterpart of Plan 02 Test 5 (AC 5). |
| T-14-DoS | Denial of Service | boot spawn loop | mitigate | 50-cap (Plan 02) is in the live boot path now; not separately re-smoked (Test 7 covers it) but in force at runtime. |
| T-14-info | Information disclosure | persisted shell metadata | accept | Carried forward from SPEC; no new fields beyond Plan 02. |
| T-14-eop | Elevation of privilege | rehydrated shell env | accept | Same createProgrammatic spawn API as a user tab; no privilege delta. |
</threat_model>

<verification>
- server.js: rehydrateReplayable wired after loadSessions, before transcript.init (ordering asserted).
- package.json: 1.31.15.
- Full Vitest suite green (AC 6); resumable-handlers unchanged (AC 3); Playwright green (AC 7).
- Manual smoke (external terminal, :4099, isolated data dir): AC 1 (restart survival + correct pwd), AC 2 (jq count ≥1), AC 4 (pre-fix load), AC 5 (missing-cwd → $HOME + WARN).
- AC 8: commit authored as Samuel Harding <dev1@lancetek.com> on a fresh feat branch (not by merging 28d5683).
</verification>

<success_criteria>
- A plain Shell tab survives a server restart and reloads with the correct pwd (AC 1 — the headline outcome).
- sessions.json carries the replayable entry (AC 2); pre-fix files load cleanly (AC 4); tampered cwd falls back to $HOME (AC 5).
- Agent sessions and both test suites are unaffected (AC 3, AC 6, AC 7).
- Ships on a fresh feat/replayable-shell-sessions-v2 branch under the correct GitHub-fork persona (AC 8); PR URL surfaced to Lance if gh pr create lacks rights.
- Maps to SPEC AC 1, 2, 3, 4, 5, 6, 7, 8.
</success_criteria>

<output>
Create `.planning/2026-06-04-replayable-shell-sessions/14-03-SUMMARY.md` when done.
</output>
