# clideck fork — ROADMAP

Fork of `rustykuntz/clideck` maintained for Windows + dictation ergonomics.

> **Phase numbers** are assigned in execution (chronological) order and are
> stable — a phase keeps its number whatever section it sits in. The
> `YYYY-MM-DD-slug` directory name remains the on-disk identifier (referenced in
> commits, memory, and SPEC links); the number is the human-friendly handle.

## Active phase

- _(none — pick a Queued phase to start, or open a new milestone.)_

## Parked

- **Phase 4** — [2026-05-18-restart-architecture](2026-05-18-restart-architecture/SPEC.md) — Paused 2026-05-19. Wrapper-process restart shipped on `fix/restart-button` (v1.31.5 → v1.31.6); lozenge relocation shipped 2026-05-20 on `feat/lozenge-relocation` at v1.31.8 (lozenge moved from lower-left corner to the sidebar under the clideck title, right above the search bar). Remaining deliverables (lozenge tooltip + restart-hang fix) deferred until the hang chase is safe to pick up. Workaround for the restart hang: `taskkill /F /PID <clideck-pid>` from an external terminal, then relaunch `clideck`. Full forensic notes in `memory/project_restart-button-broken.md`.

## Queued phases

- **Phase 9** — [2026-05-27-terminal-display-sizing](2026-05-27-terminal-display-sizing/SPEC.md) — User-adjustable terminal sizing as a "Display" settings group: xterm.js font-size control (persisted via `config.js`, optional `Ctrl/Cmd +/-`) and a drag-resizable left sidebar that reflows the terminal pane (width in localStorage, min ~220px, double-click to reset). Both share the post-change machinery — iterate `state.terms`, `fitAddon.fit()`, broadcast PTY `resize`. Seeded 2026-05-27 from two pending todos; not yet through discuss/plan-phase.
- **Phase 10** — [2026-05-27-creator-ergonomics](2026-05-27-creator-ergonomics/SPEC.md) — Two friction-removers on the new-session creator card: warn (with a create-and-open option) before opening a session in a non-existent path instead of silently landing in `~`, and default the project dropdown to "None (outside project hierarchy)" so the common case needs no pick. New `check-cwd` / `mkdir-cwd` WS messages on the server side; client reuses the `confirm.js` modal pattern. Seeded 2026-05-27 from two pending todos; not yet through discuss/plan-phase.
- **Phase 11** — [2026-05-27-terminal-focus](2026-05-27-terminal-focus/SPEC.md) — Terminal-ux v2: make Enter (and all keyboard input) reliably reach the active terminal's PTY without a precise click on the prompt line first. Focus lands on `<body>`/a hidden element after typing or — most visibly — pasting, so Enter is a no-op until a fiddly re-focus click. Restore `term.focus()` after every paste flow, widen the focus-on-click target to the whole terminal container, and consider a careful keydown-forwarding fallback. Seeded 2026-05-27 from a pending todo; not yet through discuss/plan-phase.

## Completed phases

- **Phase 8** — [2026-05-20-paste-blobs](2026-05-20-paste-blobs/SPEC.md) — Paste binary clipboard items into a session's `.clideck/paste/` inbox via Ctrl+V (clipboard read) or drag-and-drop (the path that works for File-Explorer files). After upload the server writes the relative path into the PTY's stdin so the running agent actually sees it — not just xterm's display. Includes a modal drop overlay, full filename sanitisation against path traversal, and a 50 MiB cap. ✅ closed out 2026-05-20 on `feat/paste-blobs` at v1.31.7 (`eb4ad43` + `00e072d` + `175982e` + `4730f10`; 10 unit suites / 84 tests + 24 E2E green).
- **Phase 7** — [2026-05-19-session-pause](2026-05-19-session-pause/SPEC.md) — "Pause" action on active sessions: kill PTY, preserve the captured `sessionToken`, move the row to Previous Sessions via the shared `moveToResumable()` helper. Two follow-up fixes after initial UAT: centralised five token-capture paths through `sessions.captureToken()` and propagated `hasToken` through the `created` broadcast for resumed sessions. ✅ closed out 2026-05-20 on `feat/session-pause` (`66942c5` + `ae752f0` + `2508383`).
- **Phase 6** — [2026-05-19-terminal-ux](2026-05-19-terminal-ux/SPEC.md) — Auto-copy on terminal selection (with deduped toast) and Ctrl/Cmd+click to open http(s) URLs from terminal output in a new tab. Plain click preserves text-selection on purpose — diverges from upstream `85246f6` which opens on plain click. ✅ closed out 2026-05-20 on `feat/terminal-ux` (`8fa1def`; 49 unit + 17 E2E green; UAT passed).
- **Phase 5** — [2026-05-19-session-polish](2026-05-19-session-polish/SPEC.md) — Drag-to-reorder sessions within their project group (or the ungrouped area) with full server-persisted ordering, and unread-dot / working-indicator mutex so the two row-level signals stop firing simultaneously. ✅ closed out 2026-05-20 on `feat/session-polish` (`6b5450a` mutex, `108ccd4` drag-to-reorder; 34 unit tests + 14 E2E green).
- **Phase 3** — [2026-05-17-session-ux](2026-05-17-session-ux/SPEC.md) — Per-row Rename/Delete on Previous Sessions, graceful failed-resume → fresh session, bulk project import, and select-all master-checkbox sync in the bulk-import modal. ✅ closed out 2026-05-19 on `feat/session-ux` (final criterion landed in `97b08c5`; UAT walked through all 11 acceptance criteria — every one passed).
- **Phase 1** — [2026-05-16-ctrl-v-paste](2026-05-16-ctrl-v-paste/SPEC.md) — Bind Ctrl+V / Cmd+V to paste clipboard into active terminal, fixing dictation tools (TypeWhisper, Ditto, etc.) and manual paste. ✅ landed `9f4f20f` with 11 unit tests.
- **Phase 2** — [2026-05-16-playwright-e2e](2026-05-16-playwright-e2e/SPEC.md) — Playwright-driven E2E test framework: smoke suite for the app shell + an end-to-end Ctrl+V paste test. ✅ landed alongside follow-ups (plugin hotkey leak, synthesized-key fallback) on the same day.

## Backlog

- Consider upstreaming the Ctrl+V fix to `rustykuntz/clideck`.
