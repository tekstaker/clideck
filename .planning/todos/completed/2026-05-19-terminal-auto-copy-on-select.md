---
created: 2026-05-19T11:48:00Z
title: Auto-copy terminal selection to clipboard with confirmation toast
area: ui
phase_hint: 2026-05-19-terminal-ux
ingested_into: .planning/2026-05-19-terminal-ux/SPEC.md (deliverable 1)
ingested_at: 2026-05-19
files:
  - public/js/terminals.js:141-150
  - public/js/terminals.js:520
  - public/js/terminals.js:175-180
  - public/js/terminals.js:239-241
---

## Problem

To copy text from a terminal today, Lance has to:
1. Select with the mouse
2. Right-click to open the context menu
3. Click "Copy"

That's two extra clicks beyond the natural "select to copy" gesture
that most modern terminals (Windows Terminal, iTerm2, gnome-terminal
with the right setting) offer.

The desired behavior:
- Select text in a terminal → text is **immediately** placed on the
  system clipboard when the selection is committed (mouse-up).
- A short toast appears confirming the copy ("Copied to clipboard" or
  similar) so there's positive feedback the action succeeded — no
  silent no-op.

Keep the context-menu "Copy" item — it's still useful for keyboard /
accessibility paths and as a fallback when the auto-copy fails.

## Solution

xterm.js exposes an `onSelectionChange(callback)` event on the
`Terminal` instance. The plan:

1. **Hook point.** In `public/js/terminals.js:520`, right after
   `state.terms.set(id, …)`, attach
   `term.onSelectionChange(() => maybeAutoCopy(id))`. Store the
   disposable in the term entry so `removeTerminal` (line 528) can
   call `.dispose()` and prevent leaks.

2. **Copy-on-release semantics.** `onSelectionChange` fires on every
   selection mutation, including mid-drag. Auto-copying mid-drag is
   wasteful and would spam the toast. Two options:
   - **Throttle / debounce** to the last selection state ~150ms after
     the final change event.
   - **Listen for `pointerup` on the terminal element** and trigger
     the copy then, reading `term.getSelection()` at release time.
     This is closer to the user's mental model ("when I let go").
     Prefer this; it also avoids copying ephemeral selections from
     keyboard shortcuts or programmatic selection changes.

3. **Reuse existing copy path.** `copyTerminalSelection(sessionId)`
   already exists at `terminals.js:141-150` and does the right thing
   (gets the selection, writes to clipboard, shows an error toast on
   failure). Wire the new auto-copy through it — don't fork a second
   implementation.

4. **Success toast.** On successful write, fire
   `showToast('Copied', { id: 'terminal-copy', type: 'success', duration: 1200 })`.
   Using a fixed `id` deduplicates back-to-back copies into a single
   toast that resets its timer rather than stacking. Keep the
   duration short — this is feedback, not a notification.

5. **Skip empty selections.** `copyTerminalSelection` already returns
   early when `text` is empty (line 144). No change needed, but the
   pointerup handler should also skip if `!term.hasSelection()` to
   avoid touching the clipboard at all when the user clicks without
   dragging — a tap on an unrelated UI element shouldn't trigger a
   clipboard write.

## Pitfalls

- **Permissions.** `navigator.clipboard.writeText` requires the page
  to be focused and (in some browsers) a recent user gesture. The
  pointerup handler IS a user gesture, so this should be fine —
  but watch for headless / iframe contexts. The existing copy path
  already catches and toasts the error case (line 147-149); keep
  that behavior.
- **Auto-copy + paste interaction with PRIMARY selection on Linux.**
  Linux X11 has a separate PRIMARY clipboard for select-to-copy that
  middle-click pastes from. Browsers don't expose PRIMARY through
  `navigator.clipboard`, so we'll always write to the regular
  clipboard. Document this as a known limitation; don't try to
  emulate PRIMARY.
- **xterm.js word/triple-click selection.** Double-clicking a word
  fires a single `onSelectionChange` but no drag-then-pointerup
  sequence. The pointerup path needs to fire on `pointerup` after
  *any* selection-altering action, not just drags. Easiest: attach
  to `pointerup` regardless and check `hasSelection()` at handler
  time.
- **Persistence of context-menu Copy.** Leave the existing menu item
  at `terminals.js:175-180` and `terminals.js:239-241` alone — both
  paths feed into `copyTerminalSelection` and both should keep working.

## Out of scope

- A "right-click to paste" gesture (Windows Terminal style). That's a
  separate ergonomic ask; capture as a follow-up if it surfaces.
- A user-toggleable preference for auto-copy on/off. Build it always-on
  first; revisit if anyone wants to disable it.
