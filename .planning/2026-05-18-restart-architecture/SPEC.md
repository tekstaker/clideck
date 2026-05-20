# SPEC — Wrapper-process restart architecture (and lozenge polish)

**Status:** mostly shipped, pending tooltip + relocation + end-to-end verification
**Owner:** Lance Keay
**Date:** 2026-05-18

## What this delivers

Six connected pieces of work that make in-UI clideck restart actually
reliable on Windows, plus a visible connection indicator with a
readable version chip in a non-occluding location.

1. **Wrapper-process restart.** A neutral coordinator script
   (`lib/restart-wrapper.js`, ~140 lines) is spawned by the dying
   clideck. It waits for the parent PID to exit, polls until port
   4000 is free, spawns a new clideck as its own detached child
   (breaking the entanglement with Windows console handles and job
   objects), polls until the new process is listening, and writes
   timestamped diagnostics for every stage to `restart.log`.
2. **WebSocketServer error suppressor.** A handler on the WSS
   `error` event prevents an unhandled `EADDRINUSE` (which used to
   propagate up and kill the new child) from taking the process down
   during the brief window where the wrapper hands off.
3. **Bulletproof onShutdown.** Each shutdown step is wrapped in its
   own try/catch, with a 3-second hard-exit watchdog so a hung
   cleanup step (most commonly an entangled node-pty descriptor)
   cannot block port 4000 from releasing.
4. **Connection lozenge.** Always-visible status badge in the
   lower-left corner, fixed-position. Green when the WebSocket is
   OPEN, red when not. Shows live uptime and the clideck version.
   Flips on `ws.onopen` / `ws.onclose`; a 1s tick keeps the uptime
   string fresh without server polling.
5. **Readable lozenge tooltip (REMAINING WORK).** The lozenge text
   is rendered at `text-[10px] font-mono` — the version segment is
   too small to read at Lance's screen scale. A hover-revealed
   custom tooltip shows the version prominently in a larger font,
   plus the connection state + uptime as a secondary line. Custom
   tooltip, not native `title=` (which renders at the OS default
   size and defeats the point).
6. **Relocate lozenge out of the lower-left corner (REMAINING WORK).**
   The fixed-position `bottom-1.5 left-1.5 z-50` placement hovers
   over the version display and part of the gear icon below it,
   obscuring nearby UI even with `pointer-events-none`. Move the
   lozenge into the sessions panel header — just above the
   `#search-input` — where the 354 px sidebar provides plenty of
   width and the eye already lands. Drops `fixed` / `bottom-1.5` /
   `left-1.5` / `z-50` / `pointer-events-none` / `backdrop-blur-sm`;
   keeps the pill styling and the existing element IDs so
   `renderStatusBadge()` continues to find them unchanged.

## Why

The in-UI Restart button (introduced in `7f33cbf`) shipped with a
silent-failure mode: clicking Restart killed the old server but the
new child crashed with `EADDRINUSE` because the old PTY descriptors
and console handles hadn't released yet. Investigation across
multiple sessions (S143, S144, S147, S153, S158) revealed three
distinct contributing causes:

- **Console / job-object entanglement on Windows.** A child spawned
  by the dying parent inherits handles that keep the OS view of
  port 4000 alive, even after the parent process is gone. Spawning
  a *neutral* wrapper that then spawns the new clideck breaks the
  inheritance chain.
- **node-pty cleanup can hang indefinitely.** A stuck shell teardown
  in `onShutdown` would prevent the listening socket from closing,
  even though the new child was already trying to bind. The
  watchdog + per-step try/catch make this survivable.
- **Unhandled `error` events on the WSS.** The first `EADDRINUSE`
  during a race propagated as an unhandled error and took the
  surviving listener down. Catching it explicitly lets the wrapper's
  retry-listen loop work as designed.

The lozenge separately addressed a recurring confusion: Lance
couldn't tell at a glance whether his browser was connected to the
current server, a stale tab, or a server mid-restart. The lozenge is
that "am I connected?" indicator. The tooltip is the natural
follow-on — the data is visible but unreadable.

Relocation is the third follow-on: the fixed-corner position made
the lozenge feel like it was *on top of* the app rather than part of
it, occluding the version chip and gear icon underneath. Putting it
in the sidebar header turns it into a first-class member of the UI
instead of a floating overlay.

## Scope

**In scope (mostly shipped on `fix/restart-button`)**

- `lib/restart-wrapper.js` — 140-line neutral coordinator. Reads
  `CLIDECK_RESTART_PARENT_PID`, `CLIDECK_RESTART_PORT`,
  `CLIDECK_RESTART_ARGV` env vars. Four-stage handoff with per-stage
  timeouts and forensic logging.
- `server.js#requestRestart()` — spawns `lib/restart-wrapper.js`
  instead of `argv[0]` directly. Detached, ignores parent stdio.
- WSS error handler — `wss.on('error', …)` suppresses
  `EADDRINUSE` and other unhandled listen failures during the
  restart window.
- Bulletproof `onShutdown` — per-step try/catch wrappers, 3-second
  `setTimeout(() => process.exit(1), 3000)` hard-exit watchdog.
- Connection lozenge — `#app-status-badge` in `public/index.html`,
  `renderStatusBadge()` in `public/js/app.js`, driven by
  `state.ws.readyState` + `connectedAt` timestamp + 1s interval
  tick. Tailwind-classed for color states.
- Version bump 1.31.4 → 1.31.5.

**In scope (REMAINING)**

- Lozenge tooltip:
  - Hover-revealed custom tooltip on `#app-status-badge` (not
    native `title=`).
  - Shows version line at `text-base` or `text-sm font-semibold`
    (12–14px); shows connection state + uptime as a secondary
    smaller line.
  - Updated from `renderStatusBadge()` whenever the badge text is
    rebuilt — single source of truth.
  - After relocation (below), the lozenge is in-flow inside
    `#panel-chats`, so the inherited `pointer-events-none`
    constraint is gone and the tooltip needs no special hit-area
    handling. If implemented **before** relocation, flip just the
    badge's own hit area to `pointer-events-auto`.

- Lozenge relocation:
  - Remove the `<div id="app-status-badge">` block at
    `public/index.html:134-138`.
  - Insert into `#panel-chats` above the search row at
    `public/index.html:191`, either as a sibling of the search
    wrapper or as a full-width header strip.
  - Drop the Tailwind classes that were only needed for the
    fixed-corner overlay: `fixed`, `bottom-1.5`, `left-1.5`,
    `z-50`, `pointer-events-none`, `backdrop-blur-sm`.
  - Keep `#app-status-badge`, `#app-status-dot`, `#app-status-text`
    IDs so `renderStatusBadge()` in `public/js/app.js:53-76`
    requires no JS changes.
  - Delete the stale inline comment at `public/index.html:134`
    ("…so it doesn't block clicks on the nav rail it sits over") —
    no longer relevant once in-flow.
  - Acceptable trade: ~24–28 px of sidebar real estate above the
    search input. If that feels cramped in practice, fold the
    lozenge into the title row at line 175 alongside
    `#save-indicator` instead.

**Out of scope**

- Cross-platform parity on Linux/macOS for the wrapper — current
  hardening targets Windows-specific entanglement; Unix process
  semantics already handle this case correctly with the existing
  detached spawn pattern, but no formal verification has been done
  on those platforms.
- A user-facing settings toggle to disable the lozenge or change
  its position. Always-on, lower-left, fixed.
- Click-to-copy on the version inside the tooltip. Useful for
  filing issues; capture as a follow-up if it surfaces.
- Auto-update / version-check integration in the lozenge.

## Acceptance criteria

1. Clicking the Restart button in the UI on Windows results in:
   - Old clideck process exits cleanly within ~3 seconds.
   - Port 4000 releases within ~5 seconds of old-process exit.
   - New clideck process starts and binds port 4000 without
     `EADDRINUSE`.
   - `restart.log` contains four timestamped wrapper stages
     (parent-exit, port-free, spawn, listening) for forensics.
2. The connection lozenge is visible at all times when the page is
   loaded — after relocation, sitting inside the sessions panel
   header above the `#search-input`. Before relocation, in the
   lower-left corner.
3. The lozenge is **green** when `state.ws.readyState === OPEN`,
   showing `connected · <uptime> · v<version>`.
4. The lozenge is **red** when the WebSocket is closed,
   reconnecting, or restart-pending, showing the appropriate
   descriptor.
5. The lozenge `uptime` segment updates every second without server
   polling.
6. **Hovering the lozenge reveals a custom tooltip** showing the
   version in a comfortably readable font size (≥ 12px) and the
   connection state + uptime as a secondary line.
7. After relocation, the lozenge sits in-flow inside `#panel-chats`
   above the `#search-input`, does not overlap the version display
   or gear icon, and does not require `pointer-events-none` to
   coexist with anything. (Pre-relocation acceptance: the lozenge
   does not interfere with clicks on the nav rail it sits over —
   except in the badge's own hit area for the hover tooltip.)
8. All 27 existing Vitest unit tests pass, including the
   restart-bootid handshake test that was added in `c729b60`.
9. Manual smoke test on Windows: launch clideck, click Restart,
   verify lozenge flips red → green, verify a fresh uptime starts
   from 0s.
10. The clideck title row, "+", bulk-import, and new-project icon
    buttons in the sidebar header remain fully visible and clickable
    after the lozenge is inserted above the search row — the new
    row does not visually crowd them.

## Non-goals / explicit constraints

- Do **not** push to `origin` without an explicit per-commit "ship
  it" — `origin` is GitHub.
- The wrapper script must be **dependency-free** (no plugins, no
  PTYs, no WSS, no node-pty). It runs in clideck's failure mode, so
  it can't depend on anything clideck might break.
- The `pointer-events-none` constraint on `#app-status-badge` is
  intentional **only while the badge is the fixed-corner overlay**
  (documented in `public/index.html:134-135`). It becomes moot once
  the badge is relocated in-flow into the sidebar header
  (deliverable 6) and should be removed at that point. If
  implementing the tooltip first, flip to `pointer-events-auto`
  on the badge's own hit area only; do not remove the constraint
  wholesale until relocation lands.
- Forensic logging in `restart.log` is load-bearing — do not drop
  the timestamped per-stage trace.

## Implementation pointers

- Wrapper: `lib/restart-wrapper.js` — already on the branch.
- Server-side restart entrypoint: `server.js#requestRestart()`.
- Lozenge element: `public/index.html:134-135`.
- Lozenge renderer: `public/js/app.js:39-87`.
- Tooltip work site: `public/index.html:135` (add sibling/child
  tooltip element) and `public/js/app.js:53-76` (update tooltip
  text from `renderStatusBadge`).
- Relocation insertion site: inside `#panel-chats` at
  `public/index.html:191`, above the `<div class="relative">…
  <input id="search-input" …>` block at lines 192-195.
- Existing relevant commits on `fix/restart-button`: `61e4334`
  (safety net + lozenge), `b6ee84f` (wrapper architecture).
