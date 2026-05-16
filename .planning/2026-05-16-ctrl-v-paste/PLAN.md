# PLAN — Ctrl+V paste binding

TDD: red → green → refactor. Commit after each green step.

## Step 1 — Test framework setup

- Add to `package.json` devDependencies: `vitest`, `happy-dom`.
- Add `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`.
- Add `vitest.config.js` configuring `environment: 'happy-dom'`.
- Run `npm install` (will update `package-lock.json`).
- Verify `npm test` runs (no tests yet → vitest exits 0 with "no test files" or
  similar; that's fine).
- **Commit:** "Add Vitest + happy-dom test framework"

## Step 2 — Failing test 1: Ctrl+V invokes pasteIntoTerminal

- Create `tests/hotkeys-paste.test.js`.
- Strategy: import `hotkeys.js` directly (its `dispatch` is internal but
  `registerHotkey` + `attachToTerminal` are exported). We'll exercise the
  outer document-level `keydown` path because that's the cleanest seam:
  `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true }))`
  with the event target set so `isInput` returns false.
- The test registers a fake callback through `registerHotkey('test', 'Ctrl+V', cb)`
  first to prove the registry dispatches — then asserts. But the *real* test
  we want is that **terminals.js wires Ctrl+V to pasteIntoTerminal**, so we
  also need to load `terminals.js`. Loading it has side effects (DOM creation,
  WebSocket attempts via state.js). To keep tests hermetic, mock `state.js`
  and `prompts.js` etc. via vitest mocks, then load `terminals.js` and assert
  that after import, a Ctrl+V keydown triggers `pasteIntoTerminal` with
  `state.active`.
- Easier approach: extract the Ctrl+V `pasteActive` closure as testable. But
  we said no refactors. So instead test through the registry's public surface:
  after importing `terminals.js`, `registerHotkey('test', 'Ctrl+V', ...)`
  should fail (already registered → returns false), proving the registration
  exists. Combined with a dispatch test that asserts `send` was called with
  the pasted text, that's the wiring proof.
- Run `npm test` → **red** (registration absent).
- **Commit:** "Add failing test for Ctrl+V paste hotkey"

## Step 3 — Implement registration (test 1 green)

In `public/js/terminals.js`, just below the existing `clearTerminal` block at
~L1345-L1351, add:

```js
// Ctrl+V / Cmd+V — paste clipboard into active terminal.
// xterm.js doesn't bind Ctrl+V by default; without this it falls through to
// the PTY as raw ^V (0x16) and does nothing. Right-click Paste and Shift+Insert
// already work; this brings the conventional shortcut into line.
const pasteActive = () => {
  if (state.active) pasteIntoTerminal(state.active);
};
registerHotkey('core', 'Ctrl+V', pasteActive);
```

- Run `npm test` → **green**.
- **Commit:** "Bind Ctrl+V to paste via hotkey registry"

## Step 4 — Tests 2–7

Add to the same test file:

| # | Test                                                                                | Notes |
|---|-------------------------------------------------------------------------------------|-------|
| 2 | Intercepted Ctrl+V keydown has preventDefault + stopPropagation called              | Spy via `Object.defineProperty` on the event. |
| 3 | Cmd+V (metaKey only, no ctrlKey) is dispatched to the same handler                  | normalizeEvent treats `metaKey` as Ctrl. |
| 4 | Ctrl+V with `state.active === null` is a graceful no-op (no throw, no `send` call) | Set state.active = null, dispatch, assert. |
| 5 | Ctrl+V on an `<input>` / `<textarea>` / contentEditable target passes through      | document-level listener has `if (isInput(e.target)) return;` — assert no `send` call. |
| 6 | Ctrl+Shift+K still fires clearTerminal (existing hotkey untouched)                  | Set state.active to a session with a mock `term.clear`, dispatch, assert called. |
| 7 | Registering `Ctrl+V` twice returns false / warns and does not overwrite             | Call `registerHotkey('foo', 'Ctrl+V', other)` after import, assert false return. |

- Run `npm test` → all green.
- **Commit:** "Expand Ctrl+V paste tests for regressions and edge cases"

## Step 5 — Self-review

- Re-read full diff. Check for:
  - Style consistency with surrounding code (semicolons, quotes, blank lines).
  - No accidental edits beyond scope.
  - Comment is clear and explains *why*.
- Walk Nyquist checklist from HANDOFF.md. If gaps, add tests or document.
- If anything found, fix + commit.

## Step 6 — Move HANDOFF.md

Currently untracked at repo root. Move into `.planning/2026-05-16-ctrl-v-paste/`
so the PR diff stays clean and the handoff is preserved as history.

- **Commit:** "Archive HANDOFF.md into phase directory"

## Risks / open questions

- happy-dom may not implement `KeyboardEvent.code` correctly. Mitigation: also
  set `key` on the event; if normalizeEvent ever changes to read `key`, the
  tests still hold.
- `terminals.js` has many import-time side effects (creates DOM elements,
  appends styles, registers other hotkeys). We have to either mock its
  dependencies heavily or accept that importing it runs all of them. We'll
  mock `state.js`, `utils.js`, `profiles.js`, `prompts.js`, `toast.js` to
  stubs, and let the side effects run against happy-dom's `document`.

## Manual verification (after merge to local)

1. `node server.js`
2. Open `http://localhost:4000`, start a Claude Code terminal.
3. Press **Ctrl+V** with text on the clipboard → text appears in the terminal.
4. Press **Shift+Insert** → still works (xterm.js built-in).
5. Press **Ctrl+Shift+K** → terminal clears.
6. Right-click → Paste → still works.
7. Trigger TypeWhisper dictation → transcribed text appears in terminal.
