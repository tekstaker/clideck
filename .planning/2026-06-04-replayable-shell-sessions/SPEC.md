# SPEC — Replayable plain-shell session persistence

**Status:** planned (not yet discussed/planned — seeded from GitHub issue #9 2026-06-04)
**Owner:** Lance Keay
**Date:** 2026-06-04

## What this delivers

Plain Shell sessions (`presetId: shell`, `canResume: false`) survive a server
restart: on boot, every saved plain-shell entry is rehydrated as a fresh PTY
in its previously-saved `cwd`, so a user who had three `bash` tabs open
before `docker compose restart clideck-lance` (or any other host restart)
comes back to those same three tabs in the same directories.

Today only **resumable** agent sessions (Claude Code, Codex, Gemini, OpenCode
— the presets with `canResume: true` + a `resumeCommand` template) survive
restart. Plain shells are silently dropped. After this phase: a parallel
**replayable** persistence track lands alongside the resumable one, sharing
`sessions.json` and the existing save/load machinery.

## Why

Reported by Lance 2026-06-03 in the overlay session (`clideck-docker-lance`):

> *"The terminal sessions are not remembered when the service is restarted.
> The Claude Code sessions seem to be remembered, but if I have some terminal
> sessions in there they all disappear and I have to remake them."*

The diagnosis (issue #9): deliberate filtering, not a missing-code bug.
`saveSessions(cfg)` in `sessions.js` (currently around L676–710 on
`main` at `2dfea7a`) only persists entries whose preset has
`canResume && resumeCommand`:

```js
const cmd = cfg.commands.find(c => c.id === s.commandId);
if (!cmd?.canResume || !cmd.resumeCommand) return false;
```

The shell preset in `agent-presets.json` is `canResume: false,
resumeCommand: null` — correct in the agent-CLI sense (there's no
`bash --resume`), so flipping the flag is wrong. The fix is a separate
**replayable** track that shares the persistence file but doesn't depend on
`resumeCommand`.

This is the upstream-fork half of cross-repo work. The overlay session
(`clideck-docker-lance`) filed issue #9 and pushed a candidate branch to
`tekstaker/clideck` rather than editing the working tree directly, to avoid
parallel-session races. This phase consumes that work — either merges, or
modifies, or replaces it — and the overlay session closes its originating
todo once `main` carries the fix.

## Inherited candidate work

A complete candidate fix already lives on the fork as branch
[`feat/replayable-shell-sessions`](https://github.com/tekstaker/clideck/tree/feat/replayable-shell-sessions),
single commit `28d5683`, authored by `Samuel Harding <dev1@lancetek.com>`
(this session's persona) from the sibling session. State as of
2026-06-04: 1 ahead, 1 behind `main`'s `2dfea7a`. Touches
`package.json` + `server.js` + `sessions.js` + `tests/resumable-handlers.test.js`.
`npm test` reportedly green on the branch (94 passing = 88 baseline + 6 new).

The plan stage of this phase will need to choose between three routes per
the issue's "Decision needed" section:

- **Merge-as-is** — rebase onto current `main`, `npm test`, manual smoke per
  the issue body, PR-merge. Smallest scope; trusts the sibling session's
  design.
- **Modify-then-merge** — adjust before merging. Candidate modifications named
  in the issue: switch to Shape 2 (separate `replayable.json` file) instead
  of Shape 1 (`replayable: true` discriminator in `sessions.json`); add a
  spawn-storm cap (e.g. `replayable.slice(0, 50)` with WARN log); tighten
  the cwd validation; rename the discriminator field.
- **Replace** — scrap the candidate branch, redesign from scratch.
  E.g. add a real `replay` field to the preset schema (parallel to `canResume`)
  rather than a sidecar field on the persisted entry. The candidate
  branch's tests would still be a useful reference for the new
  implementation's surface.

That three-way choice is the central gray area for `/gsd-discuss-phase 14`.

## Scope

**In scope**

- Persist plain-shell sessions to `sessions.json` alongside resumable agent
  sessions, on the existing 30-second autosave tick and on graceful
  shutdown.
- Rehydrate every persisted plain-shell entry on server boot as a fresh
  PTY in its saved `cwd`, via the existing `createProgrammatic` path. Same
  spawn API as a user-initiated tab; no privilege delta.
- Validate `cwd` on rehydrate (`existsSync`), fall back to `$HOME` if
  missing — protects against tampered-`sessions.json` landing a spawn in
  an attacker-prepared directory.
- Zero-downtime upgrade: pre-fix `sessions.json` files (no `replayable`
  field) load all entries as resumable, exactly as today.
- Test coverage: 6 new tests in `tests/resumable-handlers.test.js`
  covering save-roundtrip, load-partitioning (including the pre-fix
  shape), and rehydrate spawn behaviour (happy path, missing-cwd
  fallback, unknown-`commandId`).
- `resume()` body and existing resumable-handler tests stay unchanged —
  agent sessions continue to use `--resume + sessionToken` exactly as
  today. No regression.

**Out of scope**

- Persisting plain-shell **scrollback / output history**. Plain shells
  start fresh on rehydrate; no terminal buffer replay.
- A new preset field that flips replay behaviour per preset (would be
  the "replace" route's territory). If we go merge-as-is or
  modify-then-merge, `agent-presets.json` is byte-identical.
- DoS hardening beyond the optional `replayable.slice(0, 50)` cap. No
  rate-limiting on rehydrate spawns.
- Surfacing "this tab is a rehydrated shell" UI affordance. Tabs look
  identical to user-initiated ones after rehydrate.
- Migration of the existing `sessions.json` schema beyond adding the
  optional `replayable: true` field per entry.

## Acceptance criteria

1. **Plain Shell tab survives `docker compose restart`** — manual smoke
   from the issue body: open a plain Shell tab, `cd /home/clideck/projects`,
   wait 35 s, restart the container, reload — the Shell tab is back and
   `pwd` reports `/home/clideck/projects`.
2. **`sessions.json` carries the entry** — after the 35 s autosave tick,
   `docker exec clideck-lance bash -lc 'jq "[.[] | select(.replayable == true)] | length" /home/clideck/.clideck/sessions.json'` (or the equivalent
   inspection if the design lands as Shape 2 separate file) returns
   at least 1.
3. **Resumable agent sessions are unaffected** — Claude Code / Codex /
   Gemini / OpenCode sessions still rehydrate via `--resume + sessionToken`;
   no test in the existing `resumable-handlers` suite regresses.
4. **Pre-fix `sessions.json` loads cleanly** — a `sessions.json` file
   written by `main` at `2dfea7a` (no `replayable` key) loads with every
   entry in the resumable bucket; no entries are silently lost.
5. **Tampered cwd falls back to `$HOME`** — if `sessions.json` lists a
   plain-shell entry whose `cwd` no longer exists on disk, rehydrate
   spawns it in `$HOME` with a WARN log, not in the missing path.
6. **All Vitest suites pass** including the 6 new tests
   (`saveSessions partitions`, `loadSessions partitions resumable vs
   replayable`, `rehydrateReplayable spawns plain shells in their saved
   cwd` × 3 cases).
7. **All Playwright suites pass** — no UI behaviour change is expected.
8. **Author identity correct on the merge commit** —
   `Samuel Harding <dev1@lancetek.com>` (GitHub-fork persona); the
   candidate branch already has this.

## Threat model (inherited from issue)

| Threat | Disposition | Mitigation |
|---|---|---|
| Tampering — corrupted `cwd` in `sessions.json` | mitigate | `rehydrateReplayable` validates `existsSync(entry.cwd)`, falls back to `$HOME` on miss, logs WARN. |
| Information disclosure — `sessions.json` now persists `cwd`/`name`/`commandId` for plain shells | accept | Same fields the resumable shape already persists. No credential class added. Single-user, container-internal. |
| EoP — spawned shell inherits server env | accept | Pre-existing behaviour of `createProgrammatic`; rehydrate uses the same spawn API as a user-initiated tab. No privilege delta. |
| DoS — many replayable entries → spawn storm at boot | mitigate (optional) | One-line `replayable.slice(0, 50)` cap with WARN log. Reviewer's call during discuss-phase. |

## Cross-cutting constraints

- Bump `package.json` patch on the code-changing commit per the project
  version-bump rule. The candidate branch already bumps `1.31.10 → 1.31.12`;
  current `main` is `2dfea7a` at the post-#8 patch level — rebase will need
  to resolve the version conflict (likely `1.31.15` or higher).
- This phase pushes a PR to **GitHub origin** (`tekstaker/clideck`) — the
  user is the GitHub-bound owner of this work. **GitHub squash-merge will
  auto-delete the feat branch on merge** per `memory/reference_github-squash-merge-deletes-branches.md`; verify the merged work by file
  content, not by branch presence.
- The `gh` CLI in this environment is authenticated as `ltek-dev1`, who
  may not have collaborator rights on `tekstaker/clideck` — if `gh pr
  create` fails, surface the compare URL for Lance to open the PR himself
  per `memory/feedback_phase-work-on-feat-branches.md`.

## Source

- GitHub issue: https://github.com/tekstaker/clideck/issues/9
- Candidate branch: https://github.com/tekstaker/clideck/tree/feat/replayable-shell-sessions (`28d5683`)
- Compare view: https://github.com/tekstaker/clideck/compare/main...feat/replayable-shell-sessions
- Originating overlay-side todo (in `clideck-docker-lance`, NOT in this repo):
  `.planning/todos/pending/2026-06-03-clideck-plain-terminal-sessions-dont-persist.md`

This SPEC mirrors the issue body's design but is framed for clideck
readers (downstream agents work from this file, not the issue). It has
not yet been through `/gsd-discuss-phase` or `/gsd-plan-phase` — refine
before executing.
