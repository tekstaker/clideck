# Phase 16: Device pairing for first-time mobile access — Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous-mode defaults — `/gsd-discuss-phase` was skipped per the autonomous-execution convention used elsewhere this session). Every pinning below is reversible by re-running `/gsd-discuss-phase 16` and re-planning; each one carries a one-line rationale so the future override is informed.

<domain>
## Phase Boundary

Phase 16 ships **device pairing** so only linked devices can drive clideck. After this phase:

- Every WebSocket upgrade carries a server-issued opaque per-device token; the server rejects unknown tokens with close code **4401** before they reach `sessions.clients.add(ws)` in `handlers.js`.
- First-time pairing on a new browser/phone goes through a `/pair` view that consumes a 6-char single-use OTP.
- Settings → "Linked devices" lists every paired device, edit-label inline, and provides a Revoke button that **closes any currently-open WebSocket** belonging to that token (not just "the next reconnect fails").
- Persistence in a new `.clideck/devices.json` (token *hashes* only — raw token returned once at pair-time).

**Depends on:** Phase 15 (`2026-06-02-mobile-desktop-concurrent-access`) — pairing gates the mobile dashboard, which only exists once Phase 15 lands.

**Out of scope** (locked by SPEC): public exposure (VPN stays the outer gate), TLS / cert management (lives in `clideck-docker-lance`), rate-limiting beyond the OTP TTL window, SSO / OAuth / WebAuthn passkeys, token rotation, anything that touches Phase 15's mobile-desktop work other than reading its `clients.count` broadcast.
</domain>

<decisions>
## Implementation Decisions (autonomous-mode pinning of the 6 SPEC "Open Decisions for /gsd-discuss-phase")

### D-01 — WebSocket token transport: `Sec-WebSocket-Protocol`

**Pinned:** Token is presented via `Sec-WebSocket-Protocol: clideck-device-token, <token>` on WS upgrade. Server reads it server-side from the upgrade request's `sec-websocket-protocol` header and echoes back exactly `clideck-device-token` to satisfy the subprotocol contract.

**Rationale:** Out of access logs (which `?token=` is not), out of browser address bar / history, supported natively by Node `ws` (`handleProtocols` callback) and every major proxy in clideck-docker-lance's stack (nginx, Caddy, Traefik). The niche-proxy-strips-subprotocols risk does not apply to this deployment.

**Override condition:** If the OpenVPN-fronting reverse proxy turns out to strip subprotocols (verify with `wscat -s clideck-device-token`), fall back to `?token=` and document the log-redaction discipline.

### D-02 — Owner bootstrap: server-boot OTP to stdout + `.clideck/bootstrap.otp`

**Pinned:** On first boot when `.clideck/devices.json` does not exist OR contains zero devices, the server:
1. Generates a single-use bootstrap OTP (6 chars from the same unambiguous alphabet as user-pair OTPs).
2. Prints it to stdout with a clear banner: `[clideck] bootstrap pair code: ABC-DEF — paste into /pair on the first device; expires when redeemed or on next clean shutdown.`
3. Writes it to `.clideck/bootstrap.otp` so Lance can `cat` it over SSH if he missed the log.
4. Logs nothing if `devices.json` already has ≥1 device. The bootstrap file is deleted on first successful redeem.

**Rationale:** No config dependency (clean install just works), SSH-recoverable (lost-all-devices scenario is `rm .clideck/devices.json && systemctl restart clideck`), zero UX surface (the bootstrap path is bounded to the first device).

**Override condition:** If Lance prefers in-config bootstrapping for declarative provisioning (clideck-docker-lance's compose pattern), swap to `config.json: { bootstrap_pair_code: "…" }` — same one-shot semantics.

### D-03 — Unpaired UX: hard server-side WS reject + soft client-side pair-redirect

**Pinned:** Two layers of defence:
1. **Server**: any WS upgrade missing the token or presenting an unknown token gets close code `4401` ("Unauthorized") with reason `"unpaired"`. Never touches `sessions.clients`. Never broadcasts `clients.count`.
2. **Client**: `app.js` checks `localStorage.getItem('clideck.deviceToken')` at boot. If absent, the dashboard render is skipped; instead a small standalone `/pair` view (served at `GET /pair`) is shown. After successful pair the browser reloads into the normal dashboard. If the token is *present but rejected* by the server (WS close 4401), the client clears `localStorage` and redirects to `/pair`.

**Rationale:** Server-side reject is the actual security boundary. Client-side redirect is the UX — it means the first load of an unpaired device shows the pair form immediately rather than a half-rendered empty dashboard. Soft gate leaks nothing the unauthenticated `/pair` page doesn't already (the version, the favicon).

**Override condition:** If Lance wants the harder reject (Server returns 401 on `GET /`), one-line change to the static handler.

### D-04 — Label uniqueness: free-form, no server enforcement

**Pinned:** Labels are free-form UTF-8 strings (32 char max, trimmed). No server-side uniqueness check. The "Linked devices" UI displays a `(2)`, `(3)` numeric suffix on render if multiple devices share a label, but the underlying `id` is always the source-of-truth handle.

**Rationale:** Simpler server code, simpler pairing flow (no "label taken, try another" round-trip), matches the existing project-name pattern where Lance's prior workflow allows duplicate labels with disambiguation handled at display time.

**Override condition:** If labels are ever exposed to a label-based revoke API (rather than ID-based), add server-side uniqueness.

### D-05 — Integration with Phase 15's `clients.count` broadcast: no change in scope

**Pinned:** Phase 16 does NOT modify Phase 15's `clients.count` broadcast. The amber other-client indicator continues to display "Another client is connected" generically. Device labels in the indicator are deferred to a hypothetical Phase 17+ — the data is *available* (server can compute label-per-token-hash from devices.json) but no UI work for it ships here.

**Rationale:** Keeps Phase 16's scope tight. Lance can decide post-ship whether the labelled indicator is worth a follow-up.

**Override condition:** If Lance wants labels in the indicator before Phase 16 ships, scope it as Wave 4 (client work) here rather than deferring.

### D-06 — Revoke confirmation copy + own-device stronger warning

**Pinned:** Two confirm-modal variants, reusing the `confirm.js` extension shipped in Phase 10 (`{hideConfirm, cancelLabel}` opts):

- **Revoking another device** (e.g. "Lance iPhone" from the desktop):
  > Title: *"Revoke 'Lance iPhone'?"*
  > Body: *"Lance iPhone will be signed out immediately. It can pair again with a new code."*
  > Confirm: "Revoke" (destructive — red)
  > Cancel: "Keep"

- **Revoking *this* device** (the one you're sitting at):
  > Title: *"Revoke this device?"*
  > Body: *"You'll be signed out of this browser immediately and the active session list will close. You can pair this device again with a new code from another linked device or by SSH-ing into the server."*
  > Confirm: "Revoke this device" (destructive — red)
  > Cancel: "Keep"

The "is this current device" check is `state.deviceId === row.deviceId` at modal-open time.

**Rationale:** Mirror the existing Phase 10 confirm-flow shape. Stronger own-device warning prevents the "I just revoked myself out of the only paired device on the LAN" footgun without an extra round trip.

**Override condition:** Tweak copy in code review — these are 6 lines of strings.
</decisions>

<code_context>
## Existing Code Insights (will be expanded by gsd-pattern-mapper)

Locations the planner will need to touch:

- **`handlers.js`** — WS upgrade flow lives here. Existing `onConnection(ws)` is the splice point for the auth gate. Phase 15 already added `sessions.broadcast({ type: 'clients.count', count: sessions.clients.size })` immediately after `sessions.clients.add(ws)` and inside the close handler; the auth gate must fire BEFORE the `clients.add` so unpaired sockets don't change the count. The HTTP route handlers (`/pair`, `/pair/redeem`, `/pair/mint-otp`) also live in this file — confirm by `grep -n "createServer\|httpServer\|on('request'" handlers.js`.

- **`sessions.js`** — `sessions.clients` is the broadcast Set. Phase 16 needs a parallel map `sessions.clientTokens` (or extend each ws with `ws.deviceTokenHash`) so revoke can iterate `sessions.clients`, find the ws-es belonging to the revoked token, and `ws.close(4401, 'revoked')` them. Pattern-mapper will identify whether to add a new tracking structure or augment the existing Set with a Map.

- **`config.js` / `.clideck/` data dir** — `sessions.json` persistence already follows an atomic-rename pattern; `devices.json` mirrors that exactly. Pattern-mapper will identify the existing load/save helper to reuse.

- **`public/index.html`** — Settings overlay structure. New section "Linked devices" alongside Display / Themes / Presets / Plugins. The settings sections are toggleable detail tabs.

- **`public/js/settings.js`** — Settings panel logic. New `renderLinkedDevices()` function + WS-message arm for `device.list` / `device.revoked`.

- **`public/js/state.js`** — State literal needs a `linkedDevices: []` field (mirrored from server `device.list` broadcast) and `deviceId: null` (current device's id, set after pair).

- **`public/js/app.js`** — Boot-time check for `localStorage.getItem('clideck.deviceToken')`. WS connection construction needs the subprotocol header. Reload path on WS close 4401.

- **NEW: `public/pair.html`** — Standalone pair view. Mounted at `GET /pair`. Minimal: a 6-char OTP input, a label input, a "Pair this device" button. POSTs to `/pair/redeem`, on success stores token + reloads to `/`.

- **NEW: `public/js/pair.js`** — Pair-view logic. ~50 lines.

- **NEW: `.clideck/devices.json`** — Persistence file.

- **NEW: `tests/pair-otp.test.js`, `tests/pair-redeem.test.js`, `tests/devices-json.test.js`, `tests/ws-auth-gate.test.js`, `tests/revoke-closes-socket.test.js`** — Unit tests.

- **NEW: `e2e/pair-flow.spec.js`, `e2e/revoke-flow.spec.js`** — Playwright E2E.

The planner / pattern-mapper will validate exact line numbers and produce PATTERNS.md mapping each new artifact to its closest existing analog (e.g. `handlers.js` route splice ↔ existing `/sessions/:id/paste-blob` handler).
</code_context>

<specifics>
## Specific Requirements (from SPEC.md — 9 ACs)

1. **AC1 — fresh load is gated.** Empty `localStorage` → `/pair` view, no WS, no session list.
2. **AC2 — successful pair persists.** Valid OTP → returns `{device_id, token}` → persisted to `devices.json` (only `token_hash`) → reload into dashboard with live WS.
3. **AC3 — known device reconnects silently.** Valid token in `localStorage` → direct dashboard, no pair view, no extra round-trip.
4. **AC4 — unknown token = reject.** Absent or unknown token → WS close `4401`, never in `sessions.clients`.
5. **AC5 — revoke closes live sockets.** Revoke from Settings → every open WS for that token closes within 1s.
6. **AC6 — revoked device can re-pair.** Same browser pastes a fresh OTP after revoke → success. Pairing is per-token, not per-fingerprint.
7. **AC7 — owner bootstrap path works.** Fresh install with empty `devices.json` → boot OTP path (D-02) works end-to-end.
8. **AC8 — token never leaks.** No log line (server stdout, request log, client console) contains the raw token after `/pair/redeem` returns it. Only `token_hash` in persistence + logs.
9. **AC9 — OTP single-use + TTL honored.** Reusing valid OTP fails. Using expired OTP fails. Both with distinct error codes the UI renders meaningfully.

## Threat model (recap from SPEC)

- **In scope:** guest devices on the VPN attaching to Lance's sessions; lost or sold phones with stored tokens; honest mistakes (pairing the wrong account); revoking your own current device.
- **Bounded by VPN gate:** brute force on `/pair/redeem` (already small via OTP single-use + 5min TTL + VPN-limited attack surface); LAN MITM (TLS in `clideck-docker-lance`).
- **Out of scope:** server compromise (root can read `devices.json`, but that's a fully-compromised box); XSS-borne token exfil (inherited COEP/CSP posture).
</specifics>

<deferred>
## Deferred Ideas

- **Labelled other-client indicator** (D-05 deferred) — "iPhone (Lance) is connected" instead of generic "Another client is connected". Server already has the data; UI work is a follow-up phase if Lance wants it.
- **Token rotation** — long-lived tokens until revoked. Revisit if a token-rotation event ever needs to happen separately from revoke.
- **Per-device permissions** — all linked devices have equal access in Phase 16. If Lance ever wants "this kid's iPad can read but not write" semantics, that's a separate phase.
- **Bulk revoke / "Revoke all other devices" panic button** — useful but not in the AC. Could land as Wave 4 if scope allows.
- **Device fingerprint verification** — store UA fingerprint at pair-time, warn if it changes on reconnect. Information-only, not a gate. Deferred — fingerprints leak privacy and aren't a security boundary.
- **`/pair` rate limiting** — explicitly out of scope per SPEC (OTP single-use + TTL is the mitigation).
</deferred>
