# SPEC — Terminal interaction polish

**Status:** done (closed out 2026-05-20 — commit `8fa1def`)
**Owner:** Lance Keay
**Date:** 2026-05-19

## What this delivers

Two terminal-interaction improvements that share the same per-terminal
init hook in `public/js/terminals.js` and the same overarching
constraint: **plain click must continue to start a text selection**.
Both features are common-modern-terminal ergonomics that clideck is
missing.

1. **Auto-copy on selection.** When the user selects text in a
   terminal, the selection is automatically copied to the system
   clipboard on mouse-up. A short toast confirms the copy. Today the
   user has to select → right-click → Copy (three actions); this
   collapses it to one.
2. **Ctrl+click to open URLs in a new tab.** When a URL appears in
   terminal output (agent log, build URL, dashboard link, etc.),
   Ctrl+click (Cmd+click on Mac) opens it in a new browser tab. Today
   the user has to select the URL, copy it, switch to a browser, and
   paste — four steps where modern terminals offer one click.

## Why

Both are friction points Lance hits often:

- The right-click → Copy flow on selection is muscle memory from
  older terminals, but every modern terminal Lance uses (Windows
  Terminal, iTerm2, VS Code's embedded terminal) auto-copies. clideck
  currently lags this baseline.
- Agent output frequently contains URLs (build dashboards, error
  trace links, documentation, repo URLs from search results). Right
  now they're inert text — Lance has to round-trip through the
  clipboard to act on them.

Both features need to coexist with plain-click text selection. The
Ctrl modifier on the URL feature is exactly the disambiguator: plain
click starts a selection, Ctrl+click activates the URL. The auto-copy
feature triggers on the *release* of a selection drag, not on plain
click — so the two never collide.

## Scope

**In scope**

### Auto-copy on selection

- Listen for `pointerup` on the terminal container element after a
  drag-selection. On release, check `term.hasSelection()` and call
  the existing `copyTerminalSelection(sessionId)` helper at
  `public/js/terminals.js:141-150` (don't fork a second copy path).
- Hook point: in `addTerminal()` around `public/js/terminals.js:520`,
  right after `state.terms.set(id, …)`. Attach the listener with the
  terminal-container scope so the lifecycle matches the term itself.
- Store the cleanup in the entry so `removeTerminal()` at
  `public/js/terminals.js:528` can detach it.
- On successful copy, fire
  `showToast('Copied', { id: 'terminal-copy', type: 'success', duration: 1200 })`.
  Fixed `id` dedupes rapid back-to-back copies into a single toast
  that resets its timer instead of stacking. Duration is short —
  this is feedback, not a notification.
- Skip empty selections (the `copyTerminalSelection` helper already
  early-returns on empty text at line 144); also short-circuit the
  pointerup handler with `!term.hasSelection()` so a plain click
  doesn't touch the clipboard.
- Keep the existing context-menu "Copy" action at
  `public/js/terminals.js:175-180` and the dispatch at
  `public/js/terminals.js:239-241`. Both paths feed
  `copyTerminalSelection()`; auto-copy is additive.

### Ctrl+click to open URLs

- Add the dependency `@xterm/addon-web-links` (compatible with the
  existing `@xterm/xterm@^6.0.0` / `@xterm/addon-fit@^0.11.0` stack).
- Vendor the built addon to match how `@xterm/xterm` is shipped
  today (see `public/index.html`'s `<script src="/xterm.js">` tag).
  Match the existing vendoring pattern; don't switch to ES module
  imports unless that change is already planned project-wide.
- In `addTerminal()` at `public/js/terminals.js:520`, register the
  addon with an `activate` callback that:
  - **Requires Ctrl or Cmd modifier** to fire:
    `if (!(event.ctrlKey || event.metaKey)) return;`
  - **Restricts to http(s) schemes**:
    `if (!/^https?:\/\//i.test(uri)) return;` (defence-in-depth on
    top of the addon's default URL regex).
  - **Opens with hardened flags**:
    `window.open(uri, '_blank', 'noopener,noreferrer');`
- The default underline-on-hover behavior of the addon is
  sufficient affordance; no custom hover handler needed in v1.
- Store the addon instance on the term entry so disposal is clean
  on `removeTerminal()`.

**Out of scope**

- Auto-detection of non-URL patterns (file paths, ticket IDs, IPs).
  The addon supports custom link providers for these but it's
  out-of-scope for v1.
- Inline preview / link unfurling on hover.
- Touch-device behavior (no Ctrl key). Desktop-only for v1; revisit
  if a touch user reports it.
- Linux X11 PRIMARY selection ("select-to-paste with middle-click").
  Browsers don't expose PRIMARY through `navigator.clipboard`;
  document as a known limitation, do not try to emulate.
- User-toggleable preferences (auto-copy on/off, require modifier
  for plain-click URL open, etc.). Always-on for both v1; revisit
  if anyone wants to disable.

## Acceptance criteria

### Auto-copy

1. Selecting text in an active terminal by mouse-drag and releasing
   results in the selected text being on the system clipboard
   without any further user action.
2. A toast appears reading "Copied" (or equivalent), visible for
   roughly 1.2 seconds, and **does not stack** when the user makes
   several selections in quick succession.
3. A plain click (no drag, no selection) does NOT touch the
   clipboard. The toast does NOT appear.
4. The existing right-click → Copy context-menu action continues to
   work and continues to use the same `copyTerminalSelection()`
   code path.
5. Clipboard write failures (permissions denied, etc.) surface an
   error toast — the existing error path at
   `public/js/terminals.js:147-149` already handles this.
6. The selection-listener is cleaned up when the terminal is removed
   (no leaks across `removeTerminal()`).

### Ctrl+click URLs

7. A URL printed into a terminal renders with an underline on hover
   indicating it is interactive.
8. **Plain click** on a URL inside a terminal does NOT open it; it
   starts a selection like any other terminal text. This protects
   the auto-copy gesture above and is the explicit user-stated
   requirement.
9. **Ctrl+click (Windows/Linux) or Cmd+click (Mac)** on a URL opens
   that URL in a new browser tab.
10. Non-http(s) URIs (`javascript:`, `file:`, `data:`, etc.) are
    NOT opened even under Ctrl+click.
11. The opened tab has `noopener` and `noreferrer` — verified by
    inspecting `window.opener` in the destination tab and inspecting
    the request's Referer header in devtools.
12. The clickable-URL handler is cleaned up when the terminal is
    removed.

### Cross-cutting

13. All existing Vitest unit suites pass.
14. All existing Playwright smoke + Ctrl+V paste E2E suites pass.
    (The Ctrl+V paste path is separate from Ctrl+click on URLs; no
    interaction is expected, but verify.)

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub.
- Plain click in the terminal MUST continue to start a text
  selection. This is the load-bearing constraint shared by both
  features. Any implementation that breaks this — for example, an
  earlier draft that hooked the addon's default `click → open URL`
  behavior — is unacceptable.
- The Ctrl/Cmd modifier check MUST live in the `activate` callback,
  not in the addon's default config. The addon defaults to opening
  on plain click; that default must be explicitly overridden.
- All `window.open` calls for terminal-origin URLs MUST include
  `noopener,noreferrer`. Terminal content is untrusted text.
- Schemes other than http and https MUST be rejected in the
  `activate` callback even if the addon's built-in regex lets them
  through.

## Implementation pointers

- Per-terminal hook: `public/js/terminals.js:520` (right after
  `state.terms.set(id, …)`).
- Cleanup site: `public/js/terminals.js:528-547` (`removeTerminal()`).
- Existing copy path to reuse: `public/js/terminals.js:141-150`
  (`copyTerminalSelection`).
- Existing context-menu Copy that must keep working:
  `public/js/terminals.js:175-180` (button) and `:239-241` (dispatch).
- xterm.js vendoring pattern: `public/index.html` `<script>` and
  `<link>` references.
- Toast helper: `showToast` from `public/js/toast.js`, imported in
  `app.js:10`. Use a fixed `id` for the copy-confirmation toast so
  rapid copies coalesce.

## Interaction note (for the next phase)

This phase intentionally pairs with `2026-05-19-session-pause`
indirectly: both rely on session state machinery being consistent
across active and dormant sessions. No code dependency, but if
session-pause lands first, verify that auto-copy / clickable URLs
work correctly when a paused session is resumed (the terminal is
re-created, so the per-terminal hook fires again as expected).
