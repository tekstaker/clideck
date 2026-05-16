# Handoff: Ctrl+V paste fix for clideck (fork)

**Read this first.** Everything you need to execute this fix is below. The diagnosis is done — no re-investigation needed. Your job is to plan and execute the fix via GSD with TDD.

---

## TL;DR

clideck's xterm.js setup doesn't bind `Ctrl+V` to paste. Synthesized `Ctrl+V` (from voice-to-text tools like TypeWhisper) and manual `Ctrl+V` both fall through to the PTY as raw `^V` control char and do nothing. `Shift+Insert` already works (xterm.js default). Right-click → Paste already works (uses `pasteIntoTerminal()` at `public/js/terminals.js:152`). Fix is to wire `Ctrl+V` and `Cmd+V` to call the existing `pasteIntoTerminal()` via the existing hotkey registry.

Estimated diff: <30 lines of production code + tests + a Vitest setup.

---

## Project context

- **Repo:** fork of `rustykuntz/clideck` at `https://github.com/tekstaker/clideck` (origin already set).
- **What clideck is:** local web app at `localhost:4000` that runs Claude Code / Codex / Gemini CLI / OpenCode in browser-rendered terminals (xterm.js + node-pty + ws).
- **Git identity:** already set locally for this repo to `Lance Keay <github@lancetek.com>`. Verify with `git config --get user.email`. Don't change.
- **Push policy:** GitHub remote — **commit but do NOT push.** Per global CLAUDE.md, only Gitea remotes get auto-pushed. Lance will review and push.
- **CONTRIBUTING.md rule:** one change per PR. Keep this PR scoped to *just* the Ctrl+V paste fix + its tests + the test framework setup. Don't refactor, don't fix nearby bugs.

---

## Diagnosis (already verified in prior session — don't redo)

**Symptom:** TypeWhisper transcribes voice → writes text to Windows clipboard → synthesizes `Ctrl+V` (via `SendInput`) to the focused window. In clideck, nothing pastes. Manual `Ctrl+V` in the terminal also doesn't paste. But `Shift+Insert` does paste. And right-click → Paste does paste.

**Root cause:** xterm.js does not bind `Ctrl+V` by default. With clideck's current setup, the keydown reaches xterm.js's hidden textarea, no handler claims it, and xterm.js forwards it to the PTY as the literal control character `0x16` (`^V`). The Claude Code TUI ignores `^V`. `Shift+Insert` works because xterm.js has a built-in paste handler for it. Right-click works because clideck wires it to `pasteIntoTerminal()`.

**TypeWhisper is innocent.** Source review of `TextInsertionService.cs` confirms it uses the correct clipboard-write-then-Ctrl+V flow. Same problem would affect any dictation tool that synthesizes Ctrl+V (most of them) and any user pressing Ctrl+V manually.

**What clideck already has that we can reuse:**

- `public/js/terminals.js:152` — `pasteIntoTerminal(sessionId)` — reads `navigator.clipboard.readText()` and sends to the PTY via `send({ type: 'input', id: sessionId, data: text })`. Already wired to right-click Paste menu (line 241–242). Works.
- `public/js/hotkeys.js` — central hotkey registry. `registerHotkey(pluginId, combo, callback)` + `attachToTerminal(term, presetId)` wires xterm.js's `attachCustomKeyEventHandler` to dispatch keydowns through the registry. **`dispatch()` calls `preventDefault()` + `stopPropagation()`**, which prevents xterm.js from also forwarding the key to the PTY — exactly what we need. Existing precedent: `Ctrl+Shift+K` and `Cmd+K` are already registered for clear (terminals.js:1350–1351).
- `normalizeCombo` (hotkeys.js:33) treats `Cmd`/`Ctrl`/`Meta` as the same `Ctrl` token, so a single `Ctrl+V` registration handles both Windows and Mac.

---

## Proposed fix

**One file changes in production code: `public/js/terminals.js`.**

Add near the existing `clearTerminal` hotkey registration at the bottom of the file (around line 1350):

```js
// Ctrl+V / Cmd+V — paste clipboard into active terminal.
// xterm.js doesn't bind Ctrl+V by default; without this it falls through to the
// PTY as raw ^V (0x16) and does nothing. Right-click Paste and Shift+Insert
// already work; this brings the conventional shortcut into line.
const pasteActive = () => {
  if (state.active) pasteIntoTerminal(state.active);
};
registerHotkey('core', 'Ctrl+V', pasteActive);
```

That's it. `normalizeCombo` collapses Cmd → Ctrl so Mac users get it free. `pasteIntoTerminal` already exists and is exported in-module. `state` is already imported. `registerHotkey` is already imported.

---

## TDD plan (red → green → refactor)

The project currently has **no test framework**. Per global CLAUDE.md rule 2, set one up before the feature. Recommended:

- **Vitest** + **happy-dom** (lightweight DOM, faster than jsdom, ESM-native). Project is `"type": "commonjs"` but the frontend uses ES modules. Vitest handles both transparently.
- Add `vitest` and `happy-dom` to `devDependencies`. Add `"test": "vitest run"` and `"test:watch": "vitest"` to scripts.
- Test file location: `tests/` at repo root. New file: `tests/hotkeys-paste.test.js`.

### Test list (write failing first, one by one)

| # | Test                                                                                                                | Verifies                                  |
|---|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------|
| 1 | Pressing Ctrl+V inside an attached xterm terminal invokes `pasteIntoTerminal(state.active)`                         | Wiring works (the core fix)               |
| 2 | The Ctrl+V keydown has `preventDefault()` + `stopPropagation()` called (i.e., xterm.js will NOT also receive `^V`) | No regression: PTY doesn't get junk input |
| 3 | Cmd+V (metaKey, no ctrlKey) is handled by the same registration (normalizeEvent treats Meta as Ctrl)                | Mac parity                                |
| 4 | Ctrl+V with `state.active === null` is a graceful no-op (doesn't throw)                                             | Defensive — no active terminal            |
| 5 | Ctrl+V in a real `<input>` / `<textarea>` outside the terminal is NOT intercepted (browser default paste still fires) | No regression: forms still paste normally |
| 6 | Ctrl+Shift+K still clears the active terminal (existing hotkey untouched)                                           | No regression to other hotkeys            |
| 7 | Registering `Ctrl+V` twice logs the existing warn and ignores the second (registry dedup behavior unchanged)         | No regression to registry                 |

The dispatcher path is `hotkeys.js:48 dispatch(e)` — happy-dom can simulate `KeyboardEvent`s. The xterm-side path (`attachToTerminal` → `attachCustomKeyEventHandler`) needs a stub for the xterm.js `Terminal` since happy-dom can't render a real terminal. Stub `term.attachCustomKeyEventHandler` as a function that stores the handler so the test can invoke it directly with a fake keyboard event.

Mock `pasteIntoTerminal` with `vi.fn()` so test 1 can assert call args. Either re-export it for test access or use a module-level spy via `vi.spyOn`.

---

## Test gap checklist (Nyquist — run after green)

Use `/gsd-validate-phase` to audit, or check manually:

- [ ] Ctrl+V with focused terminal (test 1)
- [ ] Ctrl+V with unfocused terminal i.e. no `state.active` (test 4)
- [ ] Cmd+V on Mac path (test 3)
- [ ] Ctrl+V in an `<input>` / `<textarea>` outside terminal — should pass through (test 5)
- [ ] Ctrl+V in `contentEditable` element — should pass through (extension of test 5)
- [ ] preventDefault + stopPropagation fired on intercepted Ctrl+V (test 2)
- [ ] Empty clipboard — `pasteIntoTerminal` already silently no-ops via the `if (text)` guard at terminals.js:155, but assert it doesn't throw
- [ ] Clipboard read denied (`navigator.clipboard.readText` rejects) — `pasteIntoTerminal` catches and shows toast; assert no throw to dispatcher
- [ ] Multi-line clipboard content — sent as one `input` payload (no `^M`/`\r` splitting on the websocket boundary)
- [ ] Other registered hotkeys still fire (test 6)
- [ ] Registry dedup unchanged (test 7)

Note xterm.js's built-in `Shift+Insert` paste is NOT exercised by these tests because it goes through xterm.js internals, not the dispatcher. Confirm manually that it still works after the change.

---

## GSD workflow to follow

This new session is starting in `C:\_Projects\clideck` so GSD will write `.planning/` to the correct location.

1. **`/gsd-progress`** — orient. Will see no `.planning/`, will suggest bootstrapping.
2. **`/gsd-new-project`** — bootstrap GSD on the fork. When it asks project context questions, answer briefly:
   - Project: fork of clideck for Windows/dictation paste fix (and possibly future ergonomics fixes)
   - Stack: Node 18+, vanilla JS ES modules frontend, xterm.js v6, node-pty, ws
   - Style: match existing (no linter; commonjs backend, ESM frontend); one change per PR per CONTRIBUTING.md
3. **`/gsd-spec-phase`** — produce SPEC.md for "Ctrl+V paste binding". WHAT it delivers: pressing Ctrl+V (or Cmd+V) in any clideck terminal pastes clipboard contents into the active session, matching the existing right-click Paste behavior. Out of scope: Shift+Insert (already works), keyboard customization UI, other hotkeys.
4. **`/gsd-plan-phase`** — produce PLAN.md. Order: (a) install Vitest + happy-dom + write test infra, (b) write failing test 1, (c) implement the registration, (d) run test green, (e) add tests 2–7, (f) refactor if needed. Commit after each green step.
5. **`/gsd-execute-phase`** — run it. Atomic commits per CLAUDE.md. Do NOT push.
6. **`/gsd-validate-phase`** — audit gaps against the Nyquist checklist above.
7. **`/gsd-code-review`** — review the diff for bugs/quality before considering done.
8. **Manual verification (mandatory per CLAUDE.md rule 1):** `node server.js`, open `http://localhost:4000`, open a terminal, dictate via TypeWhisper, confirm paste. Try manual `Ctrl+V` from Ditto. Confirm `Shift+Insert` still works. Confirm `Ctrl+Shift+K` still clears.

---

## Constraints summary

- **Git identity:** `Lance Keay <github@lancetek.com>` (already set locally, don't touch).
- **Push:** commit, do NOT push. Lance reviews before push to GitHub.
- **PR scope:** Ctrl+V paste fix + tests + Vitest setup. Nothing else. Don't bundle dep changes beyond Vitest + happy-dom.
- **Commit messages:** verbose / beautiful per global CLAUDE.md (this is a personal-context fork, not a client project). Include why, what, trade-offs, test results.
- **Match style:** vanilla JS, no semicolons-vs-not toggles, no import reordering. Look at surrounding hotkey registrations for the pattern.

---

## After landing

Once the fix is committed and verified:

- Remove the temporary AHK workaround at `C:\_Projects\utils\clideck-paste-fix.ahk` (no longer needed once the fork's running locally with the fix).
- Consider whether to open an upstream PR against `rustykuntz/clideck`. Per their CONTRIBUTING.md, bug fixes are accepted directly without a Discussion first. Diff is small, well-scoped, has tests, and benefits every Windows user with any dictation tool. Worth offering upstream.

---

## Phrase to start the new session

After `cd C:\_Projects\clideck` and starting Claude Code there, paste:

> Read HANDOFF.md and execute the Ctrl+V paste fix using GSD with TDD as described. Commit but don't push.
