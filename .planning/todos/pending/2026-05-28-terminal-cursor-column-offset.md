---
created: 2026-05-28
title: Terminal cursor is one column off — edits land in the wrong position
area: ui
files:
  - public/js/terminals.js
  - src/input.css
  - public/index.html
---

## Problem

The cursor in the terminal pane is misaligned by **one character** horizontally
— it sits one cell to the right (or left) of where the actual insertion point is.
The practical symptom: when editing a line, characters get inserted/overwritten in
the wrong position relative to where the cursor *appears* to be. Makes in-terminal
editing (shell line-editing, a TUI, an agent's prompt editor) error-prone — you
aim at one spot and the edit lands a column over.

Lance isn't sure whether it's consistently left or right ("off to the right or the
left"), which itself points at a **column-width / cell-grid measurement** problem
rather than a fixed ±1 constant — the visible cursor cell and xterm's internal
column model have drifted out of agreement.

## Solution

TBD — needs diagnosis first. This is the classic xterm.js "columns drift" family
of bug. Leading suspects, roughly in order:

1. **Font-metrics mismatch (most likely).** Terminal is created with
   `fontFamily: 'Menlo, Monaco, "Courier New", monospace'` at
   `public/js/terminals.js:~503`. Menlo/Monaco don't exist on Windows, so it
   falls back to Courier New / generic monospace. If the font xterm *measures* the
   cell width from differs from the font actually rendered (or the webfont/system
   font isn't ready at measure time), the cell grid is computed wrong and the
   cursor lands a column off. Check: does pinning a known-present Windows monospace
   (e.g. `Consolas, "Cascadia Mono", monospace`) fix it? Does it only happen at
   certain font sizes / DPI / browser zoom?

2. **Renderer choice.** Which xterm renderer is active (DOM vs canvas vs WebGL)?
   The canvas/WebGL renderers measure char width differently from the DOM
   renderer; a fractional cell width can accumulate into a one-column offset.
   Check whether an addon (`@xterm/addon-webgl` / canvas) is loaded and whether
   the offset changes with the renderer.

3. **CSS perturbing the cell box.** `src/input.css` has terminal-wrapper styles
   (~lines 243-255). Any `letter-spacing`, non-integer `line-height`, padding, or
   a `transform: scale()` on the terminal container throws off xterm's width
   measurement. Audit for anything touching the xterm viewport box.

4. **Measure-before-fonts-ready / fit timing.** If `fit.fit()` (and the initial
   char-measure) runs before the font is loaded, cols are computed against the
   fallback metrics, then the real font paints at a different width. Consider
   `document.fonts.ready` before the first measure/fit, or an
   `xterm.loadAddon`-time remeasure.

5. **DPR / zoom interaction.** Reproduce at 100% browser zoom and a non-100% zoom;
   fractional device-pixel-ratio is a known source of off-by-one cell rendering.

Diagnostic approach: reproduce in a throwaway :4099 instance (see
[[feedback-verify-clideck-ui-altport-playwright]]) so we can poke
`term.cols`/measured cell width and try font/renderer swaps without touching the
host. Confirm the fix by typing a long line and backspacing/editing mid-line to
see the cursor and the actual edit point coincide.

## Relation to other phases

Touches the same font-metrics territory as **Phase 9 — terminal-display-sizing**
([[../2026-05-27-terminal-display-sizing/CONTEXT.md]]): changing `fontSize` runs
the same measure→fit path, so whatever fixes this should be re-verified across the
new font-size range, and Phase 9 work should be verified to not reintroduce the
offset. Keep them as **separate** items — this is a rendering-correctness bug; Phase
9 is a feature. If Phase 9 is built first, fold a "cursor stays aligned at all
sizes" check into its UAT.
