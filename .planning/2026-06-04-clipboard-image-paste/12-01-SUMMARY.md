---
phase: 12-clipboard-image-paste
plan: 01
subsystem: client-paste
tags: [clipboard, paste, terminals, vitest, hardening]
status: autonomous-complete-pending-human-smoke
requires:
  - "Phase 8 binary-paste pipeline (server.js /sessions/:id/paste-blob + paste-blobs.js synthesizeFilename)"
  - "Phase 11 refocusActiveTerm() on both paste branches"
provides:
  - "Hardened pasteIntoTerminal() binary branch (D-02..D-06) with window.__debugClipboard gate"
  - "tests/clipboard-image-paste.test.js locking the 3-arg upload shape + H5 fall-through + D-04 precision"
  - "package.json 1.31.15"
affects:
  - public/js/terminals.js
tech-stack:
  added: []
  patterns:
    - "window.__debugClipboard ship-OFF diagnostic gate (mirrors __logHotkeys)"
    - "vi.hoisted() + vi.mock('../public/js/toast.js') to spy a named export"
    - "X-Filename header-absence as a proxy for the 3-arg upload call shape"
key-files:
  created:
    - tests/clipboard-image-paste.test.js
  modified:
    - public/js/terminals.js
    - package.json
decisions:
  - "D-04 unreadable toast gated on a sawUnusableBinary flag, not just !uploadFired && !textSent, so a genuinely empty/text-only clipboard never false-positives"
  - "Pinned '@vitest-environment happy-dom' at the new test's head (NOT node) after the global config default failed to apply happy-dom to the file (environment 0ms); explicit header is config-drift-proof and satisfies the AC (no node header)"
metrics:
  duration: ~6m autonomous
  completed: 2026-06-04
  version: 1.31.15
---

# Phase 12 Plan 01: clipboard-image-paste Summary

Hardened the clipboard branch of `pasteIntoTerminal()` so raw image bytes (SnagIt /
Snipping Tool / Chromium "Copy image") reach the same `.clideck/paste/` upload + PTY-path
end-state as drag-drop, with every failure mode narrated instead of swallowed; added a
Vitest locking the 3-arg upload shape and H5 fall-through; bumped to 1.31.15. Client-side
only — `server.js` and `paste-blobs.js` are byte-unchanged.

## What changed (per task)

### Task 1 — Harden `pasteIntoTerminal()` (D-02..D-06) — commit `20ed4d4`
All six locked patches landed in `public/js/terminals.js`, edits confined to
`pasteIntoTerminal()`:

- **D-05** `window.__debugClipboard` gate — default OFF, only ever READ (line 287), never
  assigned. A local `dbg()` helper logs `items.length`, each item's `.types`, and each
  `getType()` outcome only when the gate is truthy. Mirrors the `__logHotkeys` precedent.
- **D-02** per-item `getType()` wrapped in try/catch that `continue`s the items loop (does
  not return/throw out of the function) — handles a Windows clipboard data-lock (H4).
- **D-06** upload call kept at **exactly 3 args** — `uploadBlobToSession(sessionId, blob, binaryType)`.
  No 4th filename arg, no `paste-<epoch>` minting; the server's `synthesizeFilename(mime)`
  owns naming (H2 falsified). `uploadBlobToSession` signature byte-unchanged.
- **D-03** `clipboard.read()` rejection (H5) no longer swallowed: logs via the gate, fires
  an error toast (`id: 'clipboard-read-error'`, distinct from `'paste-blob'`), THEN still
  falls through to `readText()` so text paste survives.
- **D-04** unreadable-clipboard toast (`id: 'clipboard-unreadable'`) fires only when a
  binary candidate appeared but produced no upload AND no text reached the PTY — tracked
  via `uploadFired` / `textSent` / `sawUnusableBinary` local flags. Never fires on a
  successful upload, a successful text paste, or a genuinely empty/text-only clipboard.

Drag-drop call at `terminals.js:856` (4 args incl `file.name`) untouched; binary-wins /
text-fall-through contract preserved.

### Task 2 — Vitest (D-07) — commit `c7e3fbe`
Created `tests/clipboard-image-paste.test.js` (happy-dom env), reached `pasteIntoTerminal`
through the document Ctrl+V dispatcher seam (it is not exported). Three tests:
- **A** image/png blob → upload to `/sessions/:id/paste-blob` with the blob body, mime
  `image/png`, and **no `X-Filename` header** (proxy proving the 3-arg shape) + success
  toast on 200.
- **B** `read()` rejects → `{type:'error'}` toast fires (id != `'paste-blob'`) AND text
  fall-through still sends `{type:'input'}` via `state.ws.send`.
- **C** empty clipboard (`read()` → `[]`, `readText()` → `''`) → `'clipboard-unreadable'`
  toast does NOT fire.

Seams established here (absent in referenced tests): `showToast` mocked via
`vi.mock('../public/js/toast.js')` with the spy created in `vi.hoisted()`; `global.fetch`
stubbed with request init read from `fetch.mock.calls[0][1]`.

### Task 3 (automated portion) — version bump + vitest — commit `ffb8e85`
`package.json` 1.31.14 → **1.31.15** (one patch above current main HEAD; no intervening
Phase 14 bump on main).

## Vitest result

`npx vitest run` (full unit suite) — **exit code 0**. Tail:

```
 Test Files  19 passed (19)
      Tests  149 passed | 1 skipped (150)
   Start at  20:18:12
   Duration  6.51s
```

The 3 new clipboard tests pass; no regression to `hotkeys-paste` (AC-5 text paste) or
`paste-blobs` (AC-6/server helpers). Verdict judged by process exit code, not grep.

## Commits made

| Hash | Type | Message |
|------|------|---------|
| `20ed4d4` | feat | harden clipboard-image branch in pasteIntoTerminal (D-02..D-06) |
| `c7e3fbe` | test | lock clipboard-image 3-arg upload shape + H5 fall-through (D-07) |
| `ffb8e85` | chore | bump version to 1.31.15 for clipboard-image-paste |

Authored `Samuel Harding <dev1@lancetek.com>` on `feat/clipboard-image-paste`. **NOT pushed**
(origin is GitHub).

## Scope verification

- `git diff --name-only main` → exactly `package.json`, `public/js/terminals.js`,
  `tests/clipboard-image-paste.test.js`. `server.js` and `paste-blobs.js` NOT in the diff.
- `window.__debugClipboard` present in `terminals.js`, only READ (line 287), never assigned.
- `uploadBlobToSession` signature unchanged; drag-drop call (`terminals.js:856`, 4 args) byte-unchanged.

## Deviations from Plan

**1. [Rule 3 — Blocking issue] Explicit `@vitest-environment happy-dom` header on the new test.**
- **Found during:** Task 2. The repo's `vitest.config.js` sets `environment: 'happy-dom'`
  globally, but when the new file was run, vitest reported `environment 0ms` and threw
  `ReferenceError: document is not defined` — the global default was not applied to this
  file (a vitest v4 per-file environment-resolution quirk, interacting with the hoisted
  `vi.mock`). `hotkeys-paste.test.js` loads happy-dom fine (`environment 490ms`).
- **Fix:** Pinned `// @vitest-environment happy-dom` at the file head. This is config-drift-proof,
  documents the DOM requirement at the file head, and satisfies the AC (the AC forbids the
  `node` header, not an explicit `happy-dom` one).
- **Files modified:** `tests/clipboard-image-paste.test.js`
- **Commit:** `c7e3fbe`

**2. [Rule 1 — Correctness] D-04 trigger tightened with a `sawUnusableBinary` flag.**
- **Found during:** Task 1. A naive `!uploadFired && !textSent` D-04 condition would fire
  the unreadable toast on a genuinely empty clipboard (e.g. the existing hotkeys-paste
  "empty clipboard" case: no `read()`, empty text), violating the plan's explicit
  requirement that D-04 fires "only on items-but-no-usable-MIME, never on a genuinely empty
  clipboard" (Test C).
- **Fix:** Added a `sawUnusableBinary` flag set only when a non-text binary candidate
  appeared but failed to produce an upload (getType threw, or resolved nothing). D-04 now
  requires `!uploadFired && !textSent && sawUnusableBinary`.
- **Files modified:** `public/js/terminals.js`
- **Commit:** `20ed4d4`

## Deferred to human smoke

The following require a real clipboard + browser + a running server and were NOT run in
this autonomous session (this session may be clideck-hosted; no servers were started, and
Playwright boots a server). Run them in an external terminal per the resume protocol.

**Boot a throwaway instance first** (per `memory/feedback_verify-clideck-ui-altport-playwright.md`):
spin up clideck on port 4099 with an isolated data dir, drive with the browser, then
`taskkill` it and remove the data dir when done.

### Three-source manual clipboard smoke (AC-1/2/3/4/5/6/9) — from 12-PLAN.md Task 3 how-to-verify
1. Open `http://localhost:4099` and start/open an active terminal.
2. **SnagIt (AC-1):** snip a screen region, focus the terminal, press Ctrl+V. Confirm a
   "Pasted → .clideck/paste/<name>" success toast and the path is typed into the PTY
   (press Enter — the agent/shell should see the path).
3. **Windows Snipping Tool (AC-2):** capture, Ctrl+V into the terminal — same result.
4. **Chromium "Copy image" (AC-3):** right-click an image in a browser → Copy image,
   Ctrl+V into the terminal — same result.
5. **Unreadable payload (AC-4):** copy something with no readable binary/text MIME; Ctrl+V →
   confirm the single "save it as a file and drag it in" toast appears; then confirm copying
   plain TEXT and Ctrl+V still types text into the PTY (AC-5 unchanged).
6. **Drag-drop unchanged (AC-6):** drag a real image file onto the terminal — still uploads.
7. **Post-paste Enter (AC-9):** after a clipboard image paste, press Enter — the path
   submits without an extra click (refocusActiveTerm).
8. **Optional triage check (D-05):** in devtools set `window.__debugClipboard = true`, repeat
   a paste, confirm items.length / .types / getType outcome are logged; confirm NO such logs
   appear when the gate is unset.
9. When done, `taskkill` the :4099 instance and remove the isolated data dir.

### Playwright E2E (AC-8)
`npx playwright test` — DEFERRED (boots a server). Run it in the external terminal and
confirm exit 0. Includes `e2e/paste-blob-upload.spec.js` (drag-drop) and
`e2e/paste-then-enter.spec.js` (Phase 11 paste-then-Enter, AC-9 flow).

### Resume signal
Per 12-PLAN.md Task 3: type "approved" once all three sources work and the regressions are
clean, or describe the failure.

## Self-Check: PASSED
- FOUND: public/js/terminals.js
- FOUND: tests/clipboard-image-paste.test.js
- FOUND: package.json
- FOUND commit: 20ed4d4
- FOUND commit: c7e3fbe
- FOUND commit: ffb8e85
