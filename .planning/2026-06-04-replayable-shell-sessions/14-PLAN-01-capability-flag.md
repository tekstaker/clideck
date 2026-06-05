---
phase: 14-replayable-shell-sessions
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - config.js
  - agent-presets.json
autonomous: true
requirements: []   # no REQUIREMENTS.md — traces to SPEC AC 4 (preset shape) + D-01
user_setup: []

must_haves:
  truths:
    - "The shell preset declares an explicit canReplay:true capability (not inferred from !canResume)"
    - "Every loaded cmd carries a defaulted canReplay boolean, mirroring canResume's plumbing"
  artifacts:
    - path: "config.js"
      provides: "canReplay default on built-in shell cmd + backfill + preset-derived command"
      contains: "canReplay"
    - path: "agent-presets.json"
      provides: "canReplay:true on the shell preset entry"
      contains: "canReplay"
  key_links:
    - from: "config.js DEFAULTS shell command"
      to: "cmd.canReplay consumer in saveSessions (Plan 02)"
      via: "capability flag declared on preset, defaulted onto each cmd"
      pattern: "canReplay"
---

<objective>
Add an explicit `canReplay` boolean preset capability — parallel to `canResume` — and plumb it through `config.js` exactly where `canResume` is declared, defaulted, and preset-derived. Set `canReplay: true` on the built-in Shell preset only.

Purpose: D-01 mandates Replace (not the candidate's `else`-fallthrough). Replay must be an explicit, opt-in capability so only presets declaring `canReplay: true` participate in the replayable persistence track. This plan lays the capability declaration; Plan 02 consumes it in `saveSessions`.

Output: `config.js` and `agent-presets.json` carrying `canReplay`. No partition logic yet, no behaviour change yet (nothing reads `canReplay` until Plan 02).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/2026-06-04-replayable-shell-sessions/SPEC.md
@.planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md

<interfaces>
<!-- From config.js — the canResume plumbing being mirrored. Use these exact sites. -->

DEFAULTS.commands[0] (built-in Shell, config.js ~L78-81):
  { id: '1', label: 'Shell', icon: 'terminal', command: defaultShell, enabled: true,
    defaultPath: '', isAgent: false, canResume: false, resumeCommand: null, sessionIdPattern: null }

migrate() backfill loop (config.js ~L165):
  if (cmd.canResume === undefined)        cmd.canResume = preset?.canResume ?? false;

migrate() auto-add preset-derived command (config.js ~L189-195):
  cfg.commands.push({ id, presetId, label, icon, command, enabled, defaultPath,
    isAgent: preset.isAgent, canResume: preset.canResume,
    resumeCommand: preset.resumeCommand, sessionIdPattern: preset.sessionIdPattern,
    outputMarker: preset.outputMarker || null });

agent-presets.json shell entry (~L107-117): presetId "shell", canResume false, resumeCommand null.
Resumable agent presets (claude-code, codex, gemini-cli, opencode, clideck-agent) have canResume:true and MUST NOT get canReplay:true — they use the resume track.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Declare canReplay:true on the Shell preset (both definition sites)</name>
  <read_first>
    - config.js (DEFAULTS.commands shell entry ~L78-81; PRESETS load ~L108)
    - agent-presets.json (shell entry ~L107-117 and the five canResume:true agent entries)
    - .planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md (D-01 propagation bullet)
    - git show 28d5683 -- agent-presets.json  (reference: candidate did NOT touch presets — we intentionally do, that's the Replace difference)
  </read_first>
  <action>
    In agent-presets.json, add `"canReplay": true` to the shell preset entry (presetId "shell", the one with canResume:false). Do NOT add canReplay to any agent preset (claude-code, codex, gemini-cli, opencode, clideck-agent) — they stay on the resume track; leaving canReplay undefined for them is correct (defaults to false in Task 2).
    In config.js DEFAULTS.commands[0] (the built-in Shell command at ~L80), add `canReplay: true` alongside the existing `canResume: false` field so a fresh config (no config.json on disk) also gets the capability.
  </action>
  <verify>
    <automated>node -e "const p=require('./agent-presets.json'); const s=p.find(x=>x.presetId==='shell'); if(s.canReplay!==true) process.exit(1); const agents=p.filter(x=>x.canResume===true); if(agents.some(a=>a.canReplay===true)) process.exit(2); console.log('ok')"</automated>
  </verify>
  <acceptance_criteria>
    - agent-presets.json shell entry has `canReplay: true`
    - No canResume:true agent preset carries canReplay:true
    - config.js DEFAULTS built-in Shell command has `canReplay: true`
    - The verify node one-liner prints `ok` and exits 0
  </acceptance_criteria>
  <done>Shell preset and DEFAULTS shell command both declare canReplay:true; agent presets untouched.</done>
</task>

<task type="auto">
  <name>Task 2: Backfill canReplay onto every cmd in config.js migrate()</name>
  <read_first>
    - config.js (migrate() backfill loop ~L149-184, specifically the canResume default at ~L165; the auto-add preset-derived push at ~L186-197 / canResume at ~L192)
    - .planning/2026-06-04-replayable-shell-sessions/14-CONTEXT.md (D-01: "backfill it in config.js exactly where canResume is defaulted (L165) and the preset-derived command (L192)")
  </read_first>
  <action>
    In config.js migrate(): immediately after the `if (cmd.canResume === undefined) cmd.canResume = preset?.canResume ?? false;` line (~L165), add the mirror line `if (cmd.canReplay === undefined) cmd.canReplay = preset?.canReplay ?? false;` so any already-saved config.json gets canReplay defaulted from its preset on load.
    In the auto-add preset-derived command push (~L189-195), add `canReplay: preset.canReplay ?? false,` to the pushed object alongside `canResume: preset.canResume,` so a newly auto-added shell preset carries the flag.
    Keep canReplay a capability verb; do NOT introduce any on-disk state noun here (the `replayable` row marker is Plan 02's concern).
  </action>
  <verify>
    <automated>npx vitest run tests/resumable-handlers.test.js && node -e "require('./config.js'); console.log('config loads')"</automated>
  </verify>
  <acceptance_criteria>
    - config.js defaults canReplay from preset at the same site canResume is defaulted (cmd.canReplay === undefined branch present)
    - config.js auto-add push includes canReplay
    - `node -e "require('./config.js')"` loads without throwing
    - Existing resumable-handlers tests still pass (no regression from the config touch)
  </acceptance_criteria>
  <done>Every cmd produced by config.load()/migrate() carries a boolean canReplay; shell cmds get true, all others false.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| config.json on disk → loaded cmd objects | A user-edited or migrated config.json crosses into the cmd capability set |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-EoP | Elevation | canReplay on a non-shell preset | accept | Only the built-in shell preset declares canReplay:true; agent presets are left undefined→false. No UI surfaces a toggle (deferred). Capability is opt-in by design (D-01), so no preset silently gains replay. |

Note: the cwd-tamper and spawn-storm threats are mitigated in Plan 02 (rehydrate), not here — this plan only declares the capability.
</threat_model>

<verification>
- agent-presets.json shell entry: canReplay:true; agent presets: no canReplay.
- config.js: canReplay defaulted at the canResume default site and the preset-derived push.
- `npx vitest run tests/resumable-handlers.test.js` stays green (Plan 01 must not regress AC 3).
</verification>

<success_criteria>
- canReplay is an explicit, declared preset capability on the shell preset only.
- config.load() backfills canReplay onto every cmd (true for shell, false otherwise).
- No partition or persistence behaviour changes yet (deferred to Plan 02).
- Maps to SPEC AC 4 (clean schema additive change) and D-01 (explicit capability, not else-fallthrough).
</success_criteria>

<output>
Create `.planning/2026-06-04-replayable-shell-sessions/14-01-SUMMARY.md` when done.
</output>
