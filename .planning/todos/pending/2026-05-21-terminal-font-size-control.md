---
created: 2026-05-21
title: Terminal font size control
area: ui
files:
  - public/js/terminals.js
  - public/js/settings.js
  - public/index.html
---

## Problem

The terminal pane currently renders at a fixed xterm.js font size. Lance wants to be able to change the text size in the terminal pane — bigger when he's reading at a distance / on a 4K display, smaller when he wants more terminal real estate. There's no UI for this today.

## Solution

TBD — likely:
- Add a `terminalFontSize` (or `terminalZoom`) field to the config persisted by `config.js`.
- Settings → Appearance (or General) gets a size control: number input, slider, or +/- buttons. Could also wire `Ctrl/Cmd + =` and `Ctrl/Cmd + -` keyboard shortcuts inside a focused terminal.
- On change: iterate `state.terms` and update each xterm instance's `options.fontSize`, then call `fitAddon.fit()` so cols/rows recompute and the PTY resize message goes out.
- Persist across reloads via the same config.save() path used by other appearance settings.
- Consider whether this is global or per-session (start global, simpler).
