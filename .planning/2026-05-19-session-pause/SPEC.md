# SPEC — Pause session (active → Previous Sessions)

**Status:** planned
**Owner:** Lance Keay
**Date:** 2026-05-19

## What this delivers

A new context-menu action on **active** sessions called **Pause** that
ends the live PTY, persists the captured `sessionToken` + transcript,
and moves the session row from the active list down into the
"Previous Sessions" (resumable) list. The agent-side conversation
remains intact and can be resumed later via the existing dormant-row
click path.

This sits between **Active** (live PTY, live xterm buffer, holding
memory) and **Delete** (gone forever) as a third state Lance can
choose explicitly.

## Why

Many of the agent sessions Lance runs (Claude Code, Codex, Gemini)
capture a `sessionToken` that makes them resumable indefinitely. But
the only way to free a session's memory today is **Delete**, which
removes the row entirely. There is no UI gesture that says "I'm done
working on this for now, but I might come back."

The natural-exit code path at `sessions.js:200-216` already
implements this exact transition: when a PTY exits and a
`sessionToken` was captured, the session moves into the `resumable`
list automatically. Pause is the **same flow, user-triggered**.

The feature is therefore mostly a UI affordance plus a thin server
handler that reuses an existing transition. It is in this phase rather
than the smaller `session-polish` phase because (a) it adds genuine
new functionality not previously available, (b) it requires both
client and server work, and (c) it has edge cases around
sessions-without-tokens that need explicit handling.

## Scope

**In scope**

### Server side

- **New WebSocket message type:** `session.pause` with shape
  `{ type: 'session.pause', id }`.
- **New handler** mirroring the existing `session.delete` pattern in
  `sessions.js:340-410` and `handlers.js`. The handler:
  1. Looks up the live session record by id.
  2. **Refuses pause if no `sessionToken` is captured** — return an
     error message (`{ type: 'error', message: '…' }`) the client
     can surface as a toast. Without a token the session is not
     actually resumable; pause would silently degrade to delete.
  3. Flushes any pending transcript writes (the existing
     transcript ringbuffer per session must capture the last
     chunk before the PTY is killed).
  4. Kills the PTY cleanly using the same teardown mechanism
     `session.delete` uses — extract it into a shared helper if
     not already.
  5. Moves the record to the `resumable` list using the **same
     code path** as the natural-exit transition at
     `sessions.js:200-216`. Extract that block into a shared
     `moveToResumable(s, cfg)` helper so both call sites stay in
     lock-step over time.
  6. Calls `saveSessions(cfg)` to persist, then broadcasts
     `sessions.resumable` (updated list) and `closed` (or a new
     `paused` reason on `closed`) so all clients tear down the
     active row.
- **Distinguishable close reason** (optional but recommended): emit
  the `closed` broadcast with a `reason: 'paused'` field so the
  client can show a "session paused" toast instead of the default
  exit-handling.

### Client side

- **New context-menu item:** "Pause" in the active-session menu,
  slotted between **Refresh** (`public/js/terminals.js:222`) and
  **Delete** (`public/js/terminals.js:226`). It's the
  less-destructive sibling of Delete and that's the slot the user
  will scan for first.
- **Disabled state** when the session has no captured token. The
  client needs to know this; surface `hasToken` via the existing
  session-state payload (add a boolean field to whatever the server
  emits for live sessions). When disabled, the menu item should be
  visibly grayed and the tooltip / aria-label should explain
  ("Pause unavailable until the agent emits a resumable session ID").
- **Dispatch wiring** at the existing handler at
  `public/js/terminals.js:239-241`. On `action === 'pause'`, send
  `{ type: 'session.pause', id: sessionId }`.
- **No client teardown logic needed beyond the existing path** —
  the server's broadcast already triggers `removeTerminal(id)` via
  the existing `closed` handler. Optionally show a short toast on
  the `paused` reason: "Session paused — available under Previous
  Sessions."
- **Resume path is unchanged** — clicking the paused row in
  Previous Sessions uses the existing resume flow
  (`sessions.js:297`+ handles the saved lookup and spawning a
  fresh PTY with the agent-specific resume command).

**Out of scope**

- Restoring the full xterm.js scrollback buffer on resume. The
  scrollback is ephemeral and dies with the PTY. The existing
  preview text (`session.setPreview`) and search transcript are
  preserved; full scrollback restoration is a separate, much
  larger feature.
- Bulk pause ("pause all sessions in this project"). Single-session
  only for v1.
- Auto-pause on idle ("if a session has been idle for 30 minutes,
  auto-pause it"). Manual gesture only.
- A "Pause all and resume later as a batch" workspace concept.
- Pause for the per-row menu on Previous Sessions (those sessions
  are already paused — pause has no meaning there).

## Acceptance criteria

1. The active-session context menu shows a **Pause** item between
   Refresh and Delete.
2. The Pause item is **enabled** only when the session has a
   captured `sessionToken`. When disabled, hovering shows an
   explanatory tooltip.
3. Clicking Pause on a session with a captured token results in:
   - The active session row disappears from the active list.
   - A new entry appears in "Previous Sessions" with the same
     name, color, project assignment, theme, and command preset.
   - The PTY process is terminated (no orphan child).
   - The transcript is preserved for search.
   - A short toast confirms the pause.
4. Clicking the paused entry under "Previous Sessions" resumes the
   agent's conversation via its existing resume path — no
   regression to the existing resumable-click behavior.
5. Clicking Pause on a session **without** a captured token does
   nothing visually destructive; an error toast explains why and
   the row stays active.
6. The natural-exit path at `sessions.js:200-216` continues to
   work — both the user-paused and naturally-exited cases produce
   the same final state in the `resumable` list (verify via
   `saveSessions`'s on-disk JSON).
7. Multiple connected clients viewing the same session all tear
   down the active row when one client triggers Pause.
8. Pause + immediate Resume of the same session (same browser
   tab) produces a working live session.
9. All existing Vitest unit suites pass, including the existing
   `resumable-handlers.test.js`.
10. New unit-test coverage for: `session.pause` with valid token
    moves to resumable; `session.pause` without token returns an
    error; the shared `moveToResumable()` helper produces the
    same record shape from both call sites.
11. All existing Playwright E2E suites pass.

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub.
- The natural-exit code path at `sessions.js:200-216` is
  load-bearing — do not duplicate the resumable-move logic.
  Extract it into a helper and call from both sites.
- Pause MUST refuse cleanly when no token is captured. Silently
  degrading to delete would lose user data; this is explicitly
  unacceptable.
- The PTY teardown for Pause MUST be the same as for Delete (same
  cleanup, same handle release). Pause is "Delete but preserve the
  resumable record."

## Implementation pointers

- Server-side natural-exit path to mirror: `sessions.js:200-216`.
- Server-side delete pattern to mirror for handler shape:
  `sessions.js:340-410` and the corresponding handler in
  `handlers.js`.
- Save path: `sessions.js#saveSessions()` at line ~547.
- Resumable list getter to update on broadcast:
  `sessions.js#getResumable()` at line ~519.
- Client menu site: `public/js/terminals.js:175-226` (HTML
  generation), `public/js/terminals.js:239-241` (action dispatch).
- Existing `data-action` patterns to mirror: `copy`, `paste`,
  `rename`, `mute`, `theme`, `refresh`, `delete`.
- Test pattern to mirror: `tests/resumable-handlers.test.js`.

## Naming rationale

"Pause" is Lance's term and is the most intuitive label. Considered
alternatives ("Suspend," "Stand down," "Park," "Dismiss") are either
overly technical or unconventional. The tooltip should clarify the
semantics: "End the live session and move it to Previous Sessions.
You can resume it later."
