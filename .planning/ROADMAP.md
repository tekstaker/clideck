# clideck fork — ROADMAP

Fork of `rustykuntz/clideck` maintained for Windows + dictation ergonomics.

## Active phase

- [2026-05-17-session-ux](2026-05-17-session-ux/SPEC.md) — Per-row Rename/Delete on Previous Sessions, graceful failed-resume → fresh session, bulk project import from a parent folder's subfolders.

## Completed phases

- [2026-05-16-ctrl-v-paste](2026-05-16-ctrl-v-paste/SPEC.md) — Bind Ctrl+V / Cmd+V to paste clipboard into active terminal, fixing dictation tools (TypeWhisper, Ditto, etc.) and manual paste. ✅ landed `9f4f20f` with 11 unit tests.
- [2026-05-16-playwright-e2e](2026-05-16-playwright-e2e/SPEC.md) — Playwright-driven E2E test framework: smoke suite for the app shell + an end-to-end Ctrl+V paste test. ✅ landed alongside follow-ups (plugin hotkey leak, synthesized-key fallback) on the same day.

## Backlog

- Consider upstreaming the Ctrl+V fix to `rustykuntz/clideck`.
