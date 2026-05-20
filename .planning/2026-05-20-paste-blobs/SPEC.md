# SPEC — Paste binary blobs into clideck sessions

**Status:** in progress
**Owner:** Lance Keay
**Date:** 2026-05-20
**Promoted from:** `.planning/todos/pending/2026-05-20-paste-blobs-into-sessions.md`

## What this delivers

Ctrl+V (Cmd+V on Mac) in a focused clideck terminal currently pastes
clipboard **text** into the active session's PTY. This phase extends
the same gesture to **binary clipboard content** — screenshots, zips,
PDFs, Word docs, anything the OS clipboard holds as a non-text blob.

Pasting a blob:

1. Writes the blob to `<session.cwd>/.clideck/paste/<safe-filename>`
   on disk via the clideck server.
2. Echoes a confirmation line into the session's terminal stream
   naming the path that just landed, so the human sees what was
   pasted AND the running agent (Claude Code / Codex / Gemini /
   OpenCode) sees the path in its own scrollback and can read it
   with the same file-reading tools it already uses.

Text paste behaviour is unchanged: still goes straight to the PTY.

## Why

Lance hits this constantly:

> "I have a screenshot of the bug. Just look at it."

Today that means: save the screenshot to disk → cd to where it
landed → tell the agent the path → wait for the agent to read it.
Every agent in clideck already knows how to read files from disk; the
gap is the clipboard-to-disk handoff. This collapses it to one
gesture.

The model already supports this naturally: every session has a `cwd`,
node-pty owns that cwd, and the agent typically reads files relative
to it. A "paste inbox" at `<cwd>/.clideck/paste/` is visible to both
the user (predictable path in their project tree) and the agent
(matches the cwd it's already running in).

## Scope

**In scope**

### Client side

- Extend the existing Ctrl+V / Cmd+V hotkey handler at
  `public/js/terminals.js` (`pasteIntoTerminal`, currently uses
  `navigator.clipboard.readText`).
- Promote to `navigator.clipboard.read()` which returns
  `ClipboardItem[]`. Branch on item types:
  - If any item has a non-text MIME (image/*, application/*, etc.):
    take the FIRST non-text item, read its blob, upload to the
    server, **do NOT** also send any text content. Binary intent
    wins when both are present.
  - If only text items: fall back to the existing
    `readText()` → PTY input path. **Zero behavioural change** for
    the text case — this is the load-bearing constraint, the
    Ctrl+V phase shipped that flow and we don't regress it.
- Show a toast on upload start ("Pasting screenshot…") that swaps
  to success ("Pasted → `.clideck/paste/<name>`") or error on
  failure. Use the existing `showToast` with a fixed `id` so a
  rapid-fire repeat doesn't stack toasts.
- Surface upload progress visibly only for blobs > 1 MB (small
  blobs land fast enough that a toast is enough). Out of scope for
  v1 — TBD if it matters.

### Server side

- New HTTP endpoint: `POST /sessions/:id/paste-blob`. Mirrors the
  existing POST handlers in `server.js` (e.g. `/opencode-events`,
  `/api/session/ask`, the various `/hook/*` endpoints).
- Request body: raw octets of the blob. Headers:
  - `Content-Type`: the blob's MIME type (e.g. `image/png`).
  - `X-Filename` (optional): hint from the client for the saved
    filename, if the clipboard item exposed one. Always sanitised
    server-side.
- Server behaviour on receipt:
  1. Resolve the session by `:id`. 404 if not found.
  2. Reject if blob size exceeds `MAX_PASTE_BLOB_BYTES` (default
     50 MiB — local-only threat model, but bound it anyway). 413.
  3. Sanitise the filename: strip path separators, control chars,
     anything outside `[A-Za-z0-9._-]`. Reject empty or all-stripped.
     Reject filenames that resolve outside `<cwd>/.clideck/paste/`.
  4. If filename absent or all-stripped, synthesise:
     `<ISO-timestamp>-<short-uuid>.<ext>` where `<ext>` is derived
     from the MIME type via a small lookup (image/png → `.png`,
     image/jpeg → `.jpg`, application/pdf → `.pdf`, application/zip
     → `.zip`, falls back to `.bin` for unknown types).
  5. mkdir -p `<cwd>/.clideck/paste/` if missing.
  6. Write the blob to that path.
  7. Broadcast a single `output` frame into the session's terminal
     stream containing a one-line confirmation that names the
     relative path:
     `\r\n[clideck] pasted <type> → .clideck/paste/<filename>\r\n`
     Use the same broadcast path PTY output uses
     (`sessions.broadcast({ type: 'output', id, data })`) so the
     agent sees it in its scrollback alongside its own output.
  8. Respond 200 with JSON
     `{ ok: true, path, filename, sizeBytes, mime }` (relative
     path) so the client can show the toast confirmation.

### Persistence / lifecycle

- Blobs are written to disk and not tracked by clideck's session
  state. They persist exactly as long as the project directory
  persists. The user is responsible for cleaning them up if the
  inbox grows.
- No auto-deletion in v1. A future enhancement could TTL the
  inbox (e.g. delete files > 30 days old on session close), but
  it's out of scope here.
- The `.clideck/paste/` directory is NOT added to `.gitignore`
  automatically. If the project is a git repo, the user can choose
  to gitignore it themselves. (Open question — see below.)

**Out of scope**

- Drag-and-drop file uploads (could share the same server endpoint
  but the UX entry point is different — separate phase).
- Automatic OCR / format conversion of pasted blobs — agent
  decides what to do with the file.
- Cross-session blob sharing — keep blobs scoped to the session
  they were pasted into.
- Right-click → Paste context-menu wiring for blobs. The current
  right-click → Paste calls `pasteIntoTerminal` which only handles
  text. v1 lets users hit Ctrl+V for blobs; right-click stays
  text-only and we revisit if it confuses users.
- "Paste image as base64 into the PTY" as a fallback for agents
  that can't read files. Not needed for any of clideck's first-
  class agents.
- Server-side image previews / thumbnails in the toast or sidebar.
- Anything specific to the containerised clideck (clideck-docker)
  beyond what falls out naturally — when Phase 2 (VOL-01) bind-mounts
  the project tree, the paste path becomes visible on both sides,
  no special work needed.

## Acceptance criteria

1. With a screenshot on the clipboard (an image MIME type), pressing
   Ctrl+V in a focused clideck terminal:
   - Does NOT type anything into the PTY.
   - POSTs the image bytes to `/sessions/:id/paste-blob`.
   - Results in a file at `<cwd>/.clideck/paste/<timestamp>-…png`
     on disk with the screenshot's bytes.
   - Echoes a `[clideck] pasted image/png → .clideck/paste/…` line
     into the terminal scrollback.
   - Shows a "Pasted → …" toast.

2. With text on the clipboard and NO binary item, Ctrl+V behaves
   exactly as before this phase: pastes text into the PTY, no
   server endpoint hit, no toast, no inbox file. Existing E2E
   `ctrl-v-paste.spec.js` continues to pass unchanged.

3. With BOTH text and a binary item on the clipboard (some apps
   put both `text/html` and `image/png`), the binary item wins:
   blob is uploaded, no text is sent to the PTY.

4. Pasting a file larger than the size limit results in:
   - The client receives a 413 from the server.
   - An error toast surfaces the rejection.
   - No file is written to the inbox.
   - The terminal scrollback is unchanged (no confirmation line).

5. The server rejects (400) any filename that would resolve outside
   `<cwd>/.clideck/paste/`. Verified by sending
   `X-Filename: ../../etc/passwd` style payloads.

6. The server rejects (404) requests for an unknown session id.

7. Multiple rapid pastes do not stack toasts (fixed-id toast
   replaces).

8. All existing Vitest suites pass.

9. All existing Playwright E2E suites pass.

10. New unit-test coverage for the server-side: blob write to the
    right path, filename sanitisation (rejects path traversal,
    strips weird chars), size-limit enforcement, MIME→extension
    fallback, 404 on unknown session.

11. New E2E coverage (where feasible — see testing gaps below) for
    the client→server round-trip with a known image.

## Non-goals / explicit constraints

- Do **NOT** push to `origin` without explicit per-commit ship-it.
  `origin` is GitHub.
- Text-paste behaviour MUST NOT regress. The Ctrl+V text path is
  load-bearing for dictation tools (TypeWhisper et al) and the
  existing E2E spec is the gate.
- Filename sanitisation MUST resolve under
  `<cwd>/.clideck/paste/`. No exceptions, no escape hatches. Use
  `path.resolve()` + prefix check, not regex stripping alone.
- Blob writes MUST land synchronously on disk before the server
  responds 200 — no fire-and-forget. The toast confirmation needs
  to be truthful.
- The terminal confirmation line MUST use `\r\n` line endings (raw
  PTY-style), since it's written through the same `output`
  broadcast path that xterm.js consumes.
- The server endpoint MUST stream the request body — don't
  buffer the whole blob in memory before checking size. For v1 a
  simple Content-Length pre-check + early-bail is acceptable;
  streaming-as-it-arrives is a follow-up if size limits creep up.

## Implementation pointers

- Existing text-paste site:
  `public/js/terminals.js#pasteIntoTerminal` (line ~152).
- Existing Ctrl+V hotkey registration: `public/js/hotkeys.js`
  (set up during the 2026-05-16-ctrl-v-paste phase).
- Existing POST endpoint patterns to mirror: `server.js` for the
  hook endpoints and `/opencode-events`.
- Session lookup helpers: `sessions.getSessions()`, `sessions.broadcast()`.
- Toast helper: `showToast` from `public/js/toast.js`.
- The `cwd` field on each session record is the resolved working
  directory: `sessions.get(id).cwd`.
- Existing Vitest pattern for happy-dom DOM tests:
  `tests/hotkeys-paste.test.js`.
- Existing Vitest pattern for server modules:
  `tests/session-pause.test.js`.

## Open questions

- **Auto-gitignore `.clideck/`?** Pro: keeps pasted blobs out of
  the user's commits by default. Con: silently modifying a project's
  .gitignore is invasive. Default: do nothing in v1; if it bites,
  add a one-line option in settings later.
- **What about clipboards containing a file-path reference (e.g.
  copy file in File Explorer → `FileGroupDescriptor` / `FileContents`
  on Windows)?** Probably out of scope — the browser's
  `navigator.clipboard.read()` API doesn't expose those shell-shell
  formats. If we need it, drag-and-drop is the better entry point.
- **Per-session cwd quota?** v1 enforces a per-blob size limit only.
  A future phase could enforce a total-inbox-size cap.
