---
phase: 12-clipboard-image-paste
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - public/js/terminals.js
  - tests/clipboard-image-paste.test.js
  - package.json
autonomous: false
requirements: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9]
user_setup: []

must_haves:
  truths:
    - "Pasting a SnagIt region capture with Ctrl+V uploads the image to .clideck/paste/ and types the path into the active PTY (SPEC AC-1)"
    - "Pasting a Windows Snipping Tool capture with Ctrl+V behaves identically (SPEC AC-2)"
    - "Pasting a Chromium 'Copy image' payload with Ctrl+V behaves identically (SPEC AC-3)"
    - "When the clipboard payload has no readable binary OR text type, a single toast tells the user to save-and-drag; the toast does NOT fire on empty/permission-denied clipboards (SPEC AC-4)"
    - "Existing Ctrl+V text paste is byte-identical — text still reaches the PTY via send({type:'input'}) (SPEC AC-5)"
    - "Existing drag-drop file upload path at terminals.js:856 is unchanged — still 4 args incl file.name (SPEC AC-6)"
    - "A new Vitest mocks an image/png clipboard blob and proves the 3-arg call shape via the upload request carrying NO X-Filename header (uploadBlobToSession is not exported, so arity is verified through the header-absence proxy); all existing unit suites stay green (SPEC AC-7)"
    - "navigator.clipboard.read() rejection surfaces an error toast AND still falls through to readText() so text paste survives (D-03)"
    - "window.__debugClipboard gate is default-OFF and truthy-checked at every log site (D-05)"
  artifacts:
    - path: "public/js/terminals.js"
      provides: "Hardened pasteIntoTerminal() binary branch: per-item getType try/catch, read() rejection toast + text fall-through, unreadable-clipboard toast, __debugClipboard gate"
      contains: "__debugClipboard"
    - path: "tests/clipboard-image-paste.test.js"
      provides: "Vitest for the 3-arg clipboard upload shape + success toast + H5 rejection-toast/text-fall-through path"
      contains: "uploadBlobToSession"
    - path: "package.json"
      provides: "Patch version bump on the code-changing commit"
      contains: "version"
  key_links:
    - from: "public/js/terminals.js pasteIntoTerminal()"
      to: "uploadBlobToSession(sessionId, blob, binaryType)"
      via: "3-arg call (no X-Filename — server synthesizes the name)"
      pattern: "uploadBlobToSession\\(sessionId, blob, binaryType\\)"
    - from: "public/js/terminals.js pasteIntoTerminal() catch"
      to: "showToast (error) then navigator.clipboard.readText()"
      via: "rejection-visible fall-through (D-03)"
      pattern: "readText"
---

<objective>
Close the last gap in the Phase 8 binary-paste pipeline so the clipboard branch of
`pasteIntoTerminal()` reaches the same end-state as drag-drop: raw image bytes on the
clipboard (SnagIt, Windows Snipping Tool, Chromium "Copy image") get uploaded to
`.clideck/paste/` and the server-synthesised path is typed into the active PTY.

This is a CLIENT-SIDE-ONLY fix. The server pipeline (`server.js` + `paste-blobs.js`)
is already correct — `buildSafeBlobPath` calls `sanitizeFilename(hint) || synthesizeFilename(mime)`,
so a missing filename is already handled. The diagnosis hypothesis H2 (missing filename →
server rejects) is FALSIFIED by code inspection; do NOT add client-side filename minting.
The real silent-failure modes are H1 (no image/* MIME surfaced) and H5 (clipboard.read()
rejects and the catch swallows it). Per D-01 we patch every plausible angle defensively
in one pass plus ship a gated diagnostic log.

Purpose: SnagIt-style "snip a region and Ctrl+V it" is Lance's dominant
screenshot-to-agent workflow; today it always requires an alt-tab / save-as / drag-in
detour.
Output: Hardened `pasteIntoTerminal()`, a new Vitest, a patch version bump, and a
human-verified three-source smoke.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/2026-06-04-clipboard-image-paste/SPEC.md
@.planning/2026-06-04-clipboard-image-paste/12-CONTEXT.md
@public/js/terminals.js
@tests/hotkeys-paste.test.js

<interfaces>
<!-- Contracts the executor needs. Extracted from public/js/terminals.js. Use directly — no codebase exploration needed. -->

pasteIntoTerminal(sessionId) — terminals.js:265-305. Current shape:
  try { if (navigator.clipboard.read) { items = await read(); for (item of items) {
    binaryType = item.types.find(t => !t.startsWith('text/'));
    if (binaryType) { blob = await item.getType(binaryType);
      await uploadBlobToSession(sessionId, blob, binaryType);   // already 3-arg — KEEP
      refocusActiveTerm(sessionId); return; } } } }
  catch (e) { /* SWALLOWS silently — D-03 makes this visible */ }
  try { text = await readText(); if (text) send({type:'input', id:sessionId, data:text}); }
  catch { showToast('Clipboard read failed.', {type:'error'}); }
  refocusActiveTerm(sessionId);

uploadBlobToSession(sessionId, blob, mime, filename?) — terminals.js:307-334.
  Signature UNCHANGED this phase. Returns Promise<boolean> (true on 200+json.ok).
  Already fires its own toasts with id:'paste-blob' (info "Pasting…", success "Pasted → path",
  error "Paste failed: …"). New toasts in D-03/D-04 MUST use ids distinct from 'paste-blob'.
  Only sets X-Filename header when filename is truthy.

drag-drop call site — terminals.js:856 (REFERENCE — do NOT modify):
  await uploadBlobToSession(id, file, file.type || 'application/octet-stream', file.name);  // 4 args

showToast(message, { id, type, duration }) — 'info' | 'success' | 'error'.

refocusActiveTerm(sessionId) — already wired into both branches; no re-wiring.

window.__logHotkeys precedent (memory/dictation-setup.md) — ship-OFF diagnostic gate,
truthy-checked at log site. D-05's window.__debugClipboard mirrors this exactly.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Harden pasteIntoTerminal binary branch (D-02..D-06) with the __debugClipboard gate</name>
  <files>public/js/terminals.js</files>
  <read_first>
    - public/js/terminals.js:265-334 (pasteIntoTerminal + uploadBlobToSession — the edit + helper)
    - public/js/terminals.js:850-862 (drag-drop call site — the 4-arg reference shape; do NOT regress it)
    - .planning/2026-06-04-clipboard-image-paste/12-CONTEXT.md (D-02..D-06 + Claude's Discretion + the H2-is-dead correction)
    - .planning/2026-06-04-clipboard-image-paste/SPEC.md (AC 1-9)
  </read_first>
  <behavior>
    - Image clipboard item (types ['image/png'], getType resolves a Blob) → uploadBlobToSession called with EXACTLY 3 args (sessionId, blob, 'image/png'); refocusActiveTerm fires; function returns before readText() (binary wins).
    - item.getType() throws → caught per-item; the items loop CONTINUES (does not return/throw out of pasteIntoTerminal); paste does not abort.
    - navigator.clipboard.read() rejects → an error toast fires naming the reason (id distinct from 'paste-blob'), THEN readText() still runs and a valid text payload still reaches the PTY.
    - Binary loop finds no binary type AND readText() yields empty/falsy → exactly one "save it as a file and drag it in" toast fires (id distinct from 'paste-blob'); fires on NEITHER an empty clipboard with text nor a successful binary upload.
    - window.__debugClipboard falsy (default) → zero console output from the new log sites.
  </behavior>
  <action>
    Edit pasteIntoTerminal() only (terminals.js:265-305). Six locked patches, all client-side:

    D-05 (gate first — other patches log through it): introduce a single truthy-checked
    diagnostic gate named `window.__debugClipboard` (harmonise with the existing
    `window.__logHotkeys` precedent; default OFF — never assign it a value, only read it).
    Add a tiny local log helper guarded by the gate that logs items.length, each item's
    `.types`, and each getType() outcome (resolved blob size + mime, or the rejection
    reason). All new console output MUST sit behind this gate.

    D-02: wrap `await item.getType(binaryType)` in try/catch. On throw, log via the gate
    and `continue` the items loop — do NOT return or rethrow out of pasteIntoTerminal.

    D-06: keep the upload call at EXACTLY 3 args — `uploadBlobToSession(sessionId, blob, binaryType)`.
    Do NOT add a fourth filename argument; do NOT mint a client-side `paste-<epoch>` name.
    The server's synthesizeFilename(mime) owns naming (H2 is falsified — server already
    handles a null hint). Leave uploadBlobToSession's signature byte-unchanged.

    D-03: change the existing `catch (e)` at terminals.js:288 (which currently swallows
    silently). It must: log the rejection via the gate, fire an error-flavour showToast
    naming the rejection reason (use a toast `id` distinct from 'paste-blob' — e.g.
    'clipboard-read-error'), THEN fall through to the existing readText() block so text
    paste still works. Preserve the load-bearing binary-wins / text-fall-through contract.

    D-04: after BOTH the binary loop and the readText() block complete, if NEITHER produced
    PTY input (no upload fired AND text was empty/falsy), fire exactly one error-flavour
    showToast with actionable wording (your call on exact phrasing — short, e.g. "clideck
    couldn't read that clipboard payload — save it as a file and drag it in") using a toast
    `id` distinct from both 'paste-blob' and the D-03 id (e.g. 'clipboard-unreadable').
    Narrow trigger: must NOT fire when a binary upload succeeded, when text was pasted, or
    on a genuinely empty clipboard that returned no items with text. Track whether an upload
    fired and whether text was sent with local flags so the D-04 condition is precise.

    Do NOT touch terminals.js:856 (drag-drop), uploadBlobToSession's signature, server.js,
    or paste-blobs.js. No fenced implementation here — these are directives.
  </action>
  <verify>
    <automated>npx vitest run tests/hotkeys-paste.test.js tests/paste-blobs.test.js</automated>
  </verify>
  <acceptance_criteria>
    - terminals.js getType() call is wrapped in try/catch that `continue`s the items loop (does not return/throw out of pasteIntoTerminal).
    - The clipboard upload call passes EXACTLY 3 args `uploadBlobToSession(sessionId, blob, binaryType)` — grep confirms no fourth arg and no `paste-${Date.now()}` / `paste-<epoch>` filename minting in pasteIntoTerminal.
    - The read() catch fires an error showToast (id NOT equal to 'paste-blob') AND still reaches the readText() block (text fall-through preserved).
    - A D-04 unreadable-clipboard error toast (id NOT equal to 'paste-blob' or the D-03 id) fires only when neither binary nor text produced PTY input.
    - window.__debugClipboard appears in terminals.js, is only READ (never assigned), and gates every new console log site (default-OFF).
    - uploadBlobToSession signature unchanged (still `(sessionId, blob, mime, filename)`); terminals.js:856 drag-drop call still passes file.name (4 args) — byte-unchanged.
    - server.js and paste-blobs.js are NOT in the diff.
    - `npx vitest run tests/hotkeys-paste.test.js tests/paste-blobs.test.js` exits 0 (regression guard for AC-5 text paste + AC-6/server helper).
  </acceptance_criteria>
  <done>pasteIntoTerminal carries all six patches D-02..D-06; existing paste suites stay green; server untouched; drag-drop unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Vitest for the clipboard-image upload shape + H5 rejection path (D-07)</name>
  <files>tests/clipboard-image-paste.test.js</files>
  <read_first>
    - tests/hotkeys-paste.test.js (the happy-dom mock pattern: loadFreshTerminals, state.ws stub, navigator.clipboard Object.defineProperty, dispatch + await microtask)
    - public/js/terminals.js:265-334 (pasteIntoTerminal + uploadBlobToSession — the SUT)
    - .planning/2026-06-04-clipboard-image-paste/12-CONTEXT.md (D-07 exact test contract)
  </read_first>
  <behavior>
    - Test A (happy binary): mock navigator.clipboard.read() → one item with types ['image/png'] and getType() resolving a fake Blob; stub fetch → 200 { ok:true, path:'.clideck/paste/x.png' }. Assert the upload fetch to /sessions/:id/paste-blob is invoked with the blob body and an 'image/png' content type, and that the request carries NO 'X-Filename' header (the proxy for the 3-arg call shape — see below). Assert a success toast fires on 200.
    - Test B (H5 rejection): mock navigator.clipboard.read() to reject; mock readText() to resolve a non-empty string. Assert an error toast fires AND send({type:'input', …}) still receives the text (fall-through preserved).
    - Test C (empty-clipboard negative, D-04 precision): mock navigator.clipboard.read() → [] (or an item with only text/plain) AND readText() → '' . Assert the D-04 unreadable-clipboard toast does NOT fire (it must only fire on items-but-no-usable-MIME, never on a genuinely empty clipboard). Guards against a false-positive toast on every empty Ctrl+V.
  </behavior>
  <action>
    Create tests/clipboard-image-paste.test.js using the happy-dom harness from
    tests/hotkeys-paste.test.js (reuse the loadFreshTerminals + state.ws stub + microtask-flush
    pattern; do NOT modify hotkeys-paste.test.js). The new file MUST run under the default
    happy-dom env — do NOT copy paste-blobs.test.js's `@vitest-environment node` header (that
    file tests pure server functions and is NOT a usable template for DOM/toast/fetch seams).

    The toast and fetch seams DO NOT EXIST in the referenced tests — establish them here:
    - showToast is a named export from public/js/toast.js (NOT a window global). Intercept it
      with `vi.mock('../public/js/toast.js', () => ({ showToast: vi.fn() }))` and assert on the
      mock's calls (message + {type} for success vs error).
    - fetch is an unmocked global. Stub it: `global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, path: '.clideck/paste/x.png' }) }))`. Read the request init
      from `fetch.mock.calls[0][1]` to assert on headers.

    Test A — the 3-arg proof is a NEGATIVE assertion on the request, NOT on function arity
    (uploadBlobToSession is not exported, so you cannot inspect its arg count): assert
    `fetch.mock.calls[0][1].headers` has NO 'X-Filename' key (uploadBlobToSession only sets
    that header when a truthy 4th filename arg is passed — its absence proves the 3-arg call),
    and that the content type / mime on the request is 'image/png'. Assert the success toast
    fires after the 200 { ok:true }.

    Test B — the D-03 path: read() rejects → error toast fires (assert the showToast mock got
    an {type:'error'} call) → readText() text still reaches the PTY via the state.ws.send stub.

    Test C — the D-04 negative: empty clipboard + empty text → assert the showToast mock was
    NOT called with the unreadable-clipboard message/id.

    All three tests must be deterministic (no real network, no real clipboard).
  </action>
  <verify>
    <automated>npx vitest run tests/clipboard-image-paste.test.js</automated>
  </verify>
  <acceptance_criteria>
    - tests/clipboard-image-paste.test.js exists with three tests (binary happy path + H5 rejection + empty-clipboard negative) and runs under the default happy-dom env (no `@vitest-environment node` header).
    - The file establishes its own seams: `vi.mock('../public/js/toast.js', ...)` to capture showToast and a `global.fetch` stub (the referenced tests have no such seam to mirror).
    - Test A asserts the upload request carries mime 'image/png' and that `fetch.mock.calls[0][1].headers` has NO 'X-Filename' key (the proxy proving the 3-arg call shape — not a function-arity check, since uploadBlobToSession is not exported) and asserts a success toast on 200.
    - Test B asserts read() rejection fires an {type:'error'} toast AND text fall-through still sends input to the PTY via state.ws.send.
    - Test C asserts the D-04 unreadable toast does NOT fire on a genuinely empty clipboard (no items + empty text).
    - `npx vitest run tests/clipboard-image-paste.test.js` EXITS 0 (judged by process exit code, NOT by grepping output for "pass" — a "1 passed, 2 failed" line contains "pass").
    - `npx vitest run` (full unit suite) exits 0 — no regression to any existing suite (AC-7).
  </acceptance_criteria>
  <done>New Vitest is green, exits 0, locks the 3-arg shape and the H5 fall-through; full unit suite stays green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Version bump + three-source manual smoke on throwaway :4099</name>
  <files>package.json</files>
  <read_first>
    - package.json (current version line — bump from current main HEAD, NOT hardcoded)
    - memory/feedback_verify-clideck-ui-altport-playwright.md (throwaway :4099 + isolated data dir + taskkill protocol)
    - memory/feedback_bump-version-on-code-changes.md (patch-bump-on-code-change rule)
  </read_first>
  <action>
    AUTOMATED FIRST: bump package.json patch version by one from the CURRENT main HEAD
    value (do NOT hardcode 1.31.15 — Phase 14 may have shipped a bump first; read the
    current version and increment the patch). Then boot a throwaway clideck instance on
    port 4099 with an isolated data dir per the altport-playwright memory, leaving it
    running for the human smoke below. Run `npx vitest run` and `npx playwright test` and
    report exit codes (AC-7, AC-8).

    THEN pause for the human to perform the three real-clipboard sources a headless run
    cannot fully cover.
  </action>
  <what-built>
    Hardened clipboard-image paste (D-02..D-06), a new Vitest locking the 3-arg shape +
    H5 fall-through, and a patch version bump. A throwaway clideck is running on :4099 with
    an isolated data dir; vitest + playwright exit codes are reported above.
  </what-built>
  <how-to-verify>
    1. Open the running instance at http://localhost:4099 and start/open an active terminal.
    2. SnagIt (AC-1): snip a screen region, focus the terminal, press Ctrl+V. Confirm a
       "Pasted → .clideck/paste/<name>" success toast and that the path is typed into the
       PTY (press Enter — the agent/shell should see the path).
    3. Windows Snipping Tool (AC-2): capture, Ctrl+V into the terminal — same result.
    4. Chromium "Copy image" (AC-3): right-click an image in a browser → Copy image,
       Ctrl+V into the terminal — same result.
    5. Unreadable payload (AC-4): copy something with no readable binary/text MIME (or use
       a payload the browser can't decode); Ctrl+V → confirm the single "save it as a file
       and drag it in" toast appears, and that copying plain TEXT and Ctrl+V still types
       text into the PTY (AC-5 unchanged).
    6. Drag-drop unchanged (AC-6): drag a real image file onto the terminal — still uploads.
    7. Post-paste Enter (AC-9): after a clipboard image paste, press Enter — the path
       submits without an extra click (refocusActiveTerm).
    8. Optional triage check (D-05): in devtools set `window.__debugClipboard = true`, repeat
       a paste, confirm items.length / .types / getType outcome are logged; confirm NO such
       logs appear when the gate is unset.
    When done, taskkill the :4099 instance and remove the isolated data dir.
  </how-to-verify>
  <verify>
    <human-check>All three sources (SnagIt, Snipping Tool, Chromium Copy image) land the image in .clideck/paste/ and type the path into the PTY; AC-4 toast fires only on truly unreadable payloads; AC-5 text paste + AC-6 drag-drop unchanged; AC-9 Enter submits post-paste.</human-check>
  </verify>
  <resume-signal>Type "approved" once all three sources work and the regressions are clean, or describe the failure.</resume-signal>
  <acceptance_criteria>
    - package.json version is incremented by exactly one patch from the current main HEAD value (not hardcoded).
    - `npx vitest run` exits 0 and `npx playwright test` exits 0 (exit codes reported, not grepped for "pass").
    - Human confirms AC-1/AC-2/AC-3 (all three sources), AC-4 (narrow toast), AC-5 (text paste unchanged), AC-6 (drag-drop unchanged), AC-9 (Enter submits post-paste).
  </acceptance_criteria>
  <done>Version bumped from current HEAD; full unit + e2e suites green by exit code; human approves the three-source smoke and the regression checks.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser clipboard → client JS | Untrusted clipboard bytes/MIME enter `pasteIntoTerminal()` |
| client JS → server `/sessions/:id/paste-blob` | Already-existing upload path; NOT modified this phase |

## STRIDE Threat Register

This phase adds NO new server surface and NO new upload path. It only makes the
existing client clipboard branch reach the already-hardened Phase 8 server pipeline
(filename sanitisation + 50 MiB cap + `.clideck/paste/` chroot), all byte-unchanged
(server.js and paste-blobs.js are NOT modified).

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-12-01 | Tampering (path traversal) | filename hint → file path | accept (already mitigated) | Phase 8 `sanitizeFilename` / `buildSafeBlobPath` chroot — unchanged. Client sends NO X-Filename for clipboard blobs, so the server synthesizes the name (D-06). |
| T-12-02 | Denial of Service (oversize blob) | upload body size | accept (already mitigated) | Phase 8 50 MiB cap in server handler — unchanged. |
| T-12-03 | Spoofing/Information (untrusted MIME) | binaryType from item.types | accept (already mitigated) | Server `MIME_TO_EXT` maps to a canonical extension; unknown MIME → safe default. Client passes MIME through only. |
| T-12-04 | Tampering | npm/pip/cargo installs | mitigate | No new packages installed this phase — N/A; no install tasks present. |

No high-severity threats. No new attack surface introduced.
</threat_model>

<verification>
- `npx vitest run` exits 0 (full unit suite, including the new clipboard test) — AC-7.
- `npx playwright test` exits 0 — AC-8.
- `git diff --name-only` shows ONLY public/js/terminals.js, tests/clipboard-image-paste.test.js, package.json — server.js and paste-blobs.js NOT in the diff.
- Manual three-source smoke approved by human — AC-1/2/3/4/9.
- Vitest verdicts judged by PROCESS EXIT CODE, never by grepping output for "pass".
</verification>

<success_criteria>
- All six patches D-02..D-06 land in pasteIntoTerminal(); uploadBlobToSession signature + drag-drop call unchanged; server untouched (D-06 / out-of-scope list honoured).
- New Vitest (D-07) locks the 3-arg clipboard upload shape and the H5 rejection-toast + text fall-through; exits 0.
- SPEC AC 1-9 all satisfied (AC-1/2/3/9 via human smoke; AC-4 toast verified; AC-5 text + AC-6 drag-drop regression-clean; AC-7 unit + AC-8 e2e green by exit code).
- package.json patch bumped from current main HEAD.
- `window.__debugClipboard` gate present, default-OFF, mirrors `__logHotkeys`.
</success_criteria>

<output>
Create `.planning/phases/12-clipboard-image-paste/12-01-SUMMARY.md` when done.
(If the executor uses the date-slug dir convention, write to
`.planning/2026-06-04-clipboard-image-paste/12-01-SUMMARY.md` to match this phase's on-disk layout.)
</output>
