---
phase: 14-replayable-shell-sessions
plan: 01
subsystem: config / preset-schema
tags: [capability-flag, canReplay, config-migrate, presets]
provides: canReplay preset capability (declared on shell, backfilled onto every cmd)
requires: []
affects: [config.js, agent-presets.json]
key-files:
  modified:
    - config.js
    - agent-presets.json
decisions:
  - "canReplay is an explicit capability verb, parallel to canResume — never inferred from !canResume (D-01)"
metrics:
  completed: 2026-06-04
  commit: 77716e3
---

# Phase 14 Plan 01: Capability Flag Summary

Added an explicit `canReplay` boolean preset capability — parallel to `canResume` — declared on the Shell preset only and backfilled onto every `cmd` exactly where `canResume` is plumbed in `config.js`.

## What changed

- **agent-presets.json** — shell preset entry (`presetId: "shell"`, `canResume: false`) gains `"canReplay": true`. The five agent presets (claude-code, codex, gemini-cli, opencode, clideck-agent, all `canResume: true`) were left untouched — they stay on the token-driven resume track; `canReplay` is left undefined and defaults to `false`.
- **config.js DEFAULTS** — the built-in Shell command (`id: '1'`) gains `canReplay: true` so a fresh config (no config.json on disk) also carries the capability.
- **config.js migrate()** — backfilled `canReplay` from the preset at two sites mirroring `canResume`:
  - `if (cmd.canReplay === undefined) cmd.canReplay = preset?.canReplay ?? false;` (immediately after the `canResume` default).
  - `canReplay: preset.canReplay ?? false,` in the auto-add preset-derived command push.

## Verification

- `node -e "...shell.canReplay===true, no agent has canReplay==true..."` → `task1 ok`.
- `node -e "require('./config.js')"` → `config loads` (no throw).
- `npx vitest run tests/resumable-handlers.test.js` → 7 passed, exit 0 (no regression from the config touch).

## Deviations from plan

None — plan executed exactly as written.

## Self-Check: PASSED

- config.js, agent-presets.json modified and contain `canReplay`.
- Commit `77716e3` exists.
