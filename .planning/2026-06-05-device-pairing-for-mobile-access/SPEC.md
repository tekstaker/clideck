# SPEC — Device pairing so only linked devices can use the app

**Status:** planned (not yet through `/gsd-discuss-phase` / `/gsd-plan-phase` — seeded from one pending todo 2026-06-05)
**Owner:** Lance Keay
**Date:** 2026-06-05

## What this delivers

A first-time pairing flow that gates every WebSocket connection on a
server-issued per-device token. After this phase ships:

1. The first time Lance loads the dashboard on a new phone (or any new
   browser), he sees a **Pair** view instead of the session list. He enters a
   short OTP code that an already-paired device — or, on first run, the
   server boot log — generated. The server validates the OTP, mints a long-
   lived opaque device token, returns it once, and the phone stores it in
   `localStorage` (or IndexedDB for iOS long-retention). Subsequent loads
   reconnect transparently with no friction.

2. **Settings → "Linked devices"** lists every paired device with its
   label, when it was paired, when it last connected, and whether it's live
   right now. Each row has a **Revoke** button. Revoking deletes the token
   and **closes any currently-open WebSocket** belonging to that token —
   not just "the next reconnect fails."

3. Any WebSocket upgrade missing or presenting an unknown token gets
   rejected with close code **4401** before it reaches
   `sessions.clients.add(ws)` in `handlers.js`. No session data, no
   `clients.count` broadcast, no plugin pills sent to unpaired sockets.

## Why

Phase 12 on the local `feat/mobile-desktop-concurrent-access` branch
deliberately deferred app-level auth — the SPEC there was explicit:
*"Access is VPN-only (private LAN over OpenVPN), explicitly NOT public —
no app-level auth added in this phase."* That works while clideck is
reachable only on the LAN/VPN, but it means any device on the VPN can
attach to any session. There is no record of which phones are "mine" vs.
"a guest's spare tablet on the same VPN" and no way to revoke a phone
that gets swapped or compromised short of reformatting it.

Mobile + desktop concurrent access (the work on the orphaned local branch)
makes phones a real surface for the first time. Phones are no longer a
fallback — they're the primary way Lance reaches a long-running agent on
the LAN from outside the house. The "every browser on the VPN is trusted"
assumption stops being safe enough at that point.

VPN remains the outer gate; pairing is **defence-in-depth** for two
concrete cases:
- A guest tablet that's joined the VPN for some unrelated reason can no
  longer drive Lance's terminals.
- A lost or sold phone can be revoked from any other paired device
  without rotating any other shared credentials.

## Scope

**In scope**

### `.clideck/devices.json` persistence layer

- New file at the existing `.clideck/` data dir alongside `paste/` and
  `sessions.json`. Schema:
  ```json
  {
    "devices": [
      {
        "id":          "dev_2nKqW…",       // opaque id, used as label key
        "label":       "Lance iPhone",      // free-text, editable
        "fingerprint": "ua-hash-…",         // best-effort UA fingerprint, hint only
        "paired_at":   "2026-06-05T…Z",
        "last_seen":   "2026-06-05T…Z",
        "token_hash":  "sha256:abc…"        // ONLY the hash; raw token never persisted
      }
    ],
    "version": 1
  }
  ```
- Constant-time compare on token lookup (`crypto.timingSafeEqual`).
- File-write through the same locking discipline as `sessions.json` (atomic
  rename, EOL on POSIX).

### Pairing handshake

- New unauthenticated routes:
  - `GET /pair` — static page that prompts for an OTP and a friendly label.
  - `POST /pair/redeem` — body `{ otp, label, ua_hint }`, returns
    `{ device_id, token }` once on success or `{ error }` on bad / expired OTP.
- New authenticated route (called from Settings on an already-paired client):
  - `POST /pair/mint-otp` — body `{ ttl_seconds: 300 }`, returns
    `{ otp, expires_at }`. OTP is 6 chars from an unambiguous alphabet (no
    `0/O/1/I/l`). Single-use, 5 min TTL by default.

### WebSocket authentication gate

- Server's WS-upgrade handler in `handlers.js` inspects the token from
  either `Sec-WebSocket-Protocol` (preferred — kept out of access logs) or
  `?token=` query (fallback — universally proxied). Open question for
  discuss-phase: which is the LOCKED transport?
- If the token hash is in `devices.json`: update `last_seen`, proceed to
  the existing `onConnection` flow.
- If absent or unknown: close with code `4401` ("Unauthorized") and a
  clear reason string. Do not add to `sessions.clients`. Do not broadcast
  the existing `clients.count` count change.

### Owner bootstrap (chicken-and-egg)

- The first device has nothing to pair against. Pin one of:
  - **(a) Server boot OTP**: on first boot when `devices.json` is empty,
    server prints a one-shot OTP to stdout (and to a `.clideck/bootstrap.otp`
    file readable by Lance over SSH if he missed the log). Consumed on first
    successful `/pair/redeem`.
  - **(b) Open-window first-pair**: while `devices.json` is empty, any
    `/pair/redeem` call succeeds and creates the first device. Lock down
    after that.
  - **(c) Config-driven OTP**: `config.json` has a `bootstrap_pair_code`
    field that the owner sets manually before first launch; consumed once.
- Discuss-phase locks one and ships it; the other two stay documented
  alternatives.

### Settings → Linked devices panel

- New section in the existing Settings overlay, alongside Display, Themes,
  Presets, Plugins. Table layout:
  | Label | Paired | Last seen | Live now | Action |
  | This device (Lance iPhone) | 2026-06-05 | now | ● | Revoke |
- Edit-label inline. Revoke triggers an `AskUserQuestion` (or the project's
  confirm modal) — "Revoke 'Lance iPhone'? It will be signed out
  immediately." On confirm: server deletes the row from `devices.json`,
  closes every open WS whose `token_hash` matches, broadcasts a
  `device.revoked` to the remaining clients so any UI showing the device
  list updates.

### Tests

- Unit: OTP minting/expiry, token hash compare, devices.json round-trip,
  WS-upgrade reject path, revoke-closes-socket invariant.
- E2E: pair a new device end-to-end via the `/pair` form, reconnect with a
  stored token, revoke via Settings → confirm the WS closes.

**Out of scope**

- Public exposure — VPN remains the outer gate.
- TLS / cert management — lives in `clideck-docker-lance`.
- Rate-limiting on `/pair/redeem` beyond the OTP's single-use + TTL window
  (the 6-char alphabet × 5 min TTL × single-use leaves a vanishingly small
  brute-force window over the VPN; revisit only if pairing is ever exposed
  publicly).
- SSO / OAuth / WebAuthn passkeys — bespoke token model is the locked
  choice for first-pass simplicity.
- Token rotation — long-lived tokens until revoked. Revisit if a token-
  rotation event ever needs to happen separately from revoke.
- Anything in the orphaned `feat/mobile-desktop-concurrent-access` branch
  (the indicator, the resize lock, the deletion sweep) — those are a
  separate phase decision.

## Acceptance Criteria

To be refined in `/gsd-spec-phase`. Initial sketch:

1. **AC1 — fresh load is gated.** A browser with empty `localStorage`
   navigating to `/` is redirected to `/pair` (or shown the pair view
   in-place). No session list. No WS established.

2. **AC2 — successful pair persists.** Entering a valid OTP at `/pair`
   returns a token, persists `{id, label, token_hash, …}` to
   `devices.json`, and reloads into the normal dashboard with a live WS.

3. **AC3 — known device reconnects silently.** A browser with a valid
   token in `localStorage` connects directly to the dashboard with no
   pair view, no extra round-trip.

4. **AC4 — unknown token = reject.** A WS upgrade with an absent or
   unknown token gets close code `4401` and never appears in
   `sessions.clients`.

5. **AC5 — revoke closes live sockets.** Revoking a device from
   Settings closes every open WS belonging to that token within 1s,
   not just "the next reconnect fails."

6. **AC6 — revoked device can re-pair.** After revoke, the same browser
   pasting a fresh OTP succeeds (no permanent block — pairing is per-
   token, not per-browser-fingerprint).

7. **AC7 — owner bootstrap path works.** A fresh install with empty
   `devices.json` can be paired without going through the chicken-and-egg
   dead-end. The exact mechanism is the locked-choice from discuss-phase.

8. **AC8 — token never leaks.** No log line (server stdout, request log,
   client console) contains the raw token after `/pair/redeem` returns it.
   Only `token_hash` appears in persistence and logs.

9. **AC9 — OTP single-use + TTL honored.** Redeeming a valid OTP a second
   time fails. Redeeming an expired OTP fails. Both with distinct error
   codes the UI can render meaningfully.

## Open Decisions for `/gsd-discuss-phase`

- **D-1 Token transport on WS upgrade.**
  `Sec-WebSocket-Protocol` (cleaner — out of logs, supported by all major
  proxies but some niche ones strip subprotocols) vs. `?token=` query
  param (universal, but ends up in access logs and browser history).
  Decide once and lock.

- **D-2 Owner bootstrap mechanism.**
  Server-boot OTP printed to stdout (a) vs. open-window first-pair (b)
  vs. `config.json` `bootstrap_pair_code` (c). Pick one; the lost-all-
  devices recovery path is "SSH in, `rm .clideck/devices.json`,
  re-bootstrap."

- **D-3 Unpaired UX shape.**
  Hard reject (server returns 401 on `/`) vs. soft gate (dashboard
  renders empty with a pair-first banner). Hard reject leaks less but
  is rougher; soft gate is friendlier but reveals the dashboard shell.

- **D-4 Label management.**
  Server-side enforced uniqueness vs. free-form (with a (2), (3)
  suffix in the UI on collision).

- **D-5 Integration with the mobile-desktop-concurrent-access work.**
  If/when the orphaned local branch's work is salvaged into a future
  phase, should `clients.count` broadcasts include device labels
  ("iPhone (Lance) is connected") instead of the generic "Another
  client"? That's a future-phase decision but the device-id surface
  should be ready to support it.

- **D-6 Revoke confirmation copy.**
  Exact wording, and whether revoking your *own* current device needs
  a stronger confirmation step ("you'll be signed out of this
  browser") than revoking another device.

## Threat model

- **In scope:** guest devices on the VPN attaching to Lance's sessions;
  lost or sold phones with stored tokens; honest mistakes by Lance
  (e.g. pairing the work iPad into the wrong account, then wanting to
  un-pair).
- **Bounded by VPN gate:** brute force on `/pair/redeem` (already
  vanishingly small via OTP single-use + short TTL, plus VPN limits
  who can hit the endpoint at all); MITM on the LAN (TLS in
  `clideck-docker-lance` handles this).
- **Out of scope:** server compromise (root on the server can read
  `devices.json`, but that's a fully-compromised box anyway);
  XSS-borne token exfil (mitigated by the existing strict-COEP /
  CSP posture inherited from upstream clideck — revisit only if a
  third-party plugin starts injecting markup).

## Relation to shipped + planned work

- **Phase 12 (origin/main, `2026-06-04-clipboard-image-paste`,
  v1.31.15) — unrelated;** different "Phase 12" scope. No code
  overlap.
- **Phase 14 (`2026-06-04-replayable-shell-sessions`, v1.31.17) —
  unrelated;** rehydrates sessions, doesn't gate connections.
- **Local branch `feat/mobile-desktop-concurrent-access` —
  the practical motivator.** That branch makes phones a real first-
  class surface; this phase is what makes the "any phone on the VPN"
  posture safe enough for that. If the branch is salvaged into a
  future phase, ordering matters: ideally pairing lands first so the
  mobile surface ships gated rather than ungated-then-retrofitted.
- **`clideck-docker-lance` (separate project) — orthogonal.**
  Handles deployment, reverse proxy, TLS, OpenVPN routing. This
  phase does not touch any of that.
