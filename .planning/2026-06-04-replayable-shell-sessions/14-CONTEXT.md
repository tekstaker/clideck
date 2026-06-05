# Phase 14: replayable-shell-sessions - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Plain Shell sessions (`presetId: shell`, `canResume: false`) survive a server
restart. On boot, every persisted plain-shell entry is rehydrated as a fresh
PTY in its saved `cwd`, so a user who had three `bash` tabs open before a
`docker compose restart clideck-lance` comes back to the same three tabs in
the same directories. Agent sessions (Claude Code / Codex / Gemini / OpenCode,
`canResume: true`) keep using the existing **resumable** track unchanged —
token-driven `--resume`, no behaviour change. This phase adds a parallel
**replayable** track that shares `sessions.json` and the existing
save/load/autosave machinery.

Implementation surface: **`sessions.js`** (the partitioned save/load +
`rehydrateReplayable`), **`server.js`** (one wire-up call after
`loadSessions()`, before `transcript.init`), **`config.js`** (propagate the
new preset capability flag), the **shell preset definition** (`config.js:80`
built-in default and/or `agent-presets.json`), **`package.json`** (version
bump), and **`tests/resumable-handlers.test.js`** (new coverage). Plain-shell
scrollback/output history is explicitly NOT persisted — shells start fresh on
rehydrate.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**8 acceptance criteria are locked.** See
`.planning/2026-06-04-replayable-shell-sessions/SPEC.md` for full
requirements, boundaries, threat model, and acceptance criteria.

Downstream agents MUST read that SPEC.md before planning or implementing.
Requirements are not duplicated here.

**In scope (from SPEC.md):** Persist plain-shell sessions to `sessions.json`
on the 30 s autosave tick + graceful shutdown; rehydrate each on boot as a
fresh PTY in its saved `cwd` via `createProgrammatic`; validate `cwd`
(`existsSync`) with `$HOME` fallback; zero-downtime upgrade for pre-fix
`sessions.json` files; 6 new tests; `resume()` body and existing
resumable-handler tests unchanged.

**Out of scope (from SPEC.md):** Persisting plain-shell scrollback/output
history; DoS hardening beyond the optional spawn cap; a "this tab is a
rehydrated shell" UI affordance; schema migration beyond the discriminator
field.

### ⚠ SPEC update — route chosen is **Replace**, not merge-as-is

The SPEC's central "Decision needed" (§79: merge-as-is / modify-then-merge /
replace) is resolved in discuss-phase as **Replace (redesign from scratch)**.
The inherited candidate branch `feat/replayable-shell-sessions` (`28d5683`)
is **NOT merged** — it becomes a reference implementation only. See D-01
below for why, and what carries over from it. AC 8 ("author identity correct
on the merge commit") still applies: the new work ships under
`Samuel Harding <dev1@lancetek.com>` on a fresh feat branch.

</spec_lock>

<decisions>
## Implementation Decisions

### Route: Replace (redesign from scratch)

- **D-01: Redesign with an explicit `canReplay` preset capability flag —
  do NOT merge the candidate branch `28d5683`.** The candidate is clean,
  green (94 tests), and scope-correct, but it decides replayability by an
  **`else` fallthrough**: in `saveSessions`, any non-ephemeral session whose
  preset is *not* resumable (`!canResume || !resumeCommand`) is silently
  treated as replayable. That is implicit and over-broad — any future
  non-resumable preset (or a misconfigured one) would start getting
  persisted-and-respawned with no opt-in. The redesign makes replay an
  **explicit, opt-in preset capability** — a `canReplay` boolean on the
  preset schema, parallel to `canResume` — so only presets that declare
  `canReplay: true` (the shell preset) participate.
  - **Why this is more elegant:** `canResume` / `canReplay` read as a
    matched pair of capabilities; the persistence layer partitions on a
    declared capability rather than on the *absence* of another one. No
    behaviour is inferred from a negative.
  - **Field name:** `canReplay` preferred for symmetry with `canResume`.
    Final naming is the planner's call, but keep it a capability verb, not
    a state noun. (The on-disk discriminator is a separate name — see D-02.)
  - **Propagation:** mirror `canResume`'s plumbing — set `canReplay: true`
    on the shell preset (`config.js:80` built-in default, and the shell
    entry in `agent-presets.json` if one exists there), and backfill it in
    `config.js` exactly where `canResume` is defaulted (`config.js:165`
    `if (cmd.canResume === undefined) …` and the preset-derived command at
    `config.js:192`).
  - **Carries over from the candidate (reference, re-implement cleanly):**
    the `replayable[]` module array + test accessors; the
    `rehydrateReplayable(cfg)` shape (cwd validation, `$HOME` fallback,
    unknown-`commandId` skip, drain-after-spawn); the `server.js` wire-up
    position (after `loadSessions()`, before `transcript.init` — see
    `<code_context>`); and the 6 test cases. The candidate's git diff and
    commit message (`28d5683`) are the working reference.

### On-disk persistence shape

- **D-02: Keep Shape 1 — a `replayable: true` discriminator inside the
  existing `sessions.json` array.** One flat array on disk; replay entries
  carry `replayable: true`; everything else loads into the resumable bucket.
  Pre-fix `sessions.json` files (no `replayable` key anywhere) load with
  every entry in `resumable` — the zero-downtime upgrade (SPEC AC 4),
  proven by a dedicated pre-fix-file test. Rejected Shape 2 (separate
  `replayable.json`): file-level separation buys nothing here and costs a
  second write path, a second load path, and a changed AC-2 inspection
  command.
  - **Naming note:** the preset capability is `canReplay` (D-01); the
    persisted-entry discriminator stays `replayable: true`. Distinct on
    purpose — capability (on the preset/cmd) vs. on-disk row marker (on the
    persisted entry). AC 2's `jq '[.[] | select(.replayable == true)] | length'`
    inspection assumes this discriminator name — keep it `replayable`.

### Boot-time spawn-storm cap

- **D-03: Cap rehydrate at 50 entries with a WARN log.** In
  `rehydrateReplayable`, process at most the first 50 replayable entries
  (`replayable.slice(0, 50)` or equivalent); if more were present, emit a
  single `console.warn` naming the dropped count. Cheap one-line insurance
  against a corrupted/runaway `sessions.json` triggering hundreds of PTY
  spawns at boot (SPEC threat model: DoS — "mitigate (optional), reviewer's
  call"). Reviewer's call resolved = **add it**. The 50 figure is a sane
  default; planner may make it a named constant.

### Test surface

- **D-04: Re-implement the 6 candidate tests against the new `canReplay`
  design,** plus one for the cap:
  - `saveSessions` persists `canReplay` shells alongside resumables
    (round-trip).
  - `loadSessions` partitions resumable vs replayable on the `replayable`
    discriminator.
  - `loadSessions` of a pre-fix `sessions.json` (no `replayable` key) lands
    all entries in resumable (zero-downtime upgrade — AC 4).
  - `rehydrateReplayable` spawns each via `createProgrammatic` and drains
    the array.
  - `rehydrateReplayable` falls back to `$HOME` when the saved `cwd` no
    longer exists (AC 5 / threat T-00.02-01).
  - `rehydrateReplayable` skips entries whose `commandId` is no longer in
    config.
  - **New for D-03:** `rehydrateReplayable` caps at 50 and WARN-logs the
    overflow when given >50 entries.
  - `resume()` body and existing resumable-handler tests stay byte-unchanged
    (SPEC AC 3 — no regression).

### Verification

- **D-05: Manual smoke is the real proof, run from an EXTERNAL terminal —
  not inside the host clideck session.** Per
  `memory/feedback_clideck-meta-work.md` (lifecycle work is a recursive
  footgun) and the throwaway-:4099 pattern in
  `memory/feedback_verify-clideck-ui-altport-playwright.md`. The headline
  smoke (SPEC AC 1): open a plain Shell tab, `cd` somewhere, wait 35 s for
  the autosave tick, restart, reload, confirm the tab returns with the right
  `pwd`. Also exercise the missing-cwd fallback (AC 5) and a pre-fix
  `sessions.json` load (AC 4).

### Claude's Discretion

- Exact `canReplay` field name (capability verb; `canReplay` preferred).
- The cap constant value/name (50 is the default sketch).
- Whether `canReplay` surfaces in the Settings agent-editor UI
  (`settings.js` renders a `canResume` checkbox at L270). Lean **no** for
  this phase — the shell preset is built-in and not user-edited; surfacing
  a `canReplay` toggle is UI scope creep. Note in Deferred.
- Whether the rehydrate WARN/INFO logs harmonise with the new
  shutdown-feedback logging tone from Phase 13 (cosmetic).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements
- `.planning/2026-06-04-replayable-shell-sessions/SPEC.md` — Locked
  requirements, scope boundaries, threat model, and the 8 acceptance
  criteria. Read first. Note the SPEC update above: route = Replace, not
  merge-as-is.

### Reference implementation (do NOT merge — reference only)
- Candidate branch `feat/replayable-shell-sessions`, single commit
  `28d5683` ("feat(sessions): persist non-resumable shells via replayable
  track"). `git show 28d5683 -- sessions.js server.js package.json
  tests/resumable-handlers.test.js` is the working reference for the
  `replayable[]` array, `rehydrateReplayable` (cwd fallback, unknown-id
  skip, drain), the server.js wire-up position, and the 6 tests. The
  redesign reuses these shapes but drives partitioning off `canReplay`
  instead of the `else` fallthrough, and adds the D-03 cap. Branch is now
  5 behind main (predates Phases 9/10/11); its raw `git diff main..` shows
  spurious file deletions that are stale-base noise, not part of the change.

### Code touchpoints
- `sessions.js:676-710` (approx, on `main` at `81d0d63`) — current
  `saveSessions` resumable-only filter (`if (!cmd?.canResume ||
  !cmd.resumeCommand) return false`). **Rewritten** to partition both
  tracks on `cmd.canReplay` / `cmd.canResume`.
- `sessions.js:758-770` (approx) — current `loadSessions`. **Rewritten** to
  partition on the `replayable` discriminator.
- `sessions.js` `createProgrammatic` — the spawn API `rehydrateReplayable`
  reuses; same path as a plugin/user-initiated tab, no new spawn surface.
- `server.js` — add `sessions.rehydrateReplayable(require('./handlers').getConfig())`
  after `sessions.loadSessions()` and BEFORE `transcript.init(...)` so the
  rehydrated live sessions are visible to the transcript's resumable-id set.
- `config.js:80` — built-in shell command default (`canResume: false,
  resumeCommand: null`). Add `canReplay: true` here.
- `config.js:165` / `config.js:192` — where `canResume` is defaulted/derived
  from the preset. Mirror for `canReplay`.
- `agent-presets.json` — shell preset entry, if `canReplay` belongs there
  too (parallel to the resumable presets' `canResume`).

### Historical context (memory)
- `memory/feedback_clideck-meta-work.md` — don't iterate on lifecycle /
  restart work inside the host clideck session; use an external terminal.
- `memory/feedback_verify-clideck-ui-altport-playwright.md` — throwaway
  :4099 + isolated data dir verification pattern for D-05.
- `memory/feedback_phase-work-on-feat-branches.md` — phase ships on
  `feat/<slug>` with a PR to main; `gh` CLI is `ltek-dev1` (may lack
  collaborator rights on `tekstaker/clideck`) — surface the PR-create URL
  to Lance if `gh pr create` fails.
- `memory/reference_github-squash-merge-deletes-branches.md` — GitHub
  squash-merge auto-deletes the feat branch; verify merged work by file
  content, not branch presence.
- `memory/feedback_bump-version-on-code-changes.md` — bump `package.json`
  patch on the code-changing commit. Current `main` is v1.31.14 → this
  phase ships v1.31.15 (or higher).

### Source
- GitHub issue #9: https://github.com/tekstaker/clideck/issues/9 — the
  original diagnosis and the three-way decision framework.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createProgrammatic({commandId, cwd, themeId, projectId, name}, cfg)` in
  `sessions.js` — the existing PTY-spawn path used by plugin-initiated tabs.
  `rehydrateReplayable` reuses it verbatim; no new spawn surface, no
  privilege delta (SPEC threat model EoP = accept).
- The `resumable[]` module array + `__setResumableForTest` /
  `__getResumableForTest` accessors — the exact pattern to mirror for
  `replayable[]` + `__setReplayableForTest` / `__getReplayableForTest`.
- The 30 s autosave tick (`startAutoSave` / `autoSaveInterval`) and the
  graceful-shutdown `saveSessions(cfg)` call already persist `resumable`;
  partitioning both tracks into the same `data` array means replay entries
  ride the same machinery for free.

### Established Patterns
- **Capability flag → config backfill → consumer check.** `canResume` is
  declared on the preset, defaulted onto each `cmd` in `config.js`
  (`:165`, `:192`), then read in ~8 places in `sessions.js`
  (`:288, :411, :426, :442, :476, :683`) and the client
  (`app.js:1089`, `creator.js:142`, `terminals.js:407`,
  `settings.js`). `canReplay` follows the same declare→backfill→consume
  path, but the only consumer that matters for this phase is
  `saveSessions`'s partition — the client does NOT need to read `canReplay`
  (no UI affordance — SPEC out-of-scope).
- **Shape-1 zero-downtime upgrade.** Partition-on-read with a default
  bucket for the missing discriminator is the same trick used elsewhere
  for backwards-compatible config loads. The pre-fix-file test is the
  guard.

### Integration Points
- `transcript.init(sessions.broadcast, new Set(sessions.getResumable().map(s => s.id)), …)`
  in `server.js` — runs immediately after the wire-up point.
  `rehydrateReplayable` must complete BEFORE this so rehydrated sessions
  are in the live Map; but note the transcript's id set is built from
  `getResumable()`, NOT the replay entries — replay shells have no
  transcript/token, which is correct (no chat history to replay).
- `require('./handlers').getConfig()` is available at the wire-up point
  (handlers module already loaded), supplying `cfg.commands` for the
  `commandId` lookup during rehydrate.

</code_context>

<specifics>
## Specific Ideas

- The replay vs resume distinction is the heart of the design: **resume** =
  re-attach an agent CLI to its prior session via `--resume {{sessionId}}`
  (needs a captured token, has chat history); **replay** = spawn a brand-new
  PTY in the saved `cwd` (no token, no history, just "put the tab back").
  Keep this framing in code comments — it's what makes the two-track model
  legible to the next reader.
- The candidate's commit message (`28d5683`) is unusually thorough and
  explicitly documents the Shape-1-vs-Shape-2 choice and the rejected
  "flip canResume" option. Mine it for the new commit message rather than
  rewriting that rationale from scratch.
- `replayable = []` drain-after-rehydrate is load-bearing: once spawned,
  the live `sessions` Map is the single source of truth; the next
  `saveSessions` re-derives the replay persistence from the live Map. Don't
  leave stale entries in the array or they'd double on the next save.

</specifics>

<deferred>
## Deferred Ideas

- **`canReplay` toggle in the Settings agent-editor UI.** `settings.js`
  renders a `canResume` checkbox per command. A matching `canReplay`
  checkbox would let users mark custom non-agent presets as replayable.
  Deferred — the shell preset is built-in; no user-facing need yet, and it
  would be UI scope creep on a persistence phase.
- **"Rehydrated shell" UI affordance.** SPEC out-of-scope — rehydrated tabs
  look identical to user-initiated ones. A subtle badge/tooltip ("restored
  after restart") could come later if users get confused.
- **Persisting plain-shell scrollback / output history.** SPEC out-of-scope
  — shells start fresh. Real terminal-buffer replay is a much larger,
  separate phase (and overlaps the Phase-9 sizing / xterm serialize-addon
  territory).
- **Per-preset rate-limiting on rehydrate spawns** beyond the D-03 count
  cap. SPEC out-of-scope; the slice(0,50) cap is the agreed mitigation.

</deferred>

---

*Phase: 14-replayable-shell-sessions*
*Context gathered: 2026-06-04*
