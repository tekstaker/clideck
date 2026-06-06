# Phase 15: Mobile + Desktop Concurrent Access — Specification

> **Renumbering note (2026-06-05):** This phase was originally numbered **Phase 12** on the local `feat/mobile-desktop-concurrent-access` branch, which forked from a pre-PR-#8 view of `main`. On origin/main the slot "Phase 12" was independently taken by `2026-06-04-clipboard-image-paste` (an unrelated scope). Salvaged into `main` as **Phase 15** on 2026-06-05.
>
> Historical commit messages (`feat(handlers): retire clideck-remote bridges + broadcast clients.count on connect/close (Phase 12 R1 server + R5 server / …)`, `test(phase-12-wave-0): …`, `docs(phase-12-XX): …`) and inline-prose references to **"Phase 12"** in CONTEXT.md / PLAN files / SUMMARY files / VERIFICATION.md / REVIEW.md / UI-REVIEW.md refer to **this phase's original numbering**, not origin/main's clipboard-image-paste work. Cross-doc file-path references (e.g. `12-CONTEXT.md`) were rewritten to the new numbering (`15-CONTEXT.md`); the prose references to "Phase 12" the concept were left as-is to preserve fidelity with the git commit log.
>
> Implementation status: **all 6 plans executed** on `feat/mobile-desktop-concurrent-access` (21 commits, vitest 143/143 on-branch, 37/44 Playwright with documented gaps). The code is **NOT yet merged into main** — the remaining work for this phase is salvage / re-execution / cherry-pick / merge of the implementation, not greenfield planning.
>
> **Phase 16 (device-pairing-for-mobile-access) explicitly depends on this phase** so that the mobile surface ships gated rather than retrofitted.

**Created:** 2026-06-01
**Ambiguity score:** 0.12 (gate: ≤ 0.20)
**Requirements:** 6 locked
**Status:** implemented-on-branch (planning + execution complete on `feat/mobile-desktop-concurrent-access`; awaits salvage / merge into main — see Renumbering note above)
**Owner:** Lance Keay

## Goal

Replace the separate `clideck-remote` mobile mode with a single responsive UI that desktop and phone clients can attach to **at the same time on the same sessions**, with both clients able to inject input concurrently and view at independent visual scales without fighting over the PTY size.

## Background

Today clideck exposes two mutually exclusive surfaces:

- The full desktop dashboard (`public/index.html` + `public/js/app.js`) — session list, terminals, all controls.
- A separate **Mobile Remote** mode reached through `#remote-modal` (`public/index.html:406`, wired in `public/js/app.js:1523` onwards) which installs and shells out to the `clideck-remote` npm package as a thin alternative CLI.

You can use one OR the other — they don't drive the same sessions concurrently. Lance wants the **one** full UI accessible from both desktop and phone, attached to the **same live sessions simultaneously**, 24/7.

Plumbing that's already in place:

- `sessions.broadcast` (`sessions.js:36`) already fans every message out to **all** connected WebSocket listeners — multi-client viewing of the same session works in principle today; the desktop UI just hasn't been driven to verify it.
- `runtime.js` already binds `--host 0.0.0.0` so the server is LAN-reachable; the Dockerfile.dev container exposes 4010 (currently loopback-only in `docker-compose.dev.yml`).
- A partial responsive layout exists at `@media (max-width: 960px)` in `public/index.html` — slide-over sidebar via `mobile-nav-toggle` (`public/js/app.js:496–503`).

What's broken / missing:

- **PTY size is a shared single value.** `sessions.resize(msg)` (`sessions.js:368`) calls `pty.resize(msg.cols, msg.rows)` on every client `resize` message — two viewers at different viewports fight: whoever moved/resized last reshapes the agent's terminal under the other client. The current client (`terminals.js:497`) auto-derives cols/rows from `window.innerWidth/innerHeight`, so a phone joining a session would shrink the desktop user's PTY.
- **The mobile-remote modal is dead weight** once a responsive full UI exists — it duplicates session-management UI for a thin-CLI use case that the full UI will subsume.
- **No "another client is connected" indicator.** With concurrent input enabled, you'd silently get keystrokes from a forgotten phone session. Soft awareness wanted.
- **Touch interaction in the terminal is unverified.** xterm.js renders on phone but tap-to-focus / soft-keyboard interaction with the terminal pane hasn't been exercised in this fork.

Threat-model context (decided in todo 2026-05-29): mobile access is **private over OpenVPN**, not public internet. The unauthenticated dashboard is acceptable under VPN-only exposure; this phase explicitly does NOT add auth. Public exposure is forbidden without auth first.

Deployment, persistent volumes, reverse proxy, TLS, and OpenVPN routing live in the **separate `clideck-docker-lance` project**, not in this phase or this repo.

## Requirements

1. **Retire the mobile-remote modal.** The `#remote-modal` flow is removed entirely; the full UI becomes the only surface.
   - Current: `#remote-modal` exists at `public/index.html:406` with intro/install/log states; `public/js/app.js:1523–1816` drives an "install clideck-remote via npm" path; a launcher entry (toolbar button or sidebar item) opens it.
   - Target: `#remote-modal` and its launcher are deleted; the `app.js` remote-modal block (the section at `public/js/app.js:1523`) is removed; any references to `clideck-remote` in the dashboard UI are gone. Server-side `clideck-remote` plumbing (if any in `server.js` / `handlers.js`) is removed if it has no other consumer.
   - Acceptance: `git grep -n "remote-modal\|clideck-remote"` in `public/` and the top-level `*.js` returns no matches outside of CHANGELOG/`.planning/` history; the dashboard loads with no broken element references in the console.

2. **PTY size is locked at session creation; later `resize` messages are ignored.** Per-client visual decoupling replaces the current shared-resize behaviour.
   - Current: `sessions.resize(msg)` (`sessions.js:368`) calls `pty.resize` on every `{type:'resize'}` message; `handlers.js:355` dispatches it. Client computes cols/rows from local viewport on every fit (`terminals.js:497`, `:723–732`) and sends a `resize` whenever the local viewport changes — two clients at different sizes overwrite each other.
   - Target: the PTY's cols/rows are set once by the creator's viewport in `spawnSession(..., msg.cols, msg.rows)` (`sessions.js:85`, `:220`, `:496`) and never changed afterwards. The server's `resize` handler becomes a no-op (or is removed from `handlers.js:355`). Each client renders the locked terminal at its own visual scale; phones letterbox or scroll horizontally rather than reshaping the PTY.
   - Acceptance: with a session created from desktop (e.g. 120×30), connecting a second client at a smaller viewport does NOT change the agent's apparent terminal width — running `tput cols` inside the session reports the same value as before the second client connected. Sending a hand-crafted `{type:'resize', id, cols: 40, rows: 10}` over the WS does not change the PTY size (`stty size` unchanged).

3. **Touch baseline: tap-to-focus + soft keyboard work on phone.** Minimum bar for "usable on phone" is unblocked typing into a session.
   - Current: terminal pane focus restoration was just stabilised in Phase 11 (`focusTerminal()`), but phone tap-to-focus behaviour hasn't been verified; the soft keyboard's interaction with xterm.js in this fork is unproven.
   - Target: on a phone, tapping anywhere in the terminal container raises the native soft keyboard and routes typed characters to the PTY; Enter submits; the typed line appears in terminal output. No custom modifier-key bar (Ctrl/Esc/Tab/arrows) is added in this phase — that's out of scope.
   - Acceptance: on an Android or iOS browser (real device or DevTools mobile emulation with touch events), tapping the terminal pane raises the soft keyboard; typing "echo hello" + tapping Enter produces "hello" in the terminal output, observed from both phone and concurrently-attached desktop.

4. **Same-session concurrency works for both viewing AND input.** Both clients see the same output and either client's keystrokes reach the PTY.
   - Current: `sessions.broadcast` already fans `{type:'output', id, data}` to all listeners (`sessions.js:151`), and the input handler (`case 'input': sessions.input(msg)` in `handlers.js`) is a passthrough — so this should largely already work, but it's never been exercised with two clients on one session.
   - Target: with desktop + phone simultaneously attached to a session, characters typed on either device appear in the terminal of *both* devices in real time; the PTY sees both input streams (last-keystroke-wins on any race is acceptable).
   - Acceptance: scripted two-client test (or manual two-tab test) drives `echo A` from client 1 and `echo B` from client 2 in quick succession; both clients observe the same two `A` and `B` lines in the terminal output buffer.

5. **Soft "other client connected" indicator on session rows.** Concurrent input is allowed but the user gets visual awareness when another client is attached to the same session.
   - Current: nothing in the UI signals that another client is attached. The server tracks WS connections (`wss.on('connection', onConnection)` in `server.js:366`) but does not associate them with sessions.
   - Target: when ≥2 WS clients are present on the server, every session row in every connected client shows a small visual indicator (e.g. a dot or "•2" badge on the session row, distinguishable from existing unread/working badges). The indicator updates within a few seconds of a client connecting or disconnecting (no precise SLA required — eventual consistency is fine).
   - Acceptance: open a session in desktop browser → no indicator. Open the same dashboard URL in a second tab/device → both surfaces show the indicator on the session row(s) within 5 seconds. Close the second tab → the indicator disappears from the remaining surface within 10 seconds.

6. **Responsive layout: dashboard is operable on a phone viewport (≤ 480px width).** The terminal, session list, sidebar nav, and primary controls all function on a phone.
   - Current: a `@media (max-width: 960px)` block exists with a slide-over sidebar (`public/index.html:60`, `public/js/app.js:496`), but no specific phone-width pass on the terminal pane, toolbars, modals, or context menus. The 960px breakpoint covers tablets; phones (~320–480px) aren't a deliberate target.
   - Target: at a 375×667 (iPhone-ish) viewport, the dashboard renders without horizontal page scroll; the sidebar toggle works; tapping a session opens its terminal pane filling the visible area; the existing "Create session", "Pause", "Delete" actions are reachable (no controls obscured by chrome). The terminal itself letterboxes or scrolls horizontally to show the locked PTY width (per Requirement 2) without reshaping the PTY.
   - Acceptance: in Chromium DevTools at 375×667, manual walk-through of `[load → switch session → type into terminal → open sidebar → close sidebar → create new session → delete session]` completes with every control reachable and no visible layout overflow on the page body. (The terminal pane itself may scroll — that's expected.)

## Boundaries

**In scope:**

- Removing `#remote-modal` + the `clideck-remote` install/launch path from the dashboard UI.
- Stop honouring client `resize` messages server-side; PTY cols/rows is fixed at session creation.
- Client-side visual scaling / letterbox / horizontal scroll for clients at smaller viewports than the locked PTY.
- A soft visual indicator on session rows when ≥2 clients are connected to the server.
- Phone-viewport (≤ 480px) responsive pass on the dashboard so the existing controls are reachable and the terminal is interactable via the native soft keyboard.
- A two-client smoke test (manual or scripted) exercising concurrent attach + concurrent input on the same session.

**Out of scope:**

- **Auth / login / session tokens at the dashboard entry.** — VPN-only access (private LAN, OpenVPN) is the agreed exposure model; app-level auth is optional defense-in-depth, not a blocker. Do NOT add auth in this phase without a separate decision first.
- **Always-on container, restart policies, persistent volumes, reverse proxy, TLS, LAN subdomain, OpenVPN routing, split-horizon DNS.** — Those live in the sibling `clideck-docker-lance` project and are coordinated separately.
- **A custom modifier-key bar (Ctrl / Esc / Tab / arrows) for mobile.** — Acknowledged as the real bar for "fluent agent-steering from phone" but explicitly deferred to a later phase; this phase delivers the typing-and-Enter baseline only.
- **Touch gestures (swipe-from-edge for sidebar, two-finger select, etc.).** — Existing toggle button is sufficient; gestures are a polish phase.
- **Per-client controller / view-only modes.** — Concurrent input is free-for-all in this phase; the soft indicator is the entire awareness mechanism. Controller-style locking would be a future phase if conflicts become a real problem.
- **Multi-user session sharing across different Lance-accounts.** — Single-user model only; both clients are assumed to be the same person.
- **Upstreaming any of this to `rustykuntz/clideck`.** — Fork-only.

## Constraints

- **Threat model is bounded to LAN/VPN peers.** Access is private over OpenVPN to a LAN/internal IP, not public internet. The phase must NOT add or rely on app-level auth; equally, it must not introduce a new public-facing surface. If any change incidentally widens the threat surface (e.g. binds a new port, accepts new origins), call it out explicitly so it can be reviewed.
- **Backward-compatibility with existing sessions on disk.** Existing saved sessions (creator-set cols/rows) must continue to attach correctly under the new "locked at create" rule — there is no migration step; the existing saved cols/rows from `state.cfg` are simply trusted as the lock value.
- **The `resize` WebSocket message type must remain accepted** (clients may still send it during transition / from older fork checkouts) but become a no-op server-side. Do not throw or close the WS on receipt.
- **No new heavy dependencies.** Use existing Tailwind utilities + vanilla JS patterns already in `public/`. No new framework or component library.
- **Stay within the existing Phase 9 (`display-sizing.js`) and Phase 11 (`focusTerminal`) architecture.** Reuse the focus/sizing primitives those phases established — do not invent parallel ones.

## Acceptance Criteria

- [ ] `#remote-modal` and the `clideck-remote` install/launch path are removed from `public/index.html` and `public/js/app.js`; `git grep -n "remote-modal\|clideck-remote"` returns no matches outside CHANGELOG / `.planning/` / `lib/install-clideck-remote*` orphan-if-removed.
- [ ] Server `resize` handler is a no-op (or removed); sending a `{type:'resize', id, cols, rows}` WS message does NOT change the PTY's `stty size` output.
- [ ] PTY's cols/rows is the value passed at `spawnSession()` time and never mutates for the lifetime of the session.
- [ ] Two clients (e.g. two browser tabs at different sizes, or desktop + phone) can attach to the same session simultaneously; both observe identical output stream; either client's keystrokes reach the PTY; neither client's viewport change reshapes the other's PTY.
- [ ] When ≥2 clients are connected to the server, a soft "other client" indicator appears on session rows in every connected client; it disappears within 10 seconds after the second client disconnects.
- [ ] At a 375×667 viewport (Chromium DevTools mobile emulation or a real phone), the dashboard loads with no page-body horizontal overflow; the sidebar toggle, session switch, terminal pane (with soft keyboard), and create/pause/delete actions are all reachable.
- [ ] On a touch device, tapping the terminal pane raises the native soft keyboard; typing + Enter submits to the PTY; output is visible on both attached clients.
- [ ] All existing unit + E2E test suites pass; at least one new test covers either the "two-client concurrent input" or the "resize is a no-op" requirement.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                                 |
|--------------------|-------|------|--------|-----------------------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Concrete deliverables; ties to existing files/lines                   |
| Boundary Clarity   | 0.90  | 0.70 | ✓      | Explicit in/out lists; deploy concerns punted to clideck-docker-lance |
| Constraint Clarity | 0.85  | 0.65 | ✓      | VPN-only threat model locked; no-auth decision explicit               |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 8 pass/fail criteria; each tied to a requirement                      |
| **Ambiguity**      | 0.12  | ≤0.20| ✓      | Gate passed in 2 rounds                                               |

## Interview Log

| Round | Perspective            | Question summary                                                | Decision locked                                                                                       |
|-------|------------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| 1     | Boundary Keeper        | Scope: clideck-fork vs clideck-docker?                          | App-only; deploy/VPN/TLS lives in `clideck-docker-lance` (separate project)                           |
| 1     | Boundary Keeper        | Fate of `clideck-remote` modal?                                 | Retire entirely — responsive full UI replaces it                                                      |
| 1     | Failure Analyst        | PTY-size reconciliation when desktop + phone differ?            | Per-client visual decoupling — PTY size never reshapes after creation                                 |
| 2     | Failure Analyst        | Both clients input concurrently, or one viewer?                 | Both can input; soft "other client connected" indicator on session rows                               |
| 2     | Boundary Keeper        | Where does the locked PTY size come from?                       | Creator's viewport at create-time (current `spawnSession` cols/rows); later `resize` ignored          |
| 2     | Simplifier             | Minimum touch UX on phone for "usable"?                         | Software keyboard + tap-to-focus baseline; no modifier-key bar, no gestures (deferred)                |

---

*Phase: 2026-06-01-mobile-desktop-concurrent-access*
*Spec created: 2026-06-01*
*Next step: /gsd:discuss-phase 12 — implementation decisions (which resize-handler approach, indicator placement, responsive CSS strategy, etc.)*
