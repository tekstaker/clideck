# SPEC — Terminal display sizing

**Status:** planned (not yet discussed/planned — seeded from two pending todos 2026-05-27)
**Owner:** Lance Keay
**Date:** 2026-05-27

## What this delivers

Two user-adjustable "how big is my terminal" controls that share the same
post-change machinery (iterate `state.terms`, call each `fitAddon.fit()`, and
broadcast a PTY `resize` so the shell recomputes cols/rows). Bundled into one
phase because they touch the same code paths and naturally co-locate as a
"Display" settings group.

1. **Terminal font size control.** Change the xterm.js font size in the terminal
   pane — larger for reading at a distance / on a 4K display, smaller for more
   terminal real estate. No UI for this today.
2. **Resizable left sidebar with terminal reflow.** Make the fixed-width
   sessions/projects sidebar drag-resizable; the terminal pane reflows to fill
   whatever width is left.

## Why

Both are friction points Lance hits often:

- The terminal renders at a fixed font size; there's no way to zoom in/out per
  display or viewing distance.
- The sidebar is a fixed width — too narrow to read long session names / project
  paths, or too wide when Lance wants maximum terminal width. He wants it stretchy.

## Scope

**In scope**

### Terminal font size control

- Add a `terminalFontSize` (or `terminalZoom`) field to the config persisted by
  `config.js`.
- Settings → Appearance (or General) gets a size control: number input, slider,
  or +/- buttons. Optionally wire `Ctrl/Cmd + =` and `Ctrl/Cmd + -` shortcuts
  inside a focused terminal.
- On change: iterate `state.terms`, update each xterm instance's
  `options.fontSize`, then `fitAddon.fit()` so cols/rows recompute and the PTY
  resize message goes out.
- Persist across reloads via the same `config.save()` path other appearance
  settings use.
- Global (not per-session) for v1 — simpler.

### Resizable sidebar

- Draggable gutter element between `<aside>` and `<main id="main">`. CSS
  `cursor: col-resize`, narrow hit area with generous hover-grow for ergonomics.
- Track sidebar width in localStorage (purely a UI preference — no server
  round-trip). Apply on load before first paint to avoid flash.
- Constrain min/max (e.g. 220px min so session controls stay usable, max ~50%
  of viewport).
- On drag end: iterate `state.terms`, `fitAddon.fit()` each, broadcast PTY
  `resize`.
- Mobile/narrow-viewport: keep the existing mobile-nav overlay logic; the drag
  handle only activates above the `(max-width: 960px)` breakpoint.
- Double-click handle to reset to default width.

**Out of scope**

- Per-session font size (start global).
- Resizable/collapsible *right*-side panels (none exist yet).
- Persisting sidebar width server-side / syncing across devices (localStorage is
  fine for a single-host tool).

## Acceptance criteria

### Font size

1. A control in Settings changes the terminal font size and the change is visible
   immediately in all open terminals.
2. The new size survives a full browser reload (persisted via config).
3. After a size change, terminal cols/rows recompute (no clipped/overflowing
   output) and the PTY is told the new dimensions.
4. (If shortcuts shipped) `Ctrl/Cmd + =` / `Ctrl/Cmd + -` adjust size only when a
   terminal is focused, and don't hijack browser zoom in other contexts.

### Resizable sidebar

5. Dragging the gutter narrows/widens the sidebar; the terminal pane reflows to
   fill the remaining width.
6. Width is clamped to the min/max bounds — the sidebar can't be dragged so
   narrow its controls become unusable, nor past ~50% viewport.
7. The chosen width persists across reloads (localStorage) and applies before
   first paint (no visible jump).
8. On drag end, every open terminal re-fits and its PTY receives the new size.
9. Double-clicking the gutter resets to the default width.
10. Below the mobile breakpoint, the drag handle is inert and the existing
    mobile-nav overlay behaviour is unchanged.

### Cross-cutting

11. All existing Vitest unit suites pass.
12. All existing Playwright smoke + paste E2E suites pass.

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub.
- Per the project version-bump rule, bump `package.json` patch on the
  code-changing commit so the connection lozenge reflects the new build.

## Source todos

Seeded from (and supersedes for tracking purposes):

- `.planning/todos/completed/2026-05-21-terminal-font-size-control.md`
- `.planning/todos/completed/2026-05-21-resizable-sidebar-width.md`

Both carry fuller solution sketches and file/line pointers. This SPEC has not yet
been through `/gsd-discuss-phase` or `/gsd-plan-phase` — refine before executing.
