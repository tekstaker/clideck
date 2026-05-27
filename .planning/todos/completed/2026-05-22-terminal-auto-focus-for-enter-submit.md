---
created: 2026-05-22
title: Auto-focus terminal so Enter submits without an extra click
area: ui
files:
  - public/js/terminals.js
  - public/js/app.js
  - public/js/paste.js
promoted: true
promoted_to: .planning/2026-05-27-terminal-focus/SPEC.md
promoted_at: 2026-05-27
---

## Problem

After typing into / pasting into the terminal pane, pressing Enter does nothing. The terminal pane has lost focus — keystrokes go to the document instead of the xterm instance. To recover, Lance has to:

1. Move the cursor down to the prompt line
2. Click on the (very narrow) prompt-line hitbox
3. Sometimes click multiple times before the click registers / focus actually lands on the terminal
4. *Then* press Enter

This is most visible right after a paste: the pasted text shows at the cursor inside the terminal, but Enter is a no-op until the terminal is re-focused with a click. The narrow clickable target on the prompt line makes the click-to-refocus dance especially fiddly.

Expected behaviour: when the terminal pane is the active/visible session, keyboard input — Enter included — should be routed to the underlying PTY without requiring a precise click on the prompt line first.

## Solution

TBD — likely some combination of:

- Audit when the xterm instance actually has focus vs. when it just *looks* like it does. The DOM/CSS may show the terminal pane as active while keyboard focus is on `body` or a hidden element (modal backdrop, paste handler, toast button, etc.).
- After every paste flow (`Ctrl+V`, drag-and-drop modal, file-picker), explicitly call `entry.term.focus()` once the paste handler resolves. There are already `term.focus()` calls in `terminals.js` (lines ~772, 1035, 1048, 1079, 1286) — likely a missing one on the paste-blobs path or one that fires before the modal teardown returns focus to `<body>`.
- Make the terminal pane's wrapping element a focus-on-click target with a much larger hitbox (the whole `<main>` / terminal container, not just the prompt row inside xterm). Clicking anywhere over the terminal should `term.focus()` — xterm has `screenReaderMode`/`focus()` API; wrap the container in a click handler that delegates.
- Verify keyboard routing fallback: if the active session is known and no contenteditable/input is focused, a top-level keydown listener could forward to `state.terms[active].term.focus()` before the keystroke is lost. Be careful not to break legitimate focus on the sidebar / search box.
- Test interplay with the connection lozenge, version lozenge, paste modal overlay, toast — any of these may be capturing focus on dismiss.

Related shipped work that may have nudged this regression into view: `2026-05-20-paste-blobs` (drag/paste overlay), `2026-05-19-relocate-connection-lozenge-into-sidebar`, `2026-05-16-ctrl-v-paste`.
