# clideck fork — ROADMAP

Fork of `rustykuntz/clideck` maintained for Windows + dictation ergonomics.

## Active phase

- **2026-05-18-restart-architecture** — Wrapper-process restart for in-UI clideck restart (neutral coordinator script in `lib/restart-wrapper.js`), defensive safety net (WSS error handler suppresses unhandled listen failures, bulletproof onShutdown with 3s hard-exit watchdog), connection lozenge in the lower-left with live status + uptime + version, **readable hover tooltip on the lozenge so the version text is legible**. Version 1.31.5. Code on `fix/restart-button` (commits `61e4334`, `b6ee84f`); pending end-to-end verification (port 4000 currently held by old PID 32256) and the tooltip todo. Phase needs a retroactive `SPEC.md` before merge.

## Queued phases

- [2026-05-17-session-ux](2026-05-17-session-ux/SPEC.md) — Per-row Rename/Delete on Previous Sessions, graceful failed-resume → fresh session, bulk project import from a parent folder's subfolders. **Follow-up before close-out:** sync the "Select all" checkbox state with row state in the bulk-import modal (see `.planning/todos/pending/2026-05-19-bulk-import-select-all-initial-state.md`).
- **2026-05-19-session-polish** — Two follow-ups on sidebar / session-row UX: drag-to-reorder sessions within a project group (mirroring the existing project-reorder pattern in `public/js/drag.js`), and fix the visual collision between the "working" indicator (bouncing dot + green pill-status) and the "unread" dot — they should be mutually exclusive. Needs `SPEC.md` / `PLAN.md` when picked up.
- **2026-05-19-terminal-ux** — Two terminal-interaction improvements that share the same per-terminal init hook at `public/js/terminals.js:520` and the same "don't break plain-click text selection" constraint: auto-copy on selection (pointerup-driven, reuses existing `copyTerminalSelection`, fires a short confirmation toast), and Ctrl/Cmd+click on URLs in terminal output to open them in a new tab (via `@xterm/addon-web-links`, hardened with `noopener,noreferrer` and http(s)-only scheme filtering). Needs `SPEC.md` / `PLAN.md` when picked up.
- **2026-05-19-session-pause** — Add a "Pause" action to the active-session context menu that kills the PTY, persists the captured `sessionToken` + transcript, and moves the row into Previous Sessions — the same path `sessions.js:200-216` already takes on natural PTY exit, just user-triggered. Server: new `session.pause` handler, extract `moveToResumable()` helper so the user-initiated path and the natural-exit path stay in lock-step. Client: new menu item between Refresh and Delete, disabled when no token has been captured yet. Needs `SPEC.md` / `PLAN.md` when picked up.

## Completed phases

- [2026-05-16-ctrl-v-paste](2026-05-16-ctrl-v-paste/SPEC.md) — Bind Ctrl+V / Cmd+V to paste clipboard into active terminal, fixing dictation tools (TypeWhisper, Ditto, etc.) and manual paste. ✅ landed `9f4f20f` with 11 unit tests.
- [2026-05-16-playwright-e2e](2026-05-16-playwright-e2e/SPEC.md) — Playwright-driven E2E test framework: smoke suite for the app shell + an end-to-end Ctrl+V paste test. ✅ landed alongside follow-ups (plugin hotkey leak, synthesized-key fallback) on the same day.

## Backlog

- Consider upstreaming the Ctrl+V fix to `rustykuntz/clideck`.
