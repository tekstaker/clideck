---
phase: 14-replayable-shell-sessions
plan: 02
type: tdd
wave: 2
depends_on: ["14-01"]
files_modified:
  - sessions.js
  - tests/resumable-handlers.test.js
autonomous: true
requirements: []   # no REQUIREMENTS.md — traces to SPEC AC 2, 4, 5, 6 + D-01/D-02/D-03/D-04
user_setup: []

must_haves:
  truths:
    - "saveSessions persists canReplay shells into the same sessions.json array, tagged replayable:true"
    - "loadSessions partitions on the replayable discriminator; pre-fix files (no key) load all-resumable"
    - "rehydrateReplayable spawns each replay entry as a fresh PTY in its saved cwd, falls back to $HOME on missing cwd, skips unknown commandId, drains the array, and caps at 50 with a WARN"
  artifacts:
    - path: "sessions.js"
      provides: "replayable[] array + test accessors, partitioned saveSessions/loadSessions, rehydrateReplayable with cap"
      contains: "rehydrateReplayable"
    - path: "tests/resumable-handlers.test.js"
      provides: "7 new replayable tests (6 candidate-derived + 1 cap)"
      contains: "rehydrateReplayable"
  key_links:
    - from: "saveSessions partition"
      to: "cmd.canReplay (from Plan 01)"
      via: "explicit capability branch, NOT !canResume else-fallthrough"
      pattern: "canReplay"
    - from: "loadSessions"
      to: "entry.replayable discriminator"
      via: "partition-on-read with default-to-resumable bucket"
      pattern: "replayable"
    - from: "rehydrateReplayable"
      to: "createProgrammatic"
      via: "same spawn API as a user-initiated tab"
      pattern: "createProgrammatic"
---

<objective>
Add the replayable persistence track to sessions.js: a `replayable[]` module array with test accessors, a `saveSessions` that partitions BOTH tracks on the explicit `cmd.canReplay` / `cmd.canResume` capability flags into one flat sessions.json array (replay entries tagged `replayable: true`), a `loadSessions` that partitions on the `replayable` discriminator (pre-fix files load all-resumable), and a `rehydrateReplayable(cfg)` that spawns each replay entry as a fresh PTY in its saved cwd with cwd→$HOME fallback, unknown-commandId skip, drain-after-spawn, and a 50-entry cap.

Purpose: This is the heart of the feature (SPEC AC 2, 4, 5, 6). TDD-first per project default and D-04 — write the 7 failing tests, then implement to green.

Output: sessions.js with the replayable track; tests/resumable-handlers.test.js with 7 new passing tests; resume() body and existing tests byte-unchanged (AC 3).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/2026-06-04-replayable-shell-sessions/SPEC.md
@.planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md

<interfaces>
<!-- Current sessions.js shapes to mirror/rewrite. createProgrammatic is reused verbatim. -->

createProgrammatic(opts, cfg) → { error } | spawns into sessions Map  (sessions.js ~L253):
  opts: { commandId | presetId, cwd, themeId, projectId, name, roleName?, ephemeral? }
  resolveValidDir already clamps cwd inside; but rehydrate must still existsSync-gate per D-02/AC5.

resumable[] + __setResumableForTest/__getResumableForTest  (sessions.js ~L24, ~L632-645):
  Mirror EXACTLY for replayable[] + __setReplayableForTest/__getReplayableForTest.

Current saveSessions (sessions.js ~L676-710): single-track filter
  `if (!cmd?.canResume || !cmd.resumeCommand) return false;` → REWRITE to two-bucket partition.
Current loadSessions (sessions.js ~L712-718): `resumable = JSON.parse(...)` → REWRITE to partition.
module.exports (sessions.js ~L747-753): add rehydrateReplayable + the two replayable accessors.

<!-- Test harness already present in tests/resumable-handlers.test.js (DO NOT redefine): -->
  freshSessionsModule(), TEST_DATA_DIR, SAMPLE_ENTRY, captureClient(), beforeEach/afterEach with CLIDECK_DATA_DIR.
</interfaces>

<reference>
Candidate shapes to ADAPT (reference only — do NOT copy the else-fallthrough partition logic):
  git show 28d5683 -- sessions.js   → replayable[] array, accessors, rehydrateReplayable
    (cwd existsSync→$HOME fallback, unknown-commandId skip+warn, drain replayable=[], spawned count log)
  git show 28d5683 -- tests/resumable-handlers.test.js  → the 6 test bodies, SHELL_CFG, REPLAYABLE_ENTRY fixtures
CRITICAL DIVERGENCE from candidate: candidate's saveSessions uses `if (cmd.canResume && cmd.resumeCommand) {...} else {...replayable...}`.
  REPLACE that else with an EXPLICIT `else if (cmd.canReplay) { ...replayable... }` (D-01). A cmd that is
  neither resumable nor canReplay must be persisted to NEITHER track (skip it) — not silently replayed.
</reference>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — write the 7 replayable tests against the canReplay design</name>
  <read_first>
    - tests/resumable-handlers.test.js (existing harness L1-60: freshSessionsModule, SAMPLE_ENTRY ~L62, TEST_DATA_DIR, CLIDECK_DATA_DIR)
    - git show 28d5683 -- tests/resumable-handlers.test.js  (the 6 candidate tests + SHELL_CFG + REPLAYABLE_ENTRY fixtures — adapt, do not blind-copy)
    - .planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md (D-03 cap, D-04 test list)
    - .planning/2026-06-04-replayable-shell-sessions/SPEC.md (AC 2,4,5,6)
  </read_first>
  <behavior>
    - Test 1 (save round-trip): a replayable shell in __setReplayableForTest + a resumable in __setResumableForTest, after shutdown(SHELL_CFG), sessions.json on disk has the resumable WITHOUT a replayable key and the shell WITH replayable:true and no sessionToken.
    - Test 2 (load partition): a hand-written sessions.json mixing SAMPLE_ENTRY and two replayable:true entries → loadSessions puts ids in the correct buckets via __getResumableForTest / __getReplayableForTest.
    - Test 3 (pre-fix upgrade, AC 4): a sessions.json with NO replayable key on any entry → loadSessions lands ALL entries in resumable, replayable is empty.
    - Test 4 (rehydrate happy path): one replayable with cwd=TEST_DATA_DIR → rehydrateReplayable(SHELL_CFG) returns 1, drains replayable to [], cleanup via shutdown.
    - Test 5 (cwd fallback, AC 5 / T-14-cwd): one replayable with a nonexistent cwd → still spawns (returns 1) in $HOME, not the missing path; assert process.env.HOME/USERPROFILE is truthy.
    - Test 6 (unknown commandId): one replayable with commandId 'no-such-command' → returns 0, array still drained to [].
    - Test 7 (NEW, cap D-03): __setReplayableForTest with 60 valid entries (cwd=TEST_DATA_DIR) → rehydrateReplayable spawns at most 50, returns ≤50, and a console.warn fired naming the dropped count (spy on console.warn). Clean up all spawned PTYs via shutdown.
    SHELL_CFG must include a shell cmd with canResume:false AND canReplay:true (mirrors Plan 01's cmd shape) so saveSessions's explicit canReplay branch fires.
  </behavior>
  <action>
    Append a `// --- Phase 14: replayable persistence track ---` block to tests/resumable-handlers.test.js. Define SHELL_CFG (shell cmd canResume:false canReplay:true + a claude cmd canResume:true) and REPLAYABLE_ENTRY fixtures adapted from the candidate. Add the 7 tests above. Use existing freshSessionsModule/TEST_DATA_DIR/SAMPLE_ENTRY — do not redefine the harness. For Test 7 use vi.spyOn(console,'warn') and restore in finally. Do NOT touch any existing describe block (AC 3). Run the suite and confirm the 7 new tests FAIL (rehydrateReplayable / accessors not yet implemented).
  </action>
  <verify>
    <automated>npx vitest run tests/resumable-handlers.test.js 2>&1 | grep -v '^#' | grep -qE 'rehydrateReplayable|replayable' </automated>
  </verify>
  <acceptance_criteria>
    - tests/resumable-handlers.test.js contains ≥7 new tests referencing rehydrateReplayable / __getReplayableForTest
    - SHELL_CFG shell cmd carries canReplay:true (drives the explicit partition, not !canResume)
    - The 7 new tests FAIL at this step (RED) because the implementation is absent
    - No existing describe block was modified
  </acceptance_criteria>
  <done>7 new failing tests committed as the RED contract; existing tests untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement replayable[] + partitioned save/load in sessions.js</name>
  <read_first>
    - sessions.js (replayable-adjacent: resumable decl ~L24, accessors ~L632-645, saveSessions ~L676-710, loadSessions ~L712-718, module.exports ~L747-753)
    - git show 28d5683 -- sessions.js  (replayable[] array + accessors + two-bucket save + partition load — ADAPT, replace else with explicit canReplay branch)
    - .planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md (D-01 explicit branch, D-02 Shape-1 discriminator)
  </read_first>
  <action>
    Add `let replayable = [];` beside resumable with a comment framing replay-vs-resume (per &lt;specifics&gt;: replay = fresh PTY in saved cwd, no token, no history). Add __setReplayableForTest / __getReplayableForTest mirroring the resumable accessors (test-only guard included).
    Rewrite saveSessions to a two-bucket loop over the live sessions Map: skip ephemeral; look up cmd; `if (cmd.canResume && cmd.resumeCommand)` → resumable bucket (keep the {{sessionId}}-needs-token skip + skippedNoToken warn exactly as today); `else if (cmd.canReplay)` → replayable bucket, pushing the metadata object WITHOUT sessionToken and WITH `replayable: true`; otherwise (neither) → skip entirely (no silent replay — D-01). Merge each bucket with still-pending entries from its module array (resumable / replayable) by id, then write `[...resumableArr, ...replayableArr]` to SAVED_PATH as one flat array.
    Rewrite loadSessions: parse the array, `resumable = all.filter(e => !e.replayable)` and `replayable = all.filter(e => e.replayable)`; log both counts; on catch reset both to []. Add replayable accessors + (Task 3's) rehydrateReplayable to module.exports.
    Do NOT touch resume() (AC 3).
  </action>
  <verify>
    <automated>npx vitest run tests/resumable-handlers.test.js -t "saveSessions persists replayable" 2>&1 | grep -v '^#' | grep -qiE 'pass|✓'</automated>
  </verify>
  <acceptance_criteria>
    - sessions.js contains a canReplay partition: an explicit `else if (cmd.canReplay)` (or equivalent named branch) in saveSessions, NOT an else-fallthrough on !canResume
    - A cmd with neither canResume nor canReplay is persisted to NEITHER bucket
    - loadSessions partitions on the `replayable` discriminator; pre-fix files (no key) → all resumable
    - replayable[] + __set/__getReplayableForTest exist and are exported
    - resume() body byte-unchanged (git diff shows no change to the resume function)
    - Tests 1, 2, 3 pass
  </acceptance_criteria>
  <done>save/load partition tests green; resume() untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GREEN — implement rehydrateReplayable with cwd fallback, skip, drain, and 50-cap</name>
  <read_first>
    - sessions.js (createProgrammatic ~L253 signature/return; shutdown ~L739; module.exports)
    - git show 28d5683 -- sessions.js  (rehydrateReplayable reference: existsSync→$HOME, unknown-id skip+warn, drain, spawned log)
    - .planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md (D-03 cap = 50, named constant ok)
    - .planning/2026-06-04-replayable-shell-sessions/SPEC.md (threat model: cwd-tamper mitigate, DoS spawn-storm mitigate)
  </read_first>
  <action>
    Add `const MAX_REPLAY_REHYDRATE = 50;` (named constant per D-03) near the top of sessions.js. Implement `rehydrateReplayable(cfg)`: guard on cfg.commands array; resolve home from process.env.HOME || process.env.USERPROFILE. If replayable.length > MAX_REPLAY_REHYDRATE, emit a single console.warn naming the dropped count (replayable.length - 50) and process only `replayable.slice(0, MAX_REPLAY_REHYDRATE)`. For each entry: find cmd by entry.commandId; if absent, console.warn skip and continue (do not spawn). Validate `entry.cwd && !existsSync(entry.cwd)` → console.warn fallback, set cwd=home (T-14-cwd mitigation, AC 5). Call createProgrammatic({commandId, cwd, themeId, projectId, name}, cfg); on result.error, warn and continue; else increment spawned. After the loop, log spawned/total and DRAIN `replayable = []` (load-bearing per &lt;specifics&gt; — next saveSessions re-derives from the live Map). Return spawned. Export rehydrateReplayable.
  </action>
  <verify>
    <automated>npx vitest run tests/resumable-handlers.test.js 2>&1 | grep -v '^#' | grep -qiE 'Test Files.*pass|[0-9]+ passed'</automated>
  </verify>
  <acceptance_criteria>
    - rehydrateReplayable spawns via createProgrammatic, falls back to $HOME on missing cwd with a WARN (AC 5)
    - Unknown commandId is skipped (returns fewer spawns), array still drained to []
    - Caps at MAX_REPLAY_REHYDRATE (50) and console.warn's the dropped count when given >50 (D-03 / DoS mitigation)
    - replayable drained to [] after the call
    - `npx vitest run tests/resumable-handlers.test.js` exits 0 with all 7 new replayable tests passing AND no existing test regressed (AC 3, AC 6)
  </acceptance_criteria>
  <done>All 7 replayable tests green; full resumable-handlers suite green; replayable array drains after rehydrate.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| sessions.json on disk → rehydrated PTY spawn | Persisted cwd/commandId/count cross into live PTY spawns at boot; the file is container-internal but could be corrupted or tampered |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-cwd | Tampering | rehydrateReplayable cwd handling | mitigate | existsSync(entry.cwd) gate with $HOME fallback + WARN (Task 3); covered by Test 5 (AC 5). |
| T-14-DoS | Denial of Service | rehydrateReplayable spawn loop | mitigate | MAX_REPLAY_REHYDRATE=50 cap with single WARN naming dropped count (Task 3, D-03); covered by Test 7. |
| T-14-info | Information disclosure | persisting cwd/name/commandId for shells | accept | Same fields the resumable shape already persists; no credential class added; single-user container-internal. |
| T-14-eop | Elevation of privilege | spawned shell inherits server env | accept | Pre-existing createProgrammatic behaviour; rehydrate uses the same spawn API as a user-initiated tab; no privilege delta. |
</threat_model>

<verification>
- `npx vitest run tests/resumable-handlers.test.js` exits 0; ≥7 new replayable tests pass; baseline tests unchanged (AC 3, AC 6).
- saveSessions partitions on explicit cmd.canReplay (no else-fallthrough); neither-track cmds skipped.
- loadSessions pre-fix file → all-resumable (AC 4).
- rehydrateReplayable: cwd→$HOME fallback (AC 5), unknown-id skip, 50-cap WARN (D-03), drain.
</verification>

<success_criteria>
- Replayable track is fully implemented and partitioned off the explicit canReplay capability (D-01).
- Shape-1 discriminator (replayable:true) in one flat sessions.json; zero-downtime upgrade proven (D-02, AC 4).
- 50-cap with WARN (D-03); cwd-tamper $HOME fallback (AC 5).
- resume() body byte-unchanged; full suite green (AC 3, AC 6).
- Maps to SPEC AC 2, 4, 5, 6.
</success_criteria>

<output>
Create `.planning/2026-06-04-replayable-shell-sessions/14-02-SUMMARY.md` when done.
</output>
