---
created: 2026-05-22
title: Warn before opening a session in a path that doesn't exist (offer to create it)
area: ui
files:
  - public/js/creator.js
  - public/js/folder-picker.js
  - utils.js
  - sessions.js
  - server.js
promoted: true
promoted_to: .planning/2026-05-27-creator-ergonomics/SPEC.md
promoted_at: 2026-05-27
---

## Problem

When creating a new project/session, the user types a working-directory path into the
creator card's `#creator-cwd` input. If the typed path doesn't exist, **nothing visible
happens** — there's no warning, no confirmation, no error. The session opens anyway,
silently, in `os.homedir()`.

Trace: `creator.js` sends `{ type: 'create', cwd, … }` → `sessions.js:215` calls
`resolveValidDir(msg.cwd)` → `utils.js:40-45` returns the requested dir if it
`statSync().isDirectory()`, otherwise falls back to `require('os').homedir()` with no
broadcast back to the client.

Two failure modes for the user:
1. They typo'd the path and expected to be told. Instead the session lands in `~`,
   they don't notice for a beat, and now their agent has run a `git status` against
   the wrong directory.
2. They typed a path they *meant* to create (e.g. `C:/_Projects/new-thing`) and
   expected clideck to mkdir it as part of "open a session here". Instead they have
   to alt-tab out, mkdir manually, come back, retry.

## Solution

Add a pre-flight check between the creator's "Open" click and the actual `create`
message. Two pieces:

### Client (`public/js/creator.js`)

Before sending the `create` message, ask the server "does this cwd exist?". If yes
→ proceed. If no → show a 3-state modal:

```
┌─────────────────────────────────────────┐
│ ⚠ Folder doesn't exist                  │
│                                         │
│ C:\_Projects\new-thing                  │
│                                         │
│ This folder doesn't exist yet. Create   │
│ it and open the session, or cancel?     │
│                                         │
│       [Cancel]   [Create and open]      │
└─────────────────────────────────────────┘
```

- **Cancel** → no-op, return focus to the cwd input with the offending path
  selected for easy correction.
- **Create and open** → POST/WS-message the server to `mkdir -p` the path, wait
  for ack, then proceed with the normal `create` flow.

Reuse the `confirm.js` modal pattern that's already used at `creator.js:111` for
the in-cwd-session-collision warning. May need a 3-button variant if confirm.js
is only yes/no today — check before extending.

### Server (`server.js` + `sessions.js`)

- New WS message `{ type: 'check-cwd', path }` → broadcasts back
  `{ type: 'check-cwd-result', path, exists: bool, isDirectory: bool, error: string|null }`.
  Pure stat, no side effects.
- New WS message `{ type: 'mkdir-cwd', path }` → `mkdirSync(path, { recursive: true })`
  inside a try/catch, broadcasts back `{ type: 'mkdir-cwd-result', path, ok, error }`.
  Must validate the path is absolute and not anything weird (path traversal less
  of a concern here — the user is *typing* the path themselves and the server is
  Lance's own host — but still: reject relative paths, reject paths containing
  `..`, surface EACCES / EPERM / EEXIST cleanly).
- `resolveValidDir` in `utils.js:40-45` keeps its silent-fallback behaviour for
  backwards-compat (resumed sessions where the cwd later disappeared still need
  a soft landing). The new client check just makes the creator path NOT rely on
  the silent fallback.

### Edge cases to think about

- Empty path / whitespace-only → existing "default-path → home dir" behaviour is
  fine, no warning needed. Only warn when the user typed *something* that doesn't
  resolve.
- Drag-folder-onto-creator (if `folder-picker.js` supports it) → folder already
  exists by definition, skip the check.
- Folder-picker selection → also already exists, skip the check.
- Path exists but is a file, not a directory → distinct warning ("That's a file,
  not a folder"), no "Create" affordance.
- Symlinks → follow them (default `statSync` behaviour). A broken symlink reports
  as not-exists which is the right outcome.
- Permission denied on stat (`EACCES`) → distinct warning ("Can't read that path
  — permission denied"), no "Create" affordance (mkdir would also fail).
- After mkdir, the just-created folder is empty — that's fine, the spawned shell
  / agent will land in an empty dir, which is expected for a "new project".

### Related

- `2026-05-19-relocate-connection-lozenge-into-sidebar` — same `confirm.js` modal
  pattern was used for the "open another session in this folder?" prompt; mirror
  its visual style.
- The collision-detection at `creator.js:111` is the closest existing analog —
  same shape (pre-flight check → modal → proceed-or-cancel).
