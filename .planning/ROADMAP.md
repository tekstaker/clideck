# clideck fork — ROADMAP

Fork of `rustykuntz/clideck` maintained for Windows + dictation ergonomics.

## Active phase

- _(none — planning queue is empty. Pick from Parked or open a new milestone.)_

## Parked

- [2026-05-18-restart-architecture](2026-05-18-restart-architecture/SPEC.md) — Paused 2026-05-19. Wrapper-process restart shipped on `fix/restart-button` (v1.31.5 → v1.31.6), but the in-UI Restart still hangs the modal and kills active PTY sessions; debugging it live is too disruptive to ongoing work. Remaining deliverables (lozenge tooltip, lozenge relocation, restart-hang fix) deferred until the hang chase is safe to pick up — workaround in the meantime is `taskkill /F /PID <clideck-pid>` from an external terminal, then relaunch `clideck`. Full forensic notes in `memory/project_restart-button-broken.md`.

## Queued phases

- _(none — paste-blobs is now active, see above)_

## Completed phases

- [2026-05-20-paste-blobs](2026-05-20-paste-blobs/SPEC.md) — Paste binary clipboard items into a session's `.clideck/paste/` inbox via Ctrl+V (clipboard read) or drag-and-drop (the path that works for File-Explorer files). After upload the server writes the relative path into the PTY's stdin so the running agent actually sees it — not just xterm's display. Includes a modal drop overlay, full filename sanitisation against path traversal, and a 50 MiB cap. ✅ closed out 2026-05-20 on `feat/paste-blobs` at v1.31.7 (`eb4ad43` + `00e072d` + `175982e` + `4730f10`; 10 unit suites / 84 tests + 24 E2E green).
- [2026-05-19-session-pause](2026-05-19-session-pause/SPEC.md) — "Pause" action on active sessions: kill PTY, preserve the captured `sessionToken`, move the row to Previous Sessions via the shared `moveToResumable()` helper. Two follow-up fixes after initial UAT: centralised five token-capture paths through `sessions.captureToken()` and propagated `hasToken` through the `created` broadcast for resumed sessions. ✅ closed out 2026-05-20 on `feat/session-pause` (`66942c5` + `ae752f0` + `2508383`).
- [2026-05-19-terminal-ux](2026-05-19-terminal-ux/SPEC.md) — Auto-copy on terminal selection (with deduped toast) and Ctrl/Cmd+click to open http(s) URLs from terminal output in a new tab. Plain click preserves text-selection on purpose — diverges from upstream `85246f6` which opens on plain click. ✅ closed out 2026-05-20 on `feat/terminal-ux` (`8fa1def`; 49 unit + 17 E2E green; UAT passed).
- [2026-05-19-session-polish](2026-05-19-session-polish/SPEC.md) — Drag-to-reorder sessions within their project group (or the ungrouped area) with full server-persisted ordering, and unread-dot / working-indicator mutex so the two row-level signals stop firing simultaneously. ✅ closed out 2026-05-20 on `feat/session-polish` (`6b5450a` mutex, `108ccd4` drag-to-reorder; 34 unit tests + 14 E2E green).
- [2026-05-17-session-ux](2026-05-17-session-ux/SPEC.md) — Per-row Rename/Delete on Previous Sessions, graceful failed-resume → fresh session, bulk project import, and select-all master-checkbox sync in the bulk-import modal. ✅ closed out 2026-05-19 on `feat/session-ux` (final criterion landed in `97b08c5`; UAT walked through all 11 acceptance criteria — every one passed).
- [2026-05-16-ctrl-v-paste](2026-05-16-ctrl-v-paste/SPEC.md) — Bind Ctrl+V / Cmd+V to paste clipboard into active terminal, fixing dictation tools (TypeWhisper, Ditto, etc.) and manual paste. ✅ landed `9f4f20f` with 11 unit tests.
- [2026-05-16-playwright-e2e](2026-05-16-playwright-e2e/SPEC.md) — Playwright-driven E2E test framework: smoke suite for the app shell + an end-to-end Ctrl+V paste test. ✅ landed alongside follow-ups (plugin hotkey leak, synthesized-key fallback) on the same day.

## Backlog

- Consider upstreaming the Ctrl+V fix to `rustykuntz/clideck`.
