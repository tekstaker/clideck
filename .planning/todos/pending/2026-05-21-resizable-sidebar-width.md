---
created: 2026-05-21
title: Resizable left sidebar with terminal reflow
area: ui
files:
  - public/index.html
  - public/js/app.js
  - public/tailwind.css
---

## Problem

The left-hand sidebar (sessions / projects panel) is a fixed width. Lance wants it stretchy — drag-resizable so he can make it narrower (more terminal width) or wider (longer session names / project paths visible). The terminal pane should reflow to fill whatever width is left.

## Solution

TBD — likely:
- Add a draggable gutter element between `<aside>` and `<main id="main">`. CSS `cursor: col-resize`, narrow hit area but generous hover-grow for ergonomics.
- Track sidebar width in localStorage (no need to round-trip through the server — purely UI preference). Apply on load before first paint to avoid flash.
- Constrain min/max (e.g. 220px min so session controls stay usable, max ~50% of viewport).
- On drag end: iterate `state.terms`, call each terminal's `fitAddon.fit()` and broadcast PTY `resize` so the shell knows the new cols/rows.
- Mobile/narrow-viewport behavior: keep the existing mobile-nav overlay logic; the drag handle only activates above the `(max-width: 960px)` breakpoint.
- Probably worth a "double-click handle to reset to default width" affordance.

Related to [[terminal-font-size-control]] — both are user-adjustable terminal sizing; could ship together as a "Display" settings group.
