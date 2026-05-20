---
created: 2026-05-19T12:02:00Z
title: Add "Pause session" context-menu action to move an active session to Previous Sessions
area: ui
phase_hint: 2026-05-19-session-pause
ingested_into: .planning/2026-05-19-session-pause/SPEC.md (sole deliverable)
ingested_at: 2026-05-19
files:
  - public/js/terminals.js:175-226
  - public/js/terminals.js:239-241
  - sessions.js:200-216
  - sessions.js:340-410
  - handlers.js
---

## Problem

Today the only way to free up an active session's memory is to **delete**
it — which removes the row from the sidebar and ends the conversation.
But many agent sessions Lance runs (Claude Code, Codex, Gemini) hold a
captured `sessionToken` that makes them resumable. There should be a
middle option:

- **Active**: live PTY, live xterm.js buffer, can stream output.
- **Previous (dormant)**: PTY gone, no memory footprint, but the
  conversation can be resumed later via the agent's `--resume <token>`
  (or equivalent) path.
- **Deleted**: gone forever.

Lance wants the middle one to be accessible as a context-menu action
on active sessions: "Pause" (or similar) → session moves down into the
Previous Sessions list immediately, freeing the PTY and the
xterm.js buffer, with the conversation preserved for later resume.

This is **not** an archive (which would imply storage policy). It's a
quick "I'm done for now but I might come back to this conversation"
gesture.

## The good news — most of the plumbing already exists

The natural-exit path in `sessions.js:200-216` already does this when a
PTY exits on its own:

```js
// If resumable and token captured, move to resumable list (keep transcript for search)
if (s.sessionToken) {
  resumable.push({
    id, name, cwd, commandId, presetId, projectId, themeId,
    sessionToken: s.sessionToken,
    transcript: s.transcript,
    closedAt: Date.now(),
  });
  console.log(`Session ${id.slice(0, 8)}: moved to resumable on exit (token: ${s.sessionToken.slice(0, 12)}…)`);
  // … persist to disk + broadcast
  saveSessions(cfg);
  broadcast({ type: 'sessions.resumable', list: getResumable() });
}
```

"Pause" is the same flow, triggered by user click instead of by the
PTY exiting on its own.

## Solution

### Server side (`server.js` / `handlers.js` / `sessions.js`)

1. Add a new handler `session.pause` (mirroring the existing message
   shape, see `handlers.js` and `sessions.js:340-410` for the
   `session.delete` pattern).

2. The handler:
   - Looks up the live session record by id.
   - **Refuses if no `sessionToken` is captured yet** — without a
     token, the session is not actually resumable and "pause" would
     silently degrade to "delete." Return an error message so the
     client can show a meaningful toast instead of failing
     mysteriously.
   - Flushes any pending transcript writes (the server already keeps
     a transcript ringbuffer per session — make sure the last chunk
     is captured before kill).
   - Kills the PTY cleanly (same mechanism `session.delete` uses for
     teardown — reuse, don't duplicate).
   - Moves the record to `resumable` exactly as the natural-exit path
     does at `sessions.js:200-216`. Extract that into a shared
     `moveToResumable(s, cfg)` helper so both call sites use the same
     code path — easier to keep them in lock-step over time.
   - Calls `saveSessions(cfg)` and broadcasts
     `sessions.resumable` + a `closed` (or `paused`) message so the
     client tears down the active row.

3. Optionally emit a distinct `closed` reason on the broadcast so the
   client can distinguish "exited" from "user paused" and show the
   right toast.

### Client side (`public/js/terminals.js`)

1. Add a new menu item in the active-session context menu at
   `terminals.js:175-226` — slot it between **Refresh** (line 222)
   and **Delete** (line 226) since it's the "less destructive sibling
   of delete." Use a pause-glyph (⏸ or a paused-icon SVG matching the
   existing iconography).

2. Disable the menu item when the session has no `sessionToken`
   (`hasToken === false`). Reason in tooltip / aria-label: "Pause is
   unavailable until the agent has emitted a resumable session ID."
   The client may not currently know per-session whether a token
   exists — if so, surface that via the existing session-state
   payload (add a `hasToken` boolean) rather than guessing.

3. Wire up the `data-action="pause"` handler at the dispatch site
   `terminals.js:239-241` — send `{ type: 'session.pause', id }`.
   On success, the server's `closed` (or `paused`) message will
   already trigger `removeTerminal(id)` — no extra client logic
   needed there. Optionally show a short toast ("Session paused —
   available under Previous Sessions").

4. When the user clicks the paused entry in Previous Sessions, the
   existing resume path takes over (`sessions.js:297`+ handles the
   "saved" lookup and spawning a fresh PTY with `--resume`). No
   change needed there.

## Edge cases

- **Sessions with no token yet** — first prompt hasn't completed, no
  conversation ID exists. Refuse pause server-side; explain in toast
  client-side.
- **Sessions actively working** — PTY is mid-stream. Pause should
  still work, but the in-flight output may not all be captured.
  Document this as expected behavior: pause is graceful-enough, not
  transactional. The user can wait for idle if they want a clean
  snapshot.
- **Multiple clients viewing the same session** — the broadcast
  `sessions.resumable` + `closed` already handles the multi-client
  case (see existing pattern). Verify all open clients tear down
  the row simultaneously.
- **Per-row menu on Previous Sessions** — the `2026-05-17-session-ux`
  phase added Rename/Delete to dormant rows. Make sure the paused
  session inherits those menu items naturally (the row template
  for resumable rows is the same regardless of how the session
  entered the list).

## Naming

"Pause" is Lance's phrasing and is the most intuitive label. Other
considered names:
- "Suspend" — more accurate technically (kills process, persists
  state) but less friendly.
- "Stand down" / "Dismiss" — too cute.
- "Park" — short, vivid, but non-standard.

Recommend **Pause** with a tooltip / explainer: "End the live session
and move it to Previous Sessions. You can resume it later."

## Persistence guarantee

Lance's specific concern: *"save all the information up to that
point in the memory or whatever happens, so you don't lose context."*

The transcript ringbuffer + `sessionToken` already cover this. The
**conversation context lives on the agent's side** (Claude Code's
local state, Codex's API state, etc.) and is resumable via the
token, not stored in clideck. clideck just remembers the token +
display state. As long as the token is captured before pause, no
context is lost on the agent side.

The xterm.js buffer itself (the visible terminal output) is
ephemeral — once the PTY dies, the buffer goes with it. The
preview text is persisted via `session.setPreview`
(`terminals.js:603`) and the transcript is kept for search
(`sessions.js:204`). If Lance wants the full scrollback restored
on resume that's a separate ask — likely out of scope, but worth
naming explicitly so it's a conscious decision.
