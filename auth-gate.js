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
function makeVerifyClient({ devices, isAllowedWsOrigin }) {
  return function verifyClient({ req }, callback) {
    // 1. Origin check — runs first per AC4 + RESEARCH §10.1. Preserved
    //    verbatim from the pre-Phase-16 verifyClient at server.js:402.
    if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) {
      return callback(false, 403, 'origin not allowed');
    }
    // 2. Token extraction — null on missing header or sentinel-only.
    const rawToken = readDeviceToken(req);
    if (!rawToken) {
      return callback(false, 401, 'unpaired');
    }
    // 3. Device lookup — null if no device's token_hash matches.
    const device = devices.findByToken(rawToken);
    if (!device) {
      return callback(false, 401, 'unpaired');
    }
    // 4. Stash on req — the (ws, req) wrapper in server.js reads
    //    req.clideckDevice to tag ws.deviceId + ws.deviceTokenHash
    //    (Pattern A — used by sessions.closeDevice during revoke).
    req.clideckDevice = device;
    return callback(true);
  };
}

module.exports = { makeVerifyClient, readDeviceToken };
