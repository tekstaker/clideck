# Phase 12: Mobile + Desktop Concurrent Access — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 12-mobile-desktop-concurrent-access
**Areas discussed:** clideck-remote retirement depth, resize no-op location, "other client connected" indicator scope, phone soft-keyboard strategy

---

## `clideck-remote` retirement depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full surgical removal | Delete `#remote-modal` + app.js block (1523–1816); strip handlers.js cache + update-check (46–95); strip status/pair/unpair/install bridges (603–640); remove `remote.*` WS message types; remove `remoteCliEnv()` helper if unused. Cleanest end state — the fork no longer 'knows' about clideck-remote at all. Largest diff but no dead code. | ✓ |
| UI-only removal, server stubs left | Delete only `#remote-modal` + the app.js block. Leave the server-side clideck-remote machinery in handlers.js as-is (orphaned). Smaller diff, larger surface area of dead code. | |
| UI + server message handlers, keep helper | Delete `#remote-modal`, app.js block, and the `case 'remote.*'` WS handlers + the `remote.update` push on connect. Leave `remoteCliEnv()` and low-level helpers. Middle ground. | |

**User's choice:** Full surgical removal.
**Notes:** Lance consistently favoured the leanest end state across all four questions — this option leaves no orphaned stubs, no `clideck-remote` references outside `CHANGELOG.md` / `.planning/` history.

---

## Resize no-op location

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side only (defensive) | Make `sessions.resize` a no-op (or remove the `case 'resize':` line in handlers.js:355). Client `terminals.js` keeps sending `resize` messages on viewport change — they're just ignored. Trivial change. Existing client code untouched. Robust to older fork checkouts or third-party clients. | ✓ |
| Both layers (defensive + explicit) | Server no-op + remove the client-side `send({ type: 'resize', … })` calls in `terminals.js` (~723, 732, 750). Stops gratuitous WS traffic; makes the new contract obvious. | |
| Client-side only (don't send) | Leave server resize handler as-is; just stop the client from sending `resize`. Risks future regressions if anything else still sends resize. | |

**User's choice:** Server-side only (defensive).
**Notes:** Defensive server + trusting client matches the existing codebase grain. The redundant WS resize traffic is tiny and acceptable. Survives older fork checkouts.

---

## "Other client connected" indicator scope

| Option | Description | Selected |
|--------|-------------|----------|
| Server-wide count (matches SPEC literal) | Server tracks `sessions.clients.size` and broadcasts `{type:'clients.count', count}` on connect/disconnect. Indicator appears on EVERY session row in EVERY client whenever ≥2 clients are connected anywhere. Simple, low blast radius. Doesn't tell you which sessions are actively shared. | ✓ |
| Per-session presence (more useful) | Server tracks which sessions each client is attached to. Adds a `{type:'session.attach', id}` client→server message and a `clients.bySession` map server-side. Indicator only appears on shared sessions. Bigger lift. | |
| Per-server count now, per-session later | Ship server-wide count to satisfy the SPEC minimally; capture per-session presence as a deferred idea. | |

**User's choice:** Server-wide count (matches SPEC literal).
**Notes:** Lowest blast radius. Per-session presence captured as a deferred idea in CONTEXT.md (D-12) for a future polish phase if the coarse signal proves insufficient in real use.

---

## Phone soft-keyboard strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Lean on xterm.js textarea (verify-only) | xterm.js renders a `.xterm-helper-textarea` already. Verify that tapping the existing terminal container (the wider hit target Phase 11 added) focuses that textarea, which raises the soft keyboard on iOS/Android by default. Add NO new code unless verification fails. | ✓ |
| Explicit `touchstart`/`pointerdown` handler | Add a `touchstart`/`pointerdown` listener on the terminal container that explicitly calls `entry.term.focus()` (reusing Phase 11 `focusTerminal()`). Hedges against any iOS focus-path quirks. | |
| Hidden input proxy | Add a hidden `<input>` that captures soft-keyboard input on phone, forwards keystrokes into the WS `input` stream. Decouples touch UX from xterm.js's textarea quirks but adds a parallel input path — risk of divergence. | |

**User's choice:** Lean on xterm.js textarea (verify-only).
**Notes:** No new code unless verification fails. Captured the explicit-`touchstart` option as a documented D-15 contingency in CONTEXT.md if D-13 verification fails in real-device testing.

---

## Claude's Discretion

- Exact indicator glyph / colour / position on the session row (D-10 in CONTEXT.md). Constraint: must not collide visually with the existing unread dot or working-indicator (Phase 5 mutex). Planner can pick.
- Whether to delete `remoteCliEnv()` outright vs leave with a one-line note — depends on cross-references discovered during execution.
- Whether to delete `function resize` in `sessions.js` entirely vs leave it as an empty stub — either is fine, executor's call.
- Exact terminal-pane horizontal-scroll CSS (`overflow-x: auto` vs `scroll` vs an internal wrapper) — planner picks based on existing CSS structure.
- Responsive layout strategy: chose to extend the existing `@media (max-width: 960px)` breakpoint rather than add a new ≤480px tier (D-16). This was Claude's call inside the touch-keyboard question — Lance didn't separately push back on it.

## Deferred Ideas

- **Per-session presence indicator** (vs the chosen server-wide count) — knowing *which* specific sessions are being viewed by multiple clients. Requires a client→server `session.attach` message and a `clients.bySession` server-side map. Future polish phase if the coarse signal proves insufficient.
- **Custom modifier-key bar (Ctrl/Esc/Tab/arrows) for mobile** — explicitly out of scope per SPEC, but acknowledged as the real bar for "fluent agent-steering from phone". Follow-up phase once the baseline touch UX validates in real use.
- **Touch gestures** — swipe-from-edge for sidebar, two-finger select, etc. Polish phase.
- **Per-client controller / view-only mode** — only worth building if concurrent-input free-for-all turns out to cause real conflicts in practice.
- **Touch-keyboard fallback (D-15 path: explicit `touchstart` handler)** — only triggers if D-13 verification fails. Documented contingency, not a deferred idea per se, but captured here for completeness.
