// Phase 16 — WebSocket upgrade auth gate.
//
// Two pure helpers, no module-scope state, no HTTP, no WebSocket. Testable
// in isolation via dependency injection — Wave 0 spec
// `tests/ws-auth-gate.test.js` constructs `makeVerifyClient({ devices,
// isAllowedWsOrigin })` directly against a freshly-required `devices.js`
// without booting `server.js`.
//
// Wiring lives in server.js (Plan 16-05 Task 3) — `new WebSocketServer({
// verifyClient: makeVerifyClient({ ... }), handleProtocols: ... })`.
//
// Why a separate module + factory (vs. inlining in server.js)?
//   1. Testability — Wave 0 spec is locked to `require('../auth-gate.js')`
//      and to a DI factory shape. The factory lets tests pin behaviour
//      against synthetic `devices` + `isAllowedWsOrigin` stubs.
//   2. Single-responsibility — server.js stays focused on connection
//      plumbing; auth-gate.js owns the parse + lookup + callback sequence.
//   3. Per CLAUDE.md §14 (demand elegance) — the home-rolled subprotocol
//      parser avoids reaching into `ws/lib/subprotocol` internals which
//      are not in the public API and could break on a `ws` minor bump
//      (RESEARCH §1 explicit).
//
// Per CLAUDE.md §13 — NEVER log the raw token or the token hash here.
// The token only exists in-memory for the duration of one upgrade request.

'use strict';

// readDeviceToken(req) — pure parser for the comma-separated
// `Sec-WebSocket-Protocol` header. The browser sends:
//     Sec-WebSocket-Protocol: clideck-device-token, <raw-token>
// (the order is browser-determined; the spec doesn't pin it). Defensive:
// returns null for null/undefined req, missing headers object, empty
// header, missing sentinel, or sentinel-only (no token entry).
//
// Whitespace-tolerant: trims each comma-separated entry, drops empties.
// Order-tolerant: the sentinel may come first or second.
function readDeviceToken(req) {
  if (!req || !req.headers) return null;
  const raw = req.headers['sec-websocket-protocol'];
  if (!raw) return null;
  const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.includes('clideck-device-token')) return null;
  // First entry that is NOT the sentinel — RESEARCH §1 R-6 (also Pitfall
  // P-6: defence-in-depth against ordering quirks).
  return parts.find(p => p !== 'clideck-device-token') || null;
}

// ─── Localhost trust (2026-06-09) ──────────────────────────────────────────
// The owner sitting at the machine should never be forced through the
// device-pairing gate. Phase 16 gated EVERY ws upgrade on a paired token,
// which regressed Lance's daily local browser use (the pair screen popped
// up demanding an OTP). When a request originates from the loopback
// interface we treat it as the trusted owner.
//
// Threat note: this is a TRUST decision keyed on the *peer address*, not on
// the Origin header — so the origin check still runs FIRST (a malicious
// cross-origin page that the user's browser loads would carry a non-matching
// Origin and be rejected before we ever look at loopback). What loopback
// trust grants is: a same-origin browser on the host can connect WITHOUT a
// paired token. Per Lance's explicit waiver, code visible on the host shell
// is acceptable; the security boundary for remote devices (VPN + pairing)
// is unchanged.
function isLoopbackAddress(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  if (addr === '::1' || addr === '::ffff:127.0.0.1') return true;
  // 127.0.0.0/8 — any 127.x.x.x is loopback. Also tolerate the IPv4-mapped
  // form '::ffff:127.x.x.x' that some stacks report.
  return /^127\./.test(addr) || /^::ffff:127\./.test(addr);
}

function isLoopbackReq(req) {
  const sock = req && (req.socket || req.connection);
  return isLoopbackAddress(sock && sock.remoteAddress);
}

// Synthetic device stashed on req for a loopback-trusted (tokenless)
// connection. server.js's `wss.on('connection')` reads req.clideckDevice to
// tag ws.deviceId / ws.deviceTokenHash. The id 'local' never collides with a
// real 'dev_…' id, so devices.touchLastSeen('local') is a harmless no-op and
// a device.revoke can never accidentally target the owner's local socket.
const LOOPBACK_DEVICE = Object.freeze({
  id: 'local',
  token_hash: 'loopback',
  label: 'localhost',
  loopback: true,
});

// makeVerifyClient({ devices, isAllowedWsOrigin }) — factory returning
// a 2-arg `verifyClient` closure of shape `({ req }, callback) => {...}`.
//
// The 2-arg form (vs. the 1-arg form ws also supports) lets us pass a
// custom HTTP status code on rejection — `callback(false, 401, 'unpaired')`
// aborts the upgrade with `HTTP/1.1 401 unpaired` BEFORE `completeUpgrade`
// runs (RESEARCH §1, §7). The browser surfaces this as `event.code === 1006`
// (not 4401) because the WS handshake never completed — the 4401 path is
// reserved for the post-handshake revoke flow in sessions.closeDevice().
//
// Sequence (PATTERN: short-circuit ladder, cheapest check first):
//   1. Origin — runs FIRST so a disallowed-origin attacker can't time
//      our token lookup. Preserves the existing isAllowedWsOrigin
//      semantics (no-Origin = allow, for non-browser clients).
//   2. Token extraction — readDeviceToken returns null on missing header
//      or missing sentinel.
//   3. Device lookup — devices.findByToken does a constant-time SHA-256
//      hash compare across all paired devices (n ≤ 5).
//   4. Stash + accept — req.clideckDevice is read by the (ws, req)
//      wrapper in server.js to tag ws.deviceId / ws.deviceTokenHash
//      (Pattern A from RESEARCH §4).
// Ladder (token-first, loopback-fallback):
//   1. Origin check               → 403 if disallowed (UNCHANGED, runs first)
//   2. Valid device token?        → accept as the REAL device. This runs
//      BEFORE the loopback fallback on purpose: a loopback browser that DID
//      pair (carries a token) must be attributed to its real device so a
//      device.revoke still targets it by id — loopback trust must not mask a
//      paired token's identity.
//   3. Tokenless + loopback + trustLoopback → accept as LOOPBACK_DEVICE.
//   4. else                       → 401 'unpaired'.
//
// `trustLoopback` defaults true (localhost-trust feature). Set false to
// enforce pairing even on loopback. `isLoopback` is injectable for tests;
// it defaults to the real peer-address predicate.
function makeVerifyClient({ devices, isAllowedWsOrigin, trustLoopback = true, isLoopback = isLoopbackReq }) {
  return function verifyClient({ req }, callback) {
    // 1. Origin check — runs first per AC4 + RESEARCH §10.1. Preserved
    //    verbatim from the pre-Phase-16 verifyClient at server.js:402.
    //    Loopback trust does NOT bypass this: a malicious cross-origin page
    //    the owner's browser loads is still rejected here before we consider
    //    the peer address.
    if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) {
      return callback(false, 403, 'origin not allowed');
    }
    // 2. Token path — if a valid token is present, attribute to the real
    //    device regardless of loopback (so revoke-by-id still works).
    const rawToken = readDeviceToken(req);
    if (rawToken) {
      const device = devices.findByToken(rawToken);
      if (device) {
        // Stash on req — the (ws, req) wrapper in server.js reads
        // req.clideckDevice to tag ws.deviceId + ws.deviceTokenHash
        // (Pattern A — used by sessions.closeDevice during revoke).
        req.clideckDevice = device;
        return callback(true);
      }
      // An UNKNOWN token from a non-loopback peer is a hard reject. From a
      // loopback peer we fall through to loopback trust below (a stale token
      // shouldn't lock the owner out of their own machine).
    }
    // 3. Loopback fallback — owner at the machine, no (valid) token.
    if (trustLoopback && isLoopback(req)) {
      req.clideckDevice = LOOPBACK_DEVICE;
      return callback(true);
    }
    // 4. Reject — unpaired remote, or loopback trust disabled.
    return callback(false, 401, 'unpaired');
  };
}

module.exports = {
  makeVerifyClient,
  readDeviceToken,
  isLoopbackAddress,
  isLoopbackReq,
  LOOPBACK_DEVICE,
};
