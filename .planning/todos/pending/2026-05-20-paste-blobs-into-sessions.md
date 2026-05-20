---
created: 2026-05-20T12:20:09Z
title: Paste binary blobs (images, zips, docs) from clipboard into clideck sessions
area: ui
files:
  - public/js/terminals.js:152
  - public/js/hotkeys.js
  - server.js
  - handlers.js
---

## Problem

Today Ctrl+V in a clideck terminal pastes clipboard **text** into the active
session (shipped in the `2026-05-16-ctrl-v-paste` phase via
`pasteIntoTerminal()` in `public/js/terminals.js:152`). But clipboard **binary
content** — a screenshot, a zipped folder, a Word/PDF doc copied from File
Explorer — has nowhere to go. The agent running in the session (Claude Code,
Codex, Gemini, OpenCode) has no way to access blobs Lance has on his
clipboard, even though every agent's tool surface knows how to read files
from disk.

The friction this creates: "I have a screenshot of the bug, just look at it" →
Lance has to save the screenshot to disk → cd to where he saved it → tell the
agent the path. Same dance for any binary asset.

The behavior Lance wants: paste a blob into a clideck session and have the
agent see it as a real file at a known path it can read.

## Solution

TBD — needs design, but rough shape:

1. **Capture path.** Intercept paste in the focused terminal (extend the
   existing `Ctrl+V` / `Cmd+V` hotkey + the right-click → Paste menu).
   `navigator.clipboard.read()` (not `readText`) returns `ClipboardItem`s
   with MIME types — branch on `image/*` vs `application/*` vs text and
   route accordingly.

2. **Transport.** POST the blob to a new clideck server endpoint
   (e.g. `POST /sessions/:id/paste-blob` with `multipart/form-data` or raw
   octets + content-type header). Server writes it to a per-session inbox
   directory.

3. **Storage.** Per-session "paste inbox" on disk, e.g.
   `<session-cwd>/.clideck/paste/<timestamp>-<safe-name>.<ext>`. Path is
   predictable so the agent can ls it. Cleanup policy (TTL or on session
   close) is a design question.

4. **Surface to the user (and the agent).** Show a confirmation in the
   terminal stream — e.g. write a line like
   `[clideck] pasted image → .clideck/paste/2026-05-20T12-20-09-screenshot.png`
   so the user knows what landed where, and the agent immediately sees the
   path in its scrollback and can read it.

5. **Permissions / safety.** Limit blob size, scrub filenames, decide
   whether to let Word docs / executables through or restrict to
   images-only initially. Lance's threat model is local-only so this is
   probably permissive, but worth deciding deliberately.

### Why this matches existing patterns

- `pasteIntoTerminal()` (text) and the right-click paste menu already exist;
  this extends the same intent for non-text MIME types.
- node-pty + per-session cwd is already the model; "paste inbox" sits
  inside the same per-session filesystem so the path the agent reads is
  obvious from its own cwd.
- Aligns with the broader clideck-docker direction: when Phase 2 (VOL-01)
  bind-mounts `C:\_Projects` into the container, paste-inbox paths under
  the project tree become visible from both sides automatically.

### Out of scope (probably)

- Drag-and-drop file uploads (different UX entry point — could share the
  server endpoint though).
- Automatic OCR / format conversion of pasted blobs — agent decides what to
  do with the file.
- Cross-session blob sharing — keep it scoped to the session it was pasted
  into.

### Open questions

- Should pasted text continue to go straight to the PTY (current behaviour)
  while pasted blobs go through the upload path? Yes, almost certainly —
  text-into-terminal is the right UX for prompts; file-into-cwd is the
  right UX for assets.
- What about clipboards containing both text AND a binary (e.g. some apps
  put both `text/html` and `image/png`)? Probably: prefer binary if
  present, fall back to text.
- Does this need to work in the containerised clideck (clideck-docker)
  too? Yes — Phase 2's host-projects mount makes the paste-inbox path
  visible on the host automatically, so it should just work, but worth
  verifying once VOL-01 lands.
