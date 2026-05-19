# SPEC — Session-management UX cleanup

**Status:** in progress
**Owner:** Lance Keay
**Date:** 2026-05-17

## What this delivers

Three connected improvements to how clideck handles sessions you can no
longer use:

1. **Per-row context menu on Previous Sessions.** Each dormant ("resumable")
   row gains the same three-dot hover menu the active sessions have, with
   **Rename** and **Delete** actions. The section-level "Clear dormant
   sessions" menu stays.
2. **Graceful failed-resume.** When the user clicks a Previous Session and
   the underlying agent CLI cannot find the conversation (Claude prints
   *"No conversation found with session ID …"* and the PTY exits within a
   few seconds), clideck does not re-queue the broken entry. Instead it
   launches a fresh session in the same working directory with the same
   command preset and emits a toast explaining what happened.
3. **Bulk project import.** A new "Add many…" action next to "New project"
   opens a folder picker, then lists the picked folder's immediate
   subdirectories with checkboxes (incl. select-all). One click creates
   N projects whose name defaults to the folder name and whose `path` is
   the subfolder.
4. **Close-out fix on bulk import.** The "Select all" master checkbox in
   the bulk-import modal does not reflect the actual row selection
   state. On open, all rows are pre-selected but the master renders
   unticked; toggling individual rows does not update the master either.
   This is a follow-up bug found after the bulk-import deliverable
   shipped — folded into this phase as a close-out fix before the phase
   is marked done.

## Why

Three observed bugs / friction points, all in the fork at
`C:\_Projects\clideck`:

- **Stuck dormant entries.** Lance has three resumable sessions from his
  earliest clideck use that were never followed by real activity. Clicking
  them surfaces *"No previous conversation found for session ID <guid>"*
  in the PTY, then the spawned session exits and — because clideck's
  existing exit hook re-queues anything with a captured token — the dead
  entry reappears. There is no per-row Delete or Rename today; only a
  section-wide "Clear dormant sessions". So a single stale entry is
  un-removable without flushing the lot.
- **No recovery from a failed resume.** Even a one-off failed resume
  leaves the user back at the same broken row. The user's stated
  expectation: *"if you can't find any content for a session ID, just
  open it as a new session with the message 'No information found for
  the session — assuming it's a new session', so I can still start using
  it."*
- **One-by-one project import is the only path.** All of Lance's repos
  live under a single parent folder. Importing each as a clideck project
  requires hitting "New project", picking the path, naming it, OK — for
  every single project. A checklist over the parent's subfolders cuts
  that to one dialog.

## Scope

**In scope**

- New WebSocket message types:
  - `resumable.rename` — `{ id, name }`. Mutates the saved entry, persists
    via the existing save path, broadcasts `sessions.resumable`.
  - `dirs.listSubdirs` — `{ path }`. Returns `{ path, entries: [{ name, full, isProject }] }`
    where `isProject` is true if any current `cfg.projects[].path` already
    points there (case-insensitive on Windows).
- Server-side failed-resume detection: when `spawnSession` is invoked from
  `resume()`, tag the session `s.resumedAt = Date.now()` and
  `s.originalResumeToken = saved.sessionToken`. In the existing `term.onExit`,
  if `Date.now() - s.resumedAt < 5000` **and** the session never captured a
  *new* token (`s.sessionToken === s.originalResumeToken`), do not re-queue.
  Instead call the existing `create`-style spawn path with the base command
  (no `{{sessionId}}` substitution) in the same `cwd` and broadcast a
  `session.recovered` notice for the client to surface as a toast.
- Client-side:
  - `buildResumableRow` adds a three-dot menu button with the same hover
    pattern as the active session row's `.menu-btn`.
  - `openResumableMenu(id, anchor)` in `app.js` mirrors `openMenu` but with
    only Rename / Delete; reuses `positionMenu` and `confirmClose`.
  - In-place rename for resumable rows reuses the same UX as active session
    rename (contenteditable span + Enter/Esc), with the network call going
    to `resumable.rename`.
  - "Add many…" button next to the existing "+ Project" trigger opens a
    folder picker → checklist modal. Pre-checks unimported folders, dims
    already-imported ones, supports select-all / select-none, on OK pushes
    one new project per selection into `cfg.projects` (color from the
    existing `PROJECT_COLORS` rotation, name = folder name, `path` =
    subfolder).
  - Recovery toast handler for the new `session.recovered` broadcast.

**Out of scope**

- Editing the agent preset or auto-discovering valid resume tokens.
- Detecting failed resume from output-pattern scraping (avoided —
  CLI-specific and brittle). The 5-second + same-token signal is
  agent-agnostic.
- Drag-to-reorder projects or any change to the active-session menu.
- An "Add many" parent-folder bookmark; users re-pick the parent each time.
- Mobile-specific layout polish beyond what the existing modals already do.

## Acceptance criteria

1. Hovering a row in "Previous Sessions" exposes a three-dot button.
   Clicking it opens a menu with **Rename** and **Delete**.
2. **Delete** triggers the existing `confirmClose` modal, then sends
   `{ type: 'close', id }` to the server. The dormant entry disappears
   on the resulting `sessions.resumable` broadcast.
3. **Rename** triggers in-place editing of the row's name. Enter commits
   and sends `{ type: 'resumable.rename', id, name }`; Esc cancels. After
   the server broadcasts `sessions.resumable`, the row reflects the new
   name on every connected client.
4. Clicking a dormant session whose underlying conversation does not exist
   (e.g. a `claude --resume <stale-token>` that exits within five seconds
   without printing a fresh session token) results in:
   - The dormant entry being removed from "Previous Sessions" (no
     re-queue).
   - A fresh session being created in the same `cwd` with the same
     `commandId` and a generated UUID — visible in the active sessions list
     and selected automatically.
   - A toast: *"Couldn't resume previous session — started a fresh one in
     `<short cwd>`"*.
5. A successful resume (PTY runs past five seconds OR captures a new
   session token) preserves today's behaviour: the row leaves "Previous
   Sessions" and the live session is wired up unchanged.
6. The "Add many…" trigger opens a folder picker; selecting a folder
   transitions to a checklist of its immediate subdirectories. Subfolders
   whose absolute path is already used by an existing project are visibly
   dimmed and unchecked-by-default; everything else is checked-by-default.
   Select-all / select-none toggles work. OK creates one project per
   checked row with `name = folder basename` and persists via the existing
   `config.update` message.
7. **Bulk-import master checkbox stays in sync with row state.** On
   modal open with all rows pre-selected, the "Select all" checkbox
   is shown ticked. Toggling any row updates the master:
   - All rows checked → master `checked`.
   - Some rows checked → master `indeterminate`.
   - No rows checked → master unchecked.
   Implementation work site: `public/js/app.js:1126` (render) and
   `public/js/app.js:1175-1178` (one-way listener — add the reverse
   listener for row → master sync and initialize master state on
   render).
8. All existing Vitest unit suites still pass, including the
   `hotkeys-paste`, `ws-send-guard`, and any others present.
9. The existing Playwright smoke + Ctrl+V paste E2E suites still pass.
10. The new server handlers have unit-test coverage at the message-routing
    level (rename mutation, missing-id no-op, listSubdirs marks already-imported
    entries).
11. No regressions to the existing `prev-sessions-menu-btn` section-wide
    "Clear dormant sessions" flow.

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub; the fork's CLAUDE.md
  reaffirms that pushes require an explicit per-commit "ship it".
- Match existing code style: vanilla JS ES modules, tab indent in JS,
  Tailwind classes inlined, no semicolon toggling, all client code under
  `public/js/`.
- Keep the failed-resume detection agent-agnostic. No string-matching on
  PTY output; rely on the 5-second + same-token signal.
- All file edits live in:
  `public/js/{app,terminals}.js`, `sessions.js`, `handlers.js`,
  `utils.js` (only if `listSubdirs` lives there), and new tests under
  `tests/`. No churn in unrelated areas.
