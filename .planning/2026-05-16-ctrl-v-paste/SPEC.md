# SPEC — Ctrl+V paste binding for clideck terminals

**Status:** in progress
**Owner:** Lance Keay
**Date:** 2026-05-16

## What this delivers

Pressing **Ctrl+V** (Windows/Linux) or **Cmd+V** (macOS) in any clideck terminal
pastes the current clipboard contents into the active session's PTY, matching
the existing right-click → Paste behavior.

## Why

xterm.js does not bind Ctrl+V by default. clideck's right-click Paste menu
calls `pasteIntoTerminal(sessionId)` which uses `navigator.clipboard.readText()`
and sends to the PTY — that works. But the bare Ctrl+V keydown falls through to
xterm.js's hidden textarea, no handler claims it, and xterm.js forwards the
raw `0x16` (`^V`) byte to the PTY. The Claude Code / Codex / Gemini TUIs ignore
`^V`, so the user sees nothing happen.

This impacts:

- **Every Windows user pressing Ctrl+V manually** in a clideck terminal.
- **Every dictation tool** that synthesizes Ctrl+V to deliver transcribed text
  (TypeWhisper, Talon, Whispering, Dragon, etc.) — confirmed by reviewing
  TypeWhisper's `TextInsertionService.cs` which uses the standard
  write-clipboard-then-synthesize-Ctrl+V flow.

Shift+Insert and right-click → Paste already work; the conventional shortcut
should match.

## Scope

**In scope**

- Register `Ctrl+V` in `public/js/hotkeys.js` registry from `public/js/terminals.js`,
  reusing the existing `pasteIntoTerminal(state.active)` function.
- The hotkey dispatcher calls `preventDefault()` + `stopPropagation()`, so
  xterm.js will no longer also forward `^V` to the PTY.
- `normalizeCombo` already collapses `Cmd`/`Meta` → `Ctrl`, so a single
  registration covers macOS too.
- Vitest + happy-dom test framework introduced (project has none today).
- Tests covering the wiring, Cmd+V parity, preventDefault, null-active no-op,
  input-element pass-through, existing-hotkey non-regression, and registry
  dedup.

**Out of scope**

- Shift+Insert — already works via xterm.js built-in, untouched.
- Keyboard customization UI.
- Any other hotkey, refactor, or nearby bug. Per CONTRIBUTING.md: one change per PR.
- Upstream PR against `rustykuntz/clideck` — a follow-up consideration.

## Acceptance criteria

1. Pressing Ctrl+V with an active terminal pastes the clipboard text into that
   terminal's PTY via `send({ type: 'input', id, data })`.
2. Cmd+V (macOS, `metaKey` set, no `ctrlKey`) behaves identically.
3. The intercepted Ctrl+V does not produce a raw `0x16` on the PTY.
4. Ctrl+V inside an `<input>`, `<textarea>`, or `contentEditable` element
   outside any terminal is **not** intercepted — the browser's native paste
   continues to work.
5. With no active terminal (`state.active === null`), Ctrl+V is a no-op and
   does not throw.
6. Existing hotkeys (`Ctrl+Shift+K`, `Cmd+K` for clear) continue to work.
7. The registry's "already registered" dedup behavior is unchanged.
8. All tests pass under `npm test`.

## Non-goals / explicit constraints

- Do **not** push to `origin`. Lance reviews before any push to GitHub.
- Keep the production-code diff minimal — handoff estimate is <30 lines.
- Match existing code style (vanilla JS ES modules, no semicolon toggling,
  pattern after `clearTerminal` registration block).
