# clideck fork — ROADMAP

Fork of `rustykuntz/clideck` maintained for Windows + dictation ergonomics.

## Active phase

- [2026-05-17-session-ux](2026-05-17-session-ux/SPEC.md) — Per-row Rename/Delete on Previous Sessions, graceful failed-resume → fresh session, bulk project import. Close-out fix folded in: sync "Select all" master checkbox with row state in the bulk-import modal. Work happening on `feat/session-ux` (branched off `fix/restart-button` to inherit planning context).

## Parked

- [2026-05-18-restart-architecture](2026-05-18-restart-architecture/SPEC.md) — Paused 2026-05-19. Wrapper-process restart shipped on `fix/restart-button` (v1.31.5 → v1.31.6), but the in-UI Restart still hangs the modal and kills active PTY sessions; debugging it live is too disruptive to ongoing work. Remaining deliverables (lozenge tooltip, lozenge relocation, restart-hang fix) deferred until the hang chase is safe to pick up — workaround in the meantime is `taskkill /F /PID <clideck-pid>` from an external terminal, then relaunch `clideck`. Full forensic notes in `memory/project_restart-button-broken.md`.

## Queued phases

- [2026-05-19-session-polish](2026-05-19-session-polish/SPEC.md) — Drag-to-reorder sessions within a project group, and fix the visual collision where the "unread" dot lights up alongside the "working" indicator.
- [2026-05-19-terminal-ux](2026-05-19-terminal-ux/SPEC.md) — Auto-copy on terminal selection (with toast), and Ctrl/Cmd+click to open URLs from terminal output in a new tab.
- [2026-05-19-session-pause](2026-05-19-session-pause/SPEC.md) — "Pause" action on active sessions: kill PTY, persist `sessionToken`, move row to Previous Sessions. Reuses the natural-exit code path via a shared `moveToResumable()` helper.

## Completed phases

- [2026-05-16-ctrl-v-paste](2026-05-16-ctrl-v-paste/SPEC.md) — Bind Ctrl+V / Cmd+V to paste clipboard into active terminal, fixing dictation tools (TypeWhisper, Ditto, etc.) and manual paste. ✅ landed `9f4f20f` with 11 unit tests.
- [2026-05-16-playwright-e2e](2026-05-16-playwright-e2e/SPEC.md) — Playwright-driven E2E test framework: smoke suite for the app shell + an end-to-end Ctrl+V paste test. ✅ landed alongside follow-ups (plugin hotkey leak, synthesized-key fallback) on the same day.

## Backlog

- Consider upstreaming the Ctrl+V fix to `rustykuntz/clideck`.
