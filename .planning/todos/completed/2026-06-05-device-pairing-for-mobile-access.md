---
created: 2026-06-05T11:07:07.092Z
title: Device pairing for first-time mobile access — only linked devices can connect
area: auth
promoted: true
promoted_to: 2026-06-05-device-pairing-for-mobile-access
promoted_at: 2026-06-05T11:25:00Z
files:
  - server.js
  - handlers.js
  - public/index.html
  - public/js/app.js
  - public/js/state.js
  - public/js/settings.js
  - config.js
  - .clideck/devices.json (new)
  - (related — orphaned local branch) feat/mobile-desktop-concurrent-access
---

## Problem

Phase 12 on the local branch `feat/mobile-desktop-concurrent-access` deliberately
deferred app-level auth — the SPEC's explicit decision (D-?) was "Access is
VPN-only (private LAN over OpenVPN), explicitly NOT public — no app-level auth
added in this phase." That works while clideck is reachable only on the LAN /
VPN, but it means *any* device on the VPN can attach to *any* session. There's
no record of which phones are "mine" vs. "a guest's spare tablet".

Lance wants a first-time pairing flow so that **only linked devices can use the
app**. After pairing:

- Unpaired devices that load the dashboard should NOT be able to attach a
  WebSocket to a real session — they should be redirected to a pairing view.
- Paired devices reconnect transparently — no friction after the first time.
- Lance can see the list of linked devices and revoke any of them from a
  Settings → "Linked devices" panel.

This is upstream-clideck behaviour-changing (the existing fork and origin both
auto-attach any browser hitting `/`). VPN remains the outer gate; pairing is
defence-in-depth so revoking a phone closes a real loop instead of just hoping
the user reformats it.

### Why now

The mobile-desktop-concurrent-access work on the local feature branch makes
mobile use practical for the first time. Phones are now a real user surface,
not a fallback — so the "every browser on the VPN is trusted" assumption stops
being safe enough. If/when the mobile branch is salvaged into a future phase
(its work is currently orphaned vs. upstream's Phase 12 = clipboard-image-paste),
the pairing flow should land alongside it or just before it.

## Solution

TBD — design space sketched below. Discuss-phase should pin the locked choices.

### Likely shape

- **Token model**: server mints an opaque random per-device token (e.g. 32
  bytes base64url). Stored server-side in `.clideck/devices.json` as
  `[{id, label, fingerprint, paired_at, last_seen, token_hash}]`. Token itself
  is only returned to the client once at pair-time; only the hash is stored
  (constant-time compare on auth).
- **First-time flow**:
  1. Desktop (already paired or first-run "owner" device) shows a 6-char OTP
     code in Settings → "Pair a new device".
  2. Phone loads `/pair` (the only unauthenticated route besides static
     assets), types the OTP.
  3. Server validates the OTP (single-use, ≤5 min TTL), mints a device token,
     returns it once.
  4. Phone stores the token in `localStorage` (or IndexedDB for iOS
     long-retention), reloads `/`.
- **WS auth**: every WebSocket connection presents the token in the upgrade
  request (`Sec-WebSocket-Protocol` subprotocol or a `?token=` query param —
  D-question for discuss-phase). Server's `onConnection` (handlers.js) rejects
  the connection with code 4401 before adding to `sessions.clients` if the
  token is missing/unknown. Existing paired sockets are NOT affected.
- **Owner bootstrap**: chicken-and-egg — the first device has nothing to pair
  with. Options for discuss-phase:
  - (a) Server prints an OTP to stdout on first boot, owner types it in the
    browser; subsequent devices use the in-UI pair view.
  - (b) Server auto-pairs the first connecting client (open-with-empty-state
    optimism) and rejects every subsequent one until pair-mode is toggled on.
  - (c) An owner OTP is in `config.json` as `bootstrap_pair_code` (long, one-
    shot) and consumed once.
- **Revocation**: Settings → "Linked devices" lists `{label, paired_at,
  last_seen, in_use_now}` rows with a Revoke button. Revoke = delete from
  `devices.json` AND close any currently-open WS belonging to that token
  (handlers.js needs to track `token_hash → Set<ws>`).
- **Threat model bounded**: still VPN-only — no public exposure. Pairing
  defends against the "guest tablet on the same VPN" case and the "phone got
  swapped, no longer mine" case. Out of scope: rate-limiting, brute force on
  the OTP (mitigated by single-use + short TTL), TLS termination (lives in
  clideck-docker-lance).

### Open questions for discuss-phase

- Token in URL vs. subprotocol header — `Sec-WebSocket-Protocol` is the cleanly
  spec'd path but some proxies strip it; `?token=` is universal but ends up in
  access logs.
- Should an unpaired device on `/` get a 401 from the server (clean reject) or
  the dashboard with every action gated behind "pair first" (softer UX, leaks
  config shape)?
- Owner-bootstrap option (a/b/c above) — Lance's preference, plus a fallback
  reset path (forgot the OTP / lost all devices → SSH into the server and
  delete `.clideck/devices.json`).
- Where in the existing UI does "Linked devices" live — Settings has Display,
  Themes, Presets, Plugins; "Devices" fits naturally as a new section.
- Does the mobile-desktop-concurrent-access branch's `clients.count` broadcast
  need to include device labels? E.g. the other-client indicator could become
  "iPhone (Lance) is connected" instead of the generic "Another client".

### Probable phase shape (not pinned)

- 1 wave of failing tests (auth/pair/revoke/WS-reject contracts)
- 1 wave of server work: `devices.json` persistence, OTP mint/validate,
  WS-connection auth gate, revoke-closes-socket
- 1 wave of client work: `/pair` view, token storage, Settings "Linked devices"
  panel
- 1 wave of verification + manual smoke from a real phone over the VPN

This is **not** a "small fix" — probably 5-8 plans across 4 waves, similar
shape to Phase 12 mobile-desktop. Recommend running through `/gsd-spec-phase`
to pin ambiguity before `/gsd-discuss-phase`.

## Promotion (2026-06-05)

Promoted to **Phase 15 — 2026-06-05-device-pairing-for-mobile-access**.
SPEC at `.planning/2026-06-05-device-pairing-for-mobile-access/SPEC.md` with
the design space distilled into 9 acceptance criteria and 6 open decisions
flagged for `/gsd-discuss-phase`. Status: planned, not yet through discuss
or plan.

## Relation to shipped + planned work

- **Phase 12 (origin/main, `2026-06-04-clipboard-image-paste`, v1.31.15)** —
  different "Phase 12" scope; this todo's reference to "Phase 12" predates
  origin's renumbering. No code overlap.
- **Phase 14 (`2026-06-04-replayable-shell-sessions`, v1.31.17)** —
  rehydrates sessions across server restart; doesn't gate connections.
  Orthogonal but worth noting that a rehydrated session will only attach to
  a paired device under Phase 15, which is the desired interaction.
- **Local branch `feat/mobile-desktop-concurrent-access`** — the practical
  motivator. That branch shipped concurrent mobile + desktop access without
  app-level auth (its SPEC explicitly deferred it to "a separate phase").
  Phase 15 IS that separate phase.
