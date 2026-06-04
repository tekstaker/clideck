# Phase 12: clipboard-image-paste - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the last gap in the Phase 8 binary-paste pipeline so the clipboard branch
of `pasteIntoTerminal()` reaches the same end-state the drag-drop branch
already does: image bytes living on the clipboard (SnagIt, Windows Snipping
Tool, Chromium "Copy image") get uploaded to `<cwd>/.clideck/paste/<file>`
and the relative path is typed into the active terminal's PTY.

Implementation surface is **client-side only** (`public/js/terminals.js`).
Server pipeline (`server.js` + `paste-blobs.js`) is already correct — it
synthesizes filenames, sanitises, enforces the 50 MiB cap, and contains
writes to the inbox chroot. This phase does not touch the server.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**9 acceptance criteria are locked.** See `2026-06-04-clipboard-image-paste/SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `2026-06-04-clipboard-image-paste/SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):** Pin which of the H1/H2/H3 hypotheses is the actual cause and fix it; toast UX for genuinely unreadable clipboard payloads; Vitest unit covering the clipboard-image-blob upload shape.

**Out of scope (from SPEC.md):** Routing image bytes to a multi-modal model; honouring a source app's preferred filename; server-side virus/MIME sanitisation beyond Phase 8 already does; reviving Ctrl+V for File-Explorer-COPIED files.

### ⚠ SPEC.md correction — H2 is dead on arrival

The SPEC names H2 (upload path missing filename → server rejects) as the most
likely cause. **Code inspection during discuss-phase falsifies H2.** Server
already handles missing filenames cleanly:

- `paste-blobs.js:119-134` (`buildSafeBlobPath`) calls `sanitizeFilename(hint) || synthesizeFilename(mime)` — null hint → synthesize via `${ISO-timestamp}-${4-byte-hex}.${ext}` using the 40+-entry `MIME_TO_EXT` table.
- `server.js:260` reads `req.headers['x-filename']` and treats absence as null.
- The drag-drop call at `terminals.js:856` passes `file.name`; the clipboard call at `terminals.js:277` passes nothing — both work end-to-end on the server because of the synthesize fallback.

So the actual silent failure mode is more likely **H1** (Windows clipboard
payloads expose no `image/*` MIME in `item.types`) or **H5** (a new
hypothesis: `navigator.clipboard.read()` throws on permission/lock issues
and the catch at `terminals.js:288` swallows the error silently). The plan
addresses both H1 and H5 defensively per the decisions below; H2's "missing
filename" path doesn't need a fix because the server already covers it.

</spec_lock>

<decisions>
## Implementation Decisions

### Diagnostic strategy

- **D-01: Speculative fix all plausible angles + add diagnostic logging gate.**
  No diagnose-first round. Single planning pass patches every plausible
  failure mode and ships a gated diagnostic log for future triage. Rationale:
  the patches are small, additive, and don't regress the working paths; the
  diagnostic gate makes future user reports actionable without code changes.

### Patch list (locked)

All edits are in `public/js/terminals.js`. Six items, signed off as a unit:

- **D-02: Wrap `await item.getType(binaryType)` in try/catch.** Handles a
  Windows clipboard data-lock dropping between `clipboard.read()` and
  `getType()` (hypothesis H4). On throw, log via the diagnostic gate and
  continue the items loop — do NOT abort the whole paste.
- **D-03: Surface `clipboard.read()` rejection through the toast.** Today the
  catch at `terminals.js:288` swallows silently and falls through to
  `readText()`. Change to: log via the diagnostic gate, fire an error-flavour
  toast naming the rejection reason, THEN fall through to `readText()` so the
  text path still works. Handles H5 without breaking the existing fall-through
  contract for headless / no-permission environments.
- **D-04: Unreadable-clipboard toast on zero-effect paste.** After both the
  binary loop and `readText()` complete, if neither produced PTY input (no
  upload fired, `text` was empty/falsy), fire a single toast: *"clideck
  couldn't read that clipboard payload — save it as a file and drag it in."*
  Narrow trigger by design — only fires on actual silent paste, not on
  every read that returns "weird" payloads. Handles H1.
- **D-05: `window.__debugClipboard` console-logging gate.** Default OFF.
  When truthy, log `items.length`, each item's `.types`, and `getType()`
  outcome (success size + mime, or rejection reason). Matches the
  `window.__logHotkeys` precedent in the dictation work — see
  [[../../memory/dictation-setup.md]]. Purpose: triage future user reports
  without a code change.
- **D-06: Client sends no X-Filename for clipboard blobs.** The server's
  `synthesizeFilename(mime)` produces a better name than the SPEC's
  `paste-<epoch>.<ext>` sketch (it uses `${ISO-timestamp}-${4-byte-hex}` +
  the canonical extension from `MIME_TO_EXT`). The clipboard branch calls
  `uploadBlobToSession(sessionId, blob, binaryType)` — three args, no
  filename — and lets the server own naming. **The SPEC's AC #1 wording
  ("with a synthesised name `paste-<epoch>.png` or equivalent") is
  satisfied by the server's existing synthesis; no client-side filename
  minting required.**
- **D-07: Vitest covering the clipboard-image upload shape.** Mock
  `navigator.clipboard.read()` to return one item with types `['image/png']`
  and a `getType()` that resolves to a fake `Blob`. Assert (a)
  `uploadBlobToSession` is called with `(sessionId, blob, 'image/png')` —
  three args, no fourth — and (b) on a successful 200 OK response, the
  success toast fires. Add a second test for the H5 path: `clipboard.read()`
  rejects → error toast fires + text fall-through still attempts.

### Out of scope for this phase (defensive list)

- No server-side changes. `paste-blobs.js` and `server.js` stay byte-identical.
- No change to `uploadBlobToSession`'s signature — still
  `(sessionId, blob, mime, filename?)`. Drag-drop continues to pass `file.name`.
- No change to the text-paste path beyond making the error fall-through
  visible. Phase 1's `Ctrl+V → input` flow stays intact.

### Claude's Discretion

- Exact toast wording for D-04 — keep it short and actionable, but final
  phrasing is implementer's call. Suggestion in D-04 above is a starting
  point, not a contract.
- Exact label for the diagnostic gate (`window.__debugClipboard` vs
  `window.__logClipboard`) — pick whichever harmonises with `__logHotkeys`.
- Whether the per-item `getType()` try/catch logs to console unconditionally
  or only behind the gate — implementer can decide; gate is fine.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements
- `.planning/2026-06-04-clipboard-image-paste/SPEC.md` — Locked requirements (with the H2 caveat above).
- `.planning/todos/completed/2026-06-04-paste-clipboard-image-bytes.md` — Source todo with fuller diagnostic procedure (devtools console + Network tab walkthroughs).

### Shipped pipeline this phase extends
- `.planning/2026-05-20-paste-blobs/SPEC.md` — Phase 8 spec: full binary-paste pipeline including the 50 MiB cap, the `.clideck/paste/` inbox chroot, filename sanitisation contract.
- `.planning/2026-05-27-terminal-focus/SPEC.md` — Phase 11: `refocusActiveTerm(sessionId)` is already called on `terminals.js:283` (the binary-paste branch). No focus work needed here.
- `.planning/2026-05-16-ctrl-v-paste/SPEC.md` — Phase 1: original Ctrl+V → PTY contract. The text fall-through in `pasteIntoTerminal()` is load-bearing for dictation tools and must remain intact.

### Code touchpoints
- `public/js/terminals.js:265-304` — `pasteIntoTerminal()`. **All edits land here.**
- `public/js/terminals.js:307-334` — `uploadBlobToSession()`. Signature unchanged; clipboard branch calls with 3 args, drag-drop with 4.
- `public/js/terminals.js:856` — drag-drop call site (4 args including `file.name`). Reference shape; do not regress.
- `server.js:248-313` — `/sessions/:id/paste-blob` POST handler. **Not modified.** Read for understanding only.
- `paste-blobs.js` (entire module, 144 lines) — server helpers: `MIME_TO_EXT`, `sanitizeFilename`, `synthesizeFilename`, `buildSafeBlobPath`. **Not modified.**

### Existing tests to NOT regress
- `tests/paste-blobs.test.js` — server-side helper coverage.
- `tests/hotkeys-paste.test.js` — Ctrl+V binding + text-paste path.
- `e2e/paste-blob-upload.spec.js` — drag-drop E2E.
- `e2e/paste-then-enter.spec.js` — Phase 11 paste-then-Enter coverage.

### Memory / process refs
- `memory/feedback_verify-clideck-ui-altport-playwright.md` — verify on throwaway :4099 + isolated data dir; Playwright drive; taskkill at end.
- `memory/dictation-setup.md` — the `window.__logHotkeys` precedent that D-05's
  `window.__debugClipboard` gate mirrors.
- `memory/feedback_bump-version-on-code-changes.md` — bump `package.json` patch on
  the code-changing commit.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `uploadBlobToSession(sessionId, blob, mime, filename?)` at `terminals.js:307` — the helper is already filename-optional; clipboard branch just calls with 3 args.
- `showToast` (id, type, duration) — used throughout `uploadBlobToSession` (`{ id: 'paste-blob', … }` for de-duplication). D-03's rejection toast and D-04's unreadable toast should reuse the same toast machinery; pick distinct `id`s so neither dedupes against `paste-blob`.
- `refocusActiveTerm(sessionId)` — already wired into both branches (terminals.js:283 binary, terminals.js:304 text). No re-wiring needed.
- Server-side `synthesizeFilename(mime)` — D-06 leverages this. Already produces ISO-timestamp + nonce + canonical extension.

### Established Patterns
- **Binary-branch-then-text-fallback** in `pasteIntoTerminal()` is load-bearing for dictation tools (Phase 1 commentary at terminals.js:268-269). Any defensive changes must preserve the "binary wins, text fall-through stays available on failure" contract.
- **Toast `id` for dedup** — the binary path already uses `id: 'paste-blob'` so a new "Pasting…" doesn't stack on top of a previous one. New toasts in D-03/D-04 should pick their own ids.
- **`window.__logHotkeys` gate** — pattern for ship-it-OFF diagnostic logging that's truthy-checked at log site. D-05 mirrors this.

### Integration Points
- Vitest already uses happy-dom for DOM-touching tests (see Phase 9 work; observation 63/64 from memory). The D-07 mock should follow that pattern.
- No new files needed. No exports change. No build / config change.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants this to be a one-pass autonomous fix — patch everything that could go wrong defensively, then verify on throwaway :4099 against the three real-world sources (SnagIt, Snipping Tool, Chromium "Copy image"). No diagnose-then-fix bounce.
- The `__debugClipboard` gate should be discoverable from devtools by name — match the `__logHotkeys` precedent so any session that's already taught Lance to type `__logHotkeys = true` will land on the right pattern here.

</specifics>

<deferred>
## Deferred Ideas

- **Routing image bytes to a multi-modal model directly.** Currently the agent
  reads the file at the typed path. A future phase might let the user pick
  "paste as bytes" vs "paste as path". Out of scope here.
- **Honouring the source app's preferred filename if the clipboard format
  ever carries one.** None of SnagIt / Snipping Tool / Chromium "Copy image"
  do today. Worth revisiting if a clipboard source ever adds a `text/uri-list`
  or filename hint.
- **Ctrl+V from File Explorer COPIED files.** Mentioned in the source todo
  as potentially also broken; explicitly deferred there. Triage in a future
  follow-up if user reports it.
- **Image-paste preview affordance.** A small thumbnail toast confirming
  "you just pasted this image" before it lands in the PTY. UX nicety; not
  required for the core fix.

</deferred>

---

*Phase: 12-clipboard-image-paste*
*Context gathered: 2026-06-04*
