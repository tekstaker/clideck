# Phase 12: Mobile + Desktop Concurrent Access — Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the separate `clideck-remote` mobile mode with one responsive UI that desktop and phone clients can attach to **at the same time on the same sessions**. Both clients can inject input concurrently. PTY size is locked at session creation; per-client visual scaling replaces shared-resize. A soft "other client connected" indicator gives presence awareness. **App-only scope** — the clideck repo. Deployment, reverse-proxy, TLS, and OpenVPN routing live in the sibling `clideck-docker-lance` project, explicitly out of scope here. Access is VPN-only (private LAN); no app-level auth is added in this phase.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**6 requirements are locked.** See `SPEC.md` for full requirements, boundaries, constraints, and acceptance criteria.

Downstream agents (researcher, planner, executor, verifier) MUST read `SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Removing `#remote-modal` + the `clideck-remote` install/launch path from the dashboard UI.
- Stop honouring client `resize` messages server-side; PTY cols/rows is fixed at session creation.
- Client-side visual scaling / letterbox / horizontal scroll for clients at smaller viewports than the locked PTY.
- A soft visual indicator on session rows when ≥2 clients are connected to the server.
- Phone-viewport (≤ 480px) responsive pass on the dashboard so the existing controls are reachable and the terminal is interactable via the native soft keyboard.
- A two-client smoke test (manual or scripted) exercising concurrent attach + concurrent input on the same session.

**Out of scope (from SPEC.md):**
- Auth / login / session tokens at the dashboard entry — VPN-only exposure model; do NOT add auth in this phase.
- Always-on container, restart policies, persistent volumes, reverse proxy, TLS, LAN subdomain, OpenVPN routing, split-horizon DNS — those live in `clideck-docker-lance`.
- Custom modifier-key bar (Ctrl / Esc / Tab / arrows) for mobile — deferred to a later phase.
- Touch gestures (swipe-from-edge for sidebar, etc.) — deferred polish phase.
- Per-client controller / view-only modes — concurrent input is free-for-all; soft indicator is the entire awareness mechanism.
- Multi-user session sharing across different Lance-accounts — single-user model only.
- Upstreaming any of this to `rustykuntz/clideck`.

</spec_lock>

<decisions>
## Implementation Decisions

### `clideck-remote` retirement (R1)
- **D-01:** **Full surgical removal** — fork should no longer "know" about `clideck-remote` at all after this phase. Remove every reference outside CHANGELOG / `.planning/` history.
- **D-02:** Specific deletions (mapped to grep findings):
  - `public/index.html` — delete `#remote-modal` (line 406) and the launcher button that opens it.
  - `public/js/app.js` — delete the entire remote block at lines 1523–1816 (modal control, install spinner, install-failed log, `clideck-remote` package install path).
  - `handlers.js:46–95` — delete the `clideck-remote` update-check cache (`remoteUpdateCache`, the `npm list -g clideck-remote` and `npm view clideck-remote` execFile calls, and the `remote.update` push on connect).
  - `handlers.js:603–624` — delete the `case 'remote.status'` / `case 'remote.pair'` / `case 'remote.unpair'` WS message handlers that execFile `clideck-remote status / pair / unpair --json`.
  - `handlers.js:640` — delete the `npm install -g clideck-remote` spawn handler and the `remote.installing` progress push.
  - `handlers.js` — delete the `remoteCliEnv()` helper if it has no other consumer after the above cuts; otherwise leave with a one-line note.
  - WS message types `remote.update`, `remote.error`, `remote.installing`, `remote.status`, `remote.pair`, `remote.unpair` — gone from both client and server.
- **D-03:** Verification grep: `git grep -nE "remote-modal|clideck-remote|remote\\.(update|error|installing|status|pair|unpair)"` must return no matches outside `CHANGELOG.md` / `.planning/` / `node_modules/`.

### PTY resize lock (R2)
- **D-04:** **Server-side only** no-op. The change is in `sessions.js:368` (`function resize(msg) { sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows); }`) — replace the body with a no-op, OR remove the `case 'resize': sessions.resize(msg); break;` line in `handlers.js:355` and remove `resize` from the `sessions` exports in `sessions.js:749`.
- **D-05:** **Do not touch the client.** `terminals.js:723, 732, 750, 1084` will continue to send `{type:'resize', id, cols, rows}` on viewport changes — the server simply ignores them. This is intentional defence: it survives older fork checkouts, third-party clients, and future code paths that haven't been migrated. The redundant WS traffic is acceptable (resize messages are rare and tiny).
- **D-06:** The `spawnSession(id, cmd, parts, cwd, name, themeId, commandId, savedToken, projectId, cols, rows)` signature at `sessions.js:85` (and the two call sites at `:220` and `:496`) is unchanged — the cols/rows passed at create time become the locked value.
- **D-07:** Phone clients (and any client at a small viewport) will see a terminal that is wider than their visible area when the creator's viewport was larger. Per R2/R6 they scroll horizontally or visually scale; no PTY change.

### "Other client connected" indicator (R5)
- **D-08:** **Server-wide count** (matches SPEC literal). Server tracks `sessions.clients.size` (which already exists at `handlers.js:251`).
- **D-09:** Server-side wiring:
  - In `handlers.js` `onConnection(ws)` — after `sessions.clients.add(ws)`, broadcast `{type:'clients.count', count: sessions.clients.size}` via `sessions.broadcast`.
  - On `ws.on('close', ...)` — also remove `ws` from `sessions.clients` (verify whether this already happens; if not, add `sessions.clients.delete(ws)`) and broadcast the updated count.
  - The broadcast uses the existing `sessions.broadcast` fan-out — no new mechanism.
- **D-10:** Client-side wiring:
  - In `public/js/app.js`, add a handler for `{type:'clients.count'}` that updates a single shared piece of state (e.g. `state.otherClientsConnected = count > 1`).
  - The session-row renderer (search for where session row DOM is built; likely in `app.js` or `state.js`) reads that flag and toggles a small visual indicator on EVERY session row when `count > 1`.
  - Indicator should be visually distinct from the existing unread dot and working-indicator (Phase 5 mutex). Concretely: a small chevron / second-dot / "•+1" badge — exact glyph/colour is planner's call, but it must not collide with the existing unread/working signals.
- **D-11:** Eventual-consistency timing: the broadcast on connect/disconnect is immediate; no client-side polling. The SPEC's "within 5 seconds on appear, within 10 seconds on disappear" is satisfied trivially since broadcast is event-driven.
- **D-12:** Deferred for a future phase (captured below): per-session presence (which specific sessions are being viewed by multiple clients). The current model can't tell us that — clients don't "attach" to specific sessions in any tracked way.

### Touch keyboard + phone responsive (R3, R6)
- **D-13:** **Lean on xterm.js textarea — verify only, no new code unless verification fails.** xterm.js already renders a `.xterm-helper-textarea`; the Phase 11 wider focus-on-click target on the terminal container should propagate to the textarea, which raises the native soft keyboard on iOS Safari and Chrome Mobile by default.
- **D-14:** Verification strategy (in planner / executor): manually test on a real Android phone (Lance has access via the dev container exposed on LAN once `clideck-docker-lance` is up) — or, in DevTools mobile emulation, confirm the helper-textarea gets focus on tap. **If verification fails**, fall back to D-15.
- **D-15:** Contingency (only if D-13 fails verification): add a single `touchstart` listener on the terminal container that explicitly calls `entry.term.focus()` via the existing `focusTerminal()` primitive from Phase 11 (`public/js/terminals.js`). No hidden-input proxy. No parallel input path.
- **D-16:** Responsive layout: **extend the existing `@media (max-width: 960px)` breakpoint** rather than adding a new ≤480px tier. The sidebar overlay already triggers at 960px and works on phones. The only phone-specific work is making the terminal pane scroll horizontally when the locked PTY width exceeds the viewport (a single CSS rule: `overflow-x: auto` on the terminal container at small widths), plus a visual pass on toolbars/buttons to confirm reach at 375×667.

### Testing approach
- **D-17:** Concurrent-attach + concurrent-input verification: prefer a **scripted Playwright test** with two browser contexts driving the same session, since the fork already has Playwright wired (`playwright.config.js`, `tests/` exists). One context types `echo A`, the other types `echo B`, both observe both lines in the terminal output buffer.
- **D-18:** Mobile-viewport verification: Playwright supports `devices['iPhone 12']` and similar — the responsive walkthrough acceptance criterion (R6) can be scripted at 375×667 viewport in Chromium mobile emulation, even though the soft-keyboard verification (R3) requires a real device.
- **D-19:** Phase carries a `VERIFICATION.md` like Phases 9/10/11, noting any browser E2E that was authored but not run locally (sudo-gated Chromium libs per `clideck-docker/TEST-ENV-DEPS.md`).

### Claude's Discretion
- Exact indicator glyph / colour / position on the session row (D-10). Constraint: must not collide visually with the existing unread dot or working-indicator (Phase 5 mutex). Planner can pick.
- Whether to delete `remoteCliEnv()` outright vs leave with a one-line note (D-02) depends on cross-references that the planner / executor will discover. Heuristic: if nothing else uses it, delete.
- Whether to delete the `function resize` in `sessions.js` entirely vs leave it as a no-op stub (D-04). Either is fine — executor's call based on what's cleaner in the final diff.
- Exact terminal-pane horizontal-scroll CSS approach (D-16) — `overflow-x: auto` on the container vs `overflow-x: scroll` vs an internal wrapper. Planner picks based on existing CSS structure.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor, verifier) MUST read these before planning or implementing.**

### Phase-locked requirements
- `.planning/2026-06-01-mobile-desktop-concurrent-access/SPEC.md` — **Locked requirements** (6 reqs + 8 acceptance criteria). MUST read before any implementation work.

### Seed
- `.planning/todos/pending/2026-05-29-unified-mobile-desktop-shared-sessions.md` — Original capture, including the 2026-05-29 VPN-only decision and the rationale for retiring the `clideck-remote` modal. The Open Questions section there (PTY-size reconciliation, whether to retire `clideck-remote`) is now ALL resolved in `SPEC.md` + this CONTEXT.md.

### Adjacent phase artifacts (load-bearing for understanding the existing architecture)
- `.planning/2026-05-27-terminal-focus/SPEC.md` — Phase 11 (terminal focus / Enter-submit reliability). Establishes the `focusTerminal()` primitive (`public/js/terminals.js`) that D-15 reuses if needed.
- `.planning/2026-05-27-creator-ergonomics/SPEC.md` — Phase 10. Establishes the per-client `ws.send` reply pattern for `check-cwd` / `mkdir-cwd` — same pattern that the soft `clients.count` broadcast in D-09 uses (well, broadcast not per-client, but same WS plumbing convention).
- `.planning/2026-05-27-terminal-display-sizing/SPEC.md` — Phase 9. Establishes `public/js/display-sizing.js` and the re-fit + PTY-resize routine. **Relevant constraint:** the PTY-resize calls in that module are what D-04/D-05 make no-op-able server-side. Don't undo Phase 9's client-side fit logic — only the server's response changes.
- `.planning/2026-05-19-session-polish/SPEC.md` — Phase 5. Establishes the unread-dot / working-indicator mutex on session rows. **Relevant constraint:** the new "other client connected" indicator in D-10 must not collide visually with the two existing row-level signals.

### Code landmarks (entry points the planner will edit)
- `public/index.html:406` — `#remote-modal` block (delete per D-02).
- `public/js/app.js:1523–1816` — Remote modal driver / install spinner / install-failed log (delete per D-02).
- `handlers.js:46–95` — `remoteUpdateCache` + `npm list -g` / `npm view` (delete per D-02).
- `handlers.js:251` — `sessions.clients.add(ws)` + `onConnection` (instrumentation point for D-09).
- `handlers.js:355` — `case 'resize': sessions.resize(msg); break;` (delete or route to no-op per D-04).
- `handlers.js:603–640` — `clideck-remote status / pair / unpair / install` execFile bridges (delete per D-02).
- `sessions.js:36` — `broadcast` (used as-is by D-09).
- `sessions.js:85` — `spawnSession(..., cols, rows)` (creator's cols/rows becomes the locked value; signature unchanged).
- `sessions.js:151` — `broadcast({ type: 'output', id, data })` (already fans to every client; basis for R4 concurrent-output).
- `sessions.js:368` — `function resize(msg)` (no-op per D-04).
- `public/js/terminals.js` (lines ~723, 732, 750, 1084) — client-side `send({type:'resize', …})` callers (left untouched per D-05).
- `public/js/terminals.js` — `focusTerminal()` primitive from Phase 11 (reused only if D-13 fails verification → D-15).
- `public/index.html:60` `@media (max-width: 960px)` — responsive breakpoint to extend per D-16.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`sessions.broadcast` / `broadcastListeners`** (`sessions.js:26–57`) — fans every message to every connected WS. Already the substrate for multi-client output and now also for the `clients.count` push.
- **`sessions.clients`** (`handlers.js:251`) — a `Set<WebSocket>` populated on connect. Trivially indexed for the server-wide count in D-09. (Verify the `delete` on `close` path; add if missing.)
- **`focusTerminal()` primitive** (Phase 11, `public/js/terminals.js`) — the focus-restoration helper. Available as fallback for D-15 only; not needed for the happy path.
- **Phase 9 `display-sizing.js`** — owns the client-side fit/resize routine. Stays as-is; only the server's response to its `resize` message changes.
- **Mobile-nav overlay** (`public/index.html:60`, `public/js/app.js:496–503`) — the existing `@media (max-width: 960px)` slide-over sidebar pattern. Extended (not replaced) for phone viewports per D-16.
- **Playwright harness** (`playwright.config.js` + `tests/`) — already wired for E2E; can drive two browser contexts in parallel (D-17) and mobile-viewport emulation (D-18).

### Established Patterns
- **WS message → handler-case → session-mutator → broadcast.** Every state-changing client message follows this loop (`handlers.js` switch → `sessions.{mutator}` → `sessions.broadcast`). D-09 follows this pattern exactly.
- **`ws.send` per-client vs `sessions.broadcast` global.** Phase 10's `check-cwd` reply uses per-client; D-09's `clients.count` push uses global. Follow whichever matches the semantic: presence is global, replies are per-client.
- **Row-level signals are mutually exclusive (Phase 5 mutex).** The new "other client" indicator must coexist with unread-dot and working-indicator without visually fighting — Phase 5 SPEC's mutex pattern is the precedent. Decision (D-10): the indicator is *additive* to those two signals (not mutually exclusive), so it goes in a different visual slot.
- **Defensive server, trusting client.** The codebase has many "trust nothing from the WS" guards (Phase 10's path-traversal, Phase 8's filename-sanitisation). D-04's "server no-ops resize even though no live client should send it" follows that grain.

### Integration Points
- **Connect/disconnect lifecycle** (`handlers.js:250–270`) — single entry-point for D-09's client-count broadcast. `ws.on('close', …)` already exists for heartbeat cleanup; piggy-back the `clients.delete + broadcast` on the same handler.
- **`onConnection(ws)`** sends initial `config / themes / presets / sessions / sessions.resumable / transcript.cache / plugins / pills` payloads on connect (`handlers.js:272–279`). Add an initial `{type:'clients.count', count}` here too so newly-connected clients learn the current count immediately.
- **Session row rendering** (need to locate during planning — likely in `public/js/app.js` or `state.js`) is the single client-side consumer of D-10's indicator state.

</code_context>

<specifics>
## Specific Ideas

- Lance was decisive across all four discussion questions and consistently chose the **leanest** option: full surgical removal, server-side-only no-op, server-wide count, lean-on-xterm.js. The implementation should match that taste — minimal new abstractions, defensive server, no parallel paths to maintain. If during planning a "more elegant" path emerges that adds significant complexity, pause and check (per Lance's CLAUDE.md §14 "demand elegance on non-trivial changes" — applied in reverse: ALSO demand restraint).
- VPN-only access has been re-stated multiple times across the SPEC and the seed todo. Do NOT add auth in this phase. Do NOT widen the threat surface incidentally (no new ports bound, no new origins accepted). If anything in the implementation drift looks like it'd change exposure semantics, flag it.
- Lance corrected during spec-phase that the deploy vehicle is **`clideck-docker-lance`** (not `clideck-docker` as the todo body says). Researcher/planner should not chase deploy-side questions back to `clideck-docker`.

</specifics>

<deferred>
## Deferred Ideas

- **Per-session presence indicator** (D-12) — knowing *which* specific sessions are being viewed by multiple clients (rather than "≥2 clients connected somewhere"). Requires a client→server `session.attach` message and a `clients.bySession` server-side map. Useful polish for a later phase if Lance finds the server-wide signal too coarse.
- **Custom modifier-key bar (Ctrl/Esc/Tab/arrows) for mobile** — the SPEC out-of-scope item. The "real bar for fluent agent-steering from phone". Belongs in a follow-up phase once the baseline touch UX from this phase is validated in real use.
- **Touch gestures** — swipe-from-edge to open sidebar, two-finger select, etc. Polish phase.
- **Per-client controller / view-only mode** — server-side concept of "active client" with input-locking for other clients. Only worth building if concurrent-input free-for-all turns out to cause real conflicts in practice.
- **Soft keyboard fallback (D-15 path)** — only if D-13 verification fails. If we ship the lean path and later regressions are reported, this is the documented contingency.

### Reviewed Todos (not folded)
- None. The only pending todo at the time of this phase is the one that *seeded* this phase (`.planning/todos/pending/2026-05-29-unified-mobile-desktop-shared-sessions.md`), and its full content is now captured in `SPEC.md` + this CONTEXT.md. When Phase 12 ships, that todo can be moved to `.planning/todos/completed/`.

</deferred>

---

*Phase: 12-mobile-desktop-concurrent-access*
*Context gathered: 2026-06-01*
