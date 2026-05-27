# SPEC — Terminal focus / Enter-submit reliability

**Status:** planned (not yet discussed/planned — seeded from a pending todo 2026-05-27)
**Owner:** Lance Keay
**Date:** 2026-05-27

## What this delivers

Make keyboard input — Enter especially — reliably reach the active terminal's
PTY without requiring a precise click on the prompt line first. Today, after
typing into or (most visibly) pasting into the terminal pane, focus is on
`<body>` or a hidden element rather than the xterm instance, so Enter is a no-op
until the user clicks the narrow prompt-line hitbox to re-focus — sometimes
several times before the click lands.

This is the "terminal-ux v2" focus-management work — a distinct concern from the
sizing controls in `terminal-display-sizing`, hence its own phase.

## Why

A per-interaction friction toll Lance hits constantly, worst right after a paste:
the pasted text is visibly sitting at the cursor inside the terminal, but Enter
does nothing until the terminal is re-focused with a click. The narrow clickable
target on the prompt line makes the click-to-refocus dance especially fiddly.

Likely a regression nudged into view by recently shipped work that adds
focus-stealing overlays/elements: `2026-05-20-paste-blobs` (drag/paste overlay),
`2026-05-19-relocate-connection-lozenge-into-sidebar`, `2026-05-16-ctrl-v-paste`.

## Scope

**In scope**

- **Audit real focus vs. apparent focus.** Determine when the xterm instance
  actually holds keyboard focus vs. when the pane merely *looks* active while
  focus sits on `body` / a hidden element (modal backdrop, paste handler, toast
  button, dismissed lozenge).
- **Restore focus after every paste flow.** After `Ctrl+V`, the drag-and-drop
  modal, and the file-picker path, explicitly `entry.term.focus()` once the paste
  handler resolves and any modal/overlay teardown completes (teardown must not
  hand focus back to `<body>` after the term re-focuses). Existing `term.focus()`
  calls live in `terminals.js` (~772, 1035, 1048, 1079, 1286) — find the missing
  or mis-ordered one on the paste-blobs path.
- **Bigger focus-on-click target.** Make the whole terminal container
  (`<main>` / the terminal wrapper, not just the xterm prompt row) a click target
  that delegates to `term.focus()`, so clicking anywhere over the terminal
  re-focuses it.
- **Keyboard-routing fallback (carefully).** Consider a top-level keydown listener
  that, when the active session is known and no contenteditable/input/search box
  is focused, forwards focus to `state.terms[active].term` before the keystroke is
  lost — without hijacking legitimate focus on the sidebar or search box.

**Out of scope**

- Reworking the paste features themselves (paste-blobs is shipped; this only fixes
  focus return).
- Touch-device focus behaviour (desktop-first; revisit if reported).
- Configurable focus policy / preferences — always-on correct behaviour for v1.

## Acceptance criteria

1. Immediately after a `Ctrl+V` paste into the active terminal, pressing Enter
   submits to the PTY with no intervening click.
2. Same for a drag-and-drop file paste (drop overlay dismissed → Enter works).
3. Same for the file-picker paste path.
4. Clicking anywhere over the terminal pane (not just the prompt row) re-focuses
   the terminal.
5. The keyboard-routing fallback (if implemented) does NOT steal focus from the
   sidebar search box or any open input/contenteditable.
6. Dismissing the connection lozenge, version lozenge, paste modal, or a toast
   leaves keyboard focus on the active terminal, not `<body>`.
7. All existing Vitest unit suites pass.
8. All existing Playwright smoke + paste E2E suites pass; ideally add an E2E that
   pastes then sends Enter and asserts the PTY received the line.

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub.
- Per the project version-bump rule, bump `package.json` patch on the
  code-changing commit so the connection lozenge reflects the new build.
- The fallback keydown forwarder is the riskiest piece — it must be additive and
  must never break focus on legitimate form controls. Prefer the explicit
  paste-path `focus()` fixes first; only add the global fallback if those don't
  fully close the gap.

## Source todo

Seeded from (and supersedes for tracking purposes):

- `.planning/todos/completed/2026-05-22-terminal-auto-focus-for-enter-submit.md`

Carries fuller solution notes and the candidate `term.focus()` line numbers. Not
yet through `/gsd-discuss-phase` or `/gsd-plan-phase` — refine before executing.
