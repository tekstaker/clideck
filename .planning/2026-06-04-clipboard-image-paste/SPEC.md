# SPEC — Paste raw clipboard image bytes into the terminal

**Status:** planned (not yet discussed/planned — seeded from one pending todo 2026-06-04)
**Owner:** Lance Keay
**Date:** 2026-06-04

## What this delivers

Closes the last open gap in the binary-paste pipeline that Phase 8 shipped: raw
**image bytes living on the clipboard** (no underlying file) get uploaded to
`.clideck/paste/` and the resulting path is written into the active PTY's stdin —
the same end-state the drag-and-drop file path already reaches.

Concretely:

1. Pasting a screenshot taken by SnagIt, the Windows Snipping Tool, or a
   Chromium "Copy image" right-click action into an active terminal lands the
   image as a file in `.clideck/paste/` with a synthesised filename and types
   that path into the PTY.
2. If the clipboard payload genuinely can't be read (no MIME the browser
   surfaces as a binary type), the user gets a toast with a clear next step
   ("save it as a file and drag it in") instead of dead silence.

## Why

The drag-drop side of Phase 8 (`2026-05-20-paste-blobs`, v1.31.7) works
because it hands `uploadBlobToSession` a real `File` with `file.name`. The
clipboard-image side appears wired up — `pasteIntoTerminal()` at
`public/js/terminals.js:265-304` has a binary-aware branch — but it calls the
helper with **three args** (`sessionId, blob, binaryType`) where drag-drop
calls with **four** (`…, file.name`). Clipboard blobs have no inherent name,
so if the helper or the server endpoint depends on a filename arg, the
clipboard path silently no-ops while drag-drop succeeds — which matches the
observed symptom (SnagIt Ctrl+V does nothing, drag the saved file in and it
works).

This is the highest-leverage clipboard-UX fix left: SnagIt-style "snip a
region and Ctrl+V it" is Lance's dominant screenshot-to-agent workflow, and
today it always requires an "alt-tab, save-as, drag in" detour.

## Scope

**In scope**

### Diagnose then fix the clipboard-blob upload

- Pin which of the two hypotheses from
  `.planning/todos/completed/2026-06-04-paste-clipboard-image-bytes.md` is the
  actual cause, with one trip into devtools per source (Snipping Tool, SnagIt,
  Chromium "Copy image"):
  - **H1 — `item.types` returns no `image/*`.** Browser couldn't decode the
    payload (CF_DIB without an `image/png` alias). Fix is upstream of clideck;
    response is a UX toast (see "Toast for unreadable clipboards" below).
  - **H2 — upload missing filename.** The POST to `/sessions/:id/paste-blob`
    fires but the server rejects/no-ops because `filename` is absent. Fix at
    the call site:
    ```
    const ext = (binaryType.split('/')[1] || 'bin').replace(/[^a-z0-9]+/gi, '');
    const filename = `paste-${Date.now()}.${ext}`;
    await uploadBlobToSession(sessionId, blob, binaryType, filename);
    ```
  - **H3 — server-side gap.** Upload succeeds, file lands, but
    `server.js`'s post-upload hook doesn't write the path into the PTY for the
    no-filename case. Fix is to make the PTY-write path filename-agnostic
    (use the server-resolved name rather than re-trusting the client's).

### Toast for unreadable clipboards (improve regardless of H1/H2/H3)

- When `navigator.clipboard.read()` returns items but the binary-type filter
  finds nothing AND no `text/plain` either, surface a toast: *"Clipboard
  contains data clideck can't read — save it as a file and drag it in."*
- Don't pop the toast when the clipboard is genuinely empty or unreadable
  (permissions denied) — distinguish "no items" from "items but no usable
  MIME". The latter is the failure mode worth narrating.

### Unit-test the clipboard-blob shape

- Add a small Vitest that mocks `navigator.clipboard.read()` returning a
  `Blob` typed `image/png` and asserts `uploadBlobToSession` is called with
  the four-arg shape `(sessionId, blob, mime, synthesisedFilename)`, with the
  filename matching `paste-\d+\.png`.
- Existing paste unit + E2E coverage must remain green.

**Out of scope**

- Routing image bytes directly to a multi-modal model (the existing flow types
  the file path; agents that accept binary uploads via their own protocol can
  pick it up from `.clideck/paste/`).
- Honouring the source app's preferred filename if the clipboard format ever
  carries one (it doesn't, in any of the three target sources).
- Server-side virus/MIME sanitisation beyond what Phase 8 already does
  (filename sanitisation + 50 MiB cap).
- Reviving Ctrl+V for File-Explorer-COPIED files if that path is also broken
  — track separately if confirmed during diagnosis.

## Acceptance criteria

1. **SnagIt region capture → Ctrl+V in an active terminal → file lands in
   `.clideck/paste/`** with a synthesised name (`paste-<epoch>.png` or
   equivalent extension) and the path is typed into the PTY (the agent sees
   it on next Enter).
2. **Windows Snipping Tool capture → Ctrl+V** behaves identically.
3. **Chromium "Copy image" right-click → Ctrl+V** behaves identically.
4. If the clipboard payload has no readable binary or text type, a toast tells
   the user what to do; existing Ctrl+V text paste is unchanged.
5. Existing Ctrl+V text paste behaviour is byte-identical (no regression to
   the Phase 1 / Phase 8 happy paths).
6. Existing drag-drop file upload path is unchanged.
7. All Vitest unit suites pass, including a new test that mocks an
   `image/png` clipboard blob and asserts the four-arg call shape.
8. All Playwright suites pass.
9. Post-paste Enter-submit still works for clipboard images (Phase 11's
   `refocusActiveTerm` already fires on both paste branches; confirm by
   running through `e2e/paste-then-enter.spec.js`'s flow with an image
   payload manually).

## Cross-cutting constraints

- Per the project version-bump rule, bump `package.json` patch on the
  code-changing commit so the connection lozenge surfaces the new build.
- **Do not push to `origin`** — origin is GitHub.

## Relation to shipped work

- **Phase 8** (`2026-05-20-paste-blobs`, v1.31.7) — shipped the binary-aware
  `pasteIntoTerminal` branch and the drag-drop upload path; this phase closes
  the clipboard-blob filename gap left in that branch.
- **Phase 11** (`2026-05-27-terminal-focus`, v1.31.14) — both paste branches
  call `refocusActiveTerm(sessionId)` post-paste, so once this phase closes
  the upload gap, post-paste Enter-submit will work for clipboard images
  for free.

## Source todo

Seeded from (and supersedes for tracking purposes):

- `.planning/todos/completed/2026-06-04-paste-clipboard-image-bytes.md`

That file has fuller diagnostic procedure (devtools console + Network tab
walk-throughs for each hypothesis), the exact call sites in `terminals.js`,
and the synthesised-filename snippet. This SPEC has not yet been through
`/gsd-discuss-phase` or `/gsd-plan-phase` — refine before executing.
