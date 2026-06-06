---
phase: 16-device-pairing-for-mobile-access
researched: 2026-06-05
gates: 7 research questions
git_head: a231b64414ae9587bb680a1c75ceaa5851371f85
git_branch: main
ws_version: 8.19.0
node_engines: ">=18"
---

# Phase 16 — Device pairing for first-time mobile access — Research

**Researched:** 2026-06-05
**Domain:** WebSocket authentication gate, OTP-issued opaque tokens, `~/.clideck/` JSON persistence, browser subprotocol negotiation, iOS Safari storage durability.
**Confidence:** HIGH (R-1, R-2, R-3, R-4, R-6, R-7 verified against the `ws@8.19.0` source in `node_modules/`, current `handlers.js`/`sessions.js`/`server.js` on HEAD `a231b64`, Node `crypto` docs, and RFC 6455). MEDIUM-LOW on R-5 (iOS Safari ITP behaviour for installed PWAs is empirically slippery and depends on iOS version; recommendation gives a primary + fallback rather than a one-true-answer).

---

## User Constraints (from 16-CONTEXT.md)

### Locked Decisions

All six decisions D-01 → D-06 in `16-CONTEXT.md` are LOCKED. Summary (do not re-litigate):

- **D-01** — WS token transport is `Sec-WebSocket-Protocol: clideck-device-token, <token>`. Server echoes back exactly `clideck-device-token`.
- **D-02** — Owner bootstrap is a server-boot OTP printed to stdout AND written to `.clideck/bootstrap.otp`, only when `devices.json` has zero devices. Deleted on first successful redeem.
- **D-03** — Two-layer reject: server returns WS close `4401` with reason `"unpaired"`; client checks `localStorage` at boot, redirects to `/pair` if absent, clears + redirects if WS closes with `4401` (or the connection-establishment failure that maps to `1006` — see R-7).
- **D-04** — Labels are free-form UTF-8 (max 32 chars, trimmed). Display layer adds `(2)`, `(3)` suffixes on collision. ID is the source of truth.
- **D-05** — Do NOT touch the (non-existent on main) Phase 15 `clients.count` broadcast. Labelled "other-client" indicator is deferred to a hypothetical Phase 17.
- **D-06** — Two confirm-modal variants for revoke (own-device gets a stronger warning), reusing the `confirm.js` `{hideConfirm, cancelLabel}` opts shape shipped in Phase 10.

### Claude's Discretion

- Exact HTTP route layout for `/pair`, `/pair/redeem`, `/pair/mint-otp` (verbs, body schemas, response envelopes) — bounded by SPEC §"Pairing handshake" but the wire format is mine.
- In-memory data structure for the OTP store (Map keyed by OTP string with `{expiresAt, used}` values is the obvious shape; the server can hold this in a module-scoped Map — no persistence needed because OTPs are short-lived).
- Whether to track `ws → tokenHash` on the `ws` object itself (Pattern A) or in a parallel Map (Pattern B). **Recommend Pattern A** — see R-4.
- Whether `devices.json` is loaded via a `loadDevices()` analog of `loadSessions()` or via a getter/setter module. **Recommend the loadSessions pattern verbatim** — see R-3.
- The pair-view HTML/JS contents — minimal vanilla DOM, no new deps, mirror existing `public/js/*.js` style.

### Deferred Ideas (OUT OF SCOPE — do not address in Phase 16)

- Labelled other-client indicator
- Token rotation
- Per-device permissions (all linked devices have equal access)
- Bulk revoke / "revoke all other devices" panic button
- Device fingerprint *verification* (we store the UA hint at pair-time as advisory info, but do NOT gate on fingerprint match at reconnect — SPEC threat model is explicit)
- `/pair` rate limiting (the OTP single-use + TTL window is the mitigation, per SPEC and CONTEXT)

---

## Phase Requirements

| AC | Description (from SPEC §"Acceptance Criteria") | Research Support |
|----|------------------------------------------------|------------------|
| AC1 | Fresh load → `/pair`, no WS, no session list | R-3 boot-state load + §3 server.js static handler + §6 client boot check |
| AC2 | Valid OTP → returns token, persists hash, reloads to dashboard with live WS | R-2 token mint + R-3 atomic write + R-1 subprotocol on the post-pair WS |
| AC3 | Known device reconnects silently | R-1 subprotocol header is the *only* friction-free transport; R-5 storage durability |
| AC4 | Unknown token → close `4401`, never in `sessions.clients` | R-1 + R-7 verifyClient 2-arg form, BEFORE `completeUpgrade` |
| AC5 | Revoke closes live sockets within 1s | R-4 Pattern A (ws.deviceTokenHash); ws.close(4401, 'revoked') |
| AC6 | Revoked device can re-pair | No state on the *browser* prevents re-pair; clearing localStorage + new OTP is enough |
| AC7 | Owner bootstrap works | R-2 OTP generation + write to `.clideck/bootstrap.otp` |
| AC8 | Token never leaks to logs | R-2 hash-on-arrival; existing `console.log` audit (§9 landmarks) |
| AC9 | OTP single-use + TTL honored, distinct error codes | R-2 in-memory Map with `{expiresAt, used}` |

---

## Project Constraints (from project context + CLAUDE.md global)

No `./CLAUDE.md` exists in `/home/clideck/projects/clideck/`. Constraints from `$HOME/.claude/CLAUDE.md` (user-global) and repo conventions:

- **No new dependencies.** All crypto from `node:crypto` (built-in). The `ws@8.19.0` library already supports everything we need natively via `handleProtocols` and `verifyClient`. No `argon2`, no `jsonwebtoken`, no `cookie-parser`.
- **CommonJS, vanilla JS.** `"type": "commonjs"` in `package.json`. Server-side: `require()`. Public-side: ES modules (the existing `/public/js/*.js` uses `import`/`export` and they're loaded as `<script type="module">`).
- **§13 secrets hygiene (global CLAUDE.md):** the raw token must never appear in `console.log`, `ws.send`, broadcasts, or `devices.json`. Only the SHA-256 hash persists, only `dev_…` IDs broadcast. The bootstrap OTP is printed to stdout exactly once (this is intentional and bounded — it is the recovery path; we treat it as a deliberate, scoped exception to the no-secrets-in-logs rule).
- **§1 verify-before-claiming-done:** all line-numbers below cross-checked against current `HEAD` (`a231b64`).
- **Test runner is `vitest`** (`/tests/*.test.js`), E2E is `@playwright/test` (`/e2e/*.spec.js`). See §10 for the test-style template.
- **VPN remains outer gate.** Do not bind new ports, do not widen origin acceptance, do not assume TLS (that's `clideck-docker-lance`'s job).

---

## §1 — R-1: `Sec-WebSocket-Protocol` token transport with `ws@8.19.0`

### How `ws` handles subprotocol negotiation

The `WebSocketServer` constructor takes an optional `handleProtocols(protocols, request)` hook. Verified directly from `node_modules/ws/lib/websocket-server.js:398-405`:

```js
// node_modules/ws/lib/websocket-server.js, lines 394-406 (verbatim from ws@8.19.0)
if (protocols.size) {
  // Optionally call external protocol selection handler.
  const protocol = this.options.handleProtocols
    ? this.options.handleProtocols(protocols, req)
    : protocols.values().next().value;

  if (protocol) {
    headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
    ws._protocol = protocol;
  }
}
```

**Findings — verified against source:**

1. **`protocols` is a `Set<string>`, not an array.** The set is populated by parsing the client's `Sec-WebSocket-Protocol` request header. The order in the Set is insertion order (the browser sent `clideck-device-token, <token>`), so `Array.from(protocols)[0]` is `'clideck-device-token'` and `Array.from(protocols)[1]` is the token. `[CITED: node_modules/ws/lib/websocket-server.js:276-287]`

2. **Returning a string echoes it back as the response `Sec-WebSocket-Protocol` header.** The browser verifies the echoed value is one it offered; if not, the browser fails the connection. So we MUST return exactly `'clideck-device-token'` (not the raw token) when auth passes.

3. **Returning a falsy value from `handleProtocols` does NOT abort the handshake.** It causes the response to omit the `Sec-WebSocket-Protocol` header. Per RFC 6455 §4.1 the browser then fails the connection client-side and the `close` event fires with `code === 1006` (abnormal closure — no close frame was received because none was sent). This is the wrong abstraction for "reject because unauthorized" — we want to surface `4401` so the client can distinguish unauthorized from network-broken. The correct hook for "reject before clients.add" is `verifyClient`, NOT `handleProtocols`. See R-7 for the full story.

4. **Token validation belongs in `verifyClient`.** `verifyClient` is called BEFORE `completeUpgrade` AND BEFORE `handleProtocols`. Its 2-arg callback form lets us pass a custom HTTP status code on rejection. This is the splice point. `[CITED: node_modules/ws/lib/websocket-server.js:320-348]`

```js
// node_modules/ws/lib/websocket-server.js, lines 320-348 (verbatim)
if (this.options.verifyClient) {
  const info = {
    origin: req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
    secure: !!(req.socket.authorized || req.socket.encrypted),
    req
  };

  if (this.options.verifyClient.length === 2) {
    this.options.verifyClient(info, (verified, code, message, headers) => {
      if (!verified) {
        return abortHandshake(socket, code || 401, message, headers);
      }
      this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
    });
    return;
  }
  if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
}
```

### Reading the token from the upgrade request

The token rides in the standard `Sec-WebSocket-Protocol` header. Inside `verifyClient`, `info.req.headers['sec-websocket-protocol']` is the raw comma-separated string `'clideck-device-token, <token>'`. To split safely, defer to the `ws`-internal parser:

```js
const { parse: parseSubprotocol } = require('ws/lib/subprotocol');
const protocols = parseSubprotocol(info.req.headers['sec-websocket-protocol'] || '');
// protocols is a Set<string>
const tokens = [...protocols].filter(p => p !== 'clideck-device-token');
const candidateToken = tokens[0]; // undefined if browser sent only 'clideck-device-token'
```

Or — and this is simpler and avoids reaching into ws internals — parse it ourselves with a single trim/split (the format is whitespace-tolerant comma-separated tokens):

```js
function readDeviceToken(req) {
  const raw = req.headers['sec-websocket-protocol'] || '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.includes('clideck-device-token')) return null;
  return parts.find(p => p !== 'clideck-device-token') || null;
}
```

The home-rolled version is the recommendation — no dependency on ws internals (which are not in the public API and could break on a `ws` minor bump).

### Browser-side construction

`new WebSocket(url, ['clideck-device-token', token])` sends `Sec-WebSocket-Protocol: clideck-device-token, <token>` on the upgrade request. Verified against `[CITED: developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket]` — array elements are joined into the comma-separated header value. Both elements must be RFC 6455 token-chars.

### Is a 43-char base64url token a valid subprotocol token?

Yes. Verified against `node_modules/ws/lib/validation.js:19-29` (the `tokenChars` table). RFC 7230 token chars are `!#$%&'*+-.0-9A-Z^_\`a-z|~`. Base64url uses `A-Z a-z 0-9 - _` — all four of these are `tokenChars[code] === 1`. A 256-bit random token base64url-encoded is exactly 43 chars (no padding) which is well below any sane proxy header-size limit.

Note: `ws.parseSubprotocol` throws `SyntaxError` if the token contains an illegal character — this means a malformed `Sec-WebSocket-Protocol` header bypasses our `verifyClient` (the handshake aborts with HTTP 400 at line 284 BEFORE `verifyClient` runs). This is a defence-in-depth bonus, not a bug. `[CITED: node_modules/ws/lib/websocket-server.js:282-286]`

### Subprotocol token length cap

Neither RFC 6455 nor RFC 7230 imposes a hard token-length cap. In practice:
- nginx default `large_client_header_buffers` is `4 8k` — comfortably more than enough for `clideck-device-token, ` + 43 chars + other headers.
- Caddy and Traefik: same league, no relevant cap.
- Express / Node's `http_parser`: `maxHeadersCount` defaults to 2000 *headers*, no per-header byte cap until ~80KB.

For a 43-char base64url token: no realistic risk of truncation. `[ASSUMED — confidence: HIGH because all common reverse proxies in clideck-docker-lance's stack handle 8KB+ headers comfortably]`.

---

## §2 — R-2: Secure random OTP + token generation in Node

Node's `node:crypto` (built-in, no install) gives everything needed. Verified signatures from `[CITED: nodejs.org/api/crypto.html]`:

| Function | Signature | Notes |
|----------|-----------|-------|
| `crypto.randomInt([min, ]max[, callback])` | Returns int in `[min, max)`. Synchronous if no callback. | Use for OTP-char picking — uniform, rejection-sampling-safe internally. |
| `crypto.randomBytes(size[, callback])` | Returns `Buffer`. Synchronous if no callback. | Use for the 32-byte token + 16-byte device ID. |
| `crypto.timingSafeEqual(a, b)` | Returns `boolean`. **Throws** if `a.length !== b.length`. | Constant-time compare. Lengths must match BEFORE the call (pre-check or pad). |
| `crypto.createHash('sha256').update(x).digest('hex')` | Returns `string`. | One-shot hash. Already used in `plugin-loader.js:2,34` so it's established idiom. |

### OTP generation (6 chars, unambiguous alphabet)

```js
// Source: own implementation, primitives from Node crypto docs
const crypto = require('crypto');

// 28-character unambiguous alphabet — explicitly excludes 0/O/1/I/l per SPEC.
// Keyspace: 28^6 = 481,890,304 ≈ 480M combinations.
const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// (lowercase intentionally omitted — OTP is shown UPPER on screen, accepted any-case at /pair/redeem;
//  alphabet above is the visible/canonical form.)
// Sanity check the line above is exactly 31 chars: A-Z minus I,L,O (23) + 2-9 (8) = 31, NOT 28.
// 31^6 = 887,503,681 ≈ 887M. Recompute keyspace at PLAN time after final alphabet decision.

function generateOtp(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += OTP_ALPHABET[crypto.randomInt(0, OTP_ALPHABET.length)];
  }
  return out;
}
```

**Pitfall flagged:** the original SPEC line "no 0/O/1/I/l" gives a 28-char alphabet only if we also drop one of the lookalikes (e.g. `S/5`, `B/8`, `Z/2`). Without that, A-Z minus {I, L, O} = 23 chars + 2-9 = 8 chars = 31 chars. Use 31; keyspace 31^6 ≈ 887M is fine. The OPEN QUESTION below (§8.Q-1) flags this for the planner / discuss-phase to lock the exact alphabet.

### Token generation (256-bit opaque, base64url)

```js
// 32 bytes = 256 bits. base64url('safe' alphabet, no padding) → 43 chars.
function mintToken() {
  return crypto.randomBytes(32).toString('base64url');
}
```

Node 18+ supports `'base64url'` encoding natively on `Buffer.toString` — verified `[CITED: nodejs.org/api/buffer.html#buffers-and-character-encodings]`. Output uses only `A-Z a-z 0-9 - _` (no `+ / =` padding), which is exactly the set we showed in R-1 is a valid `Sec-WebSocket-Protocol` token.

### Device ID generation (22 chars, opaque)

```js
// 16 bytes → 22-char base64url → 'dev_' + 22 chars = 26-char ID.
function mintDeviceId() {
  return 'dev_' + crypto.randomBytes(16).toString('base64url');
}
```

128 bits of entropy — collision-resistant well past clideck's "max 5 devices ever" scale.

### Token hashing for `devices.json`

```js
// Hash the token BEFORE writing to devices.json. The raw token never persists.
// 'sha256:' prefix matches the SPEC schema and the existing plugin-loader.js
// usage pattern (hash-as-string for table lookup).
function hashToken(rawToken) {
  return 'sha256:' + require('crypto')
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');
}
```

### Constant-time compare on lookup

`crypto.timingSafeEqual` requires equal-length buffers and throws otherwise. SHA-256 hex strings are always 64 chars (the `'sha256:'` prefix adds 7 more for a total of 71 chars), so equality of length is guaranteed when we compare two valid hashes. Still, defensively:

```js
function safeEqualHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

For the WS auth-gate hot path the comparison strategy is:

```js
function findDeviceByToken(rawToken) {
  if (!rawToken) return null;
  const candidateHash = hashToken(rawToken);
  // O(n) over devices.length — n ≤ 5 in clideck's threat model. Constant-time
  // compare per device. Returns the device record (with id, label, fingerprint).
  for (const device of devicesStore.list()) {
    if (safeEqualHash(device.token_hash, candidateHash)) return device;
  }
  return null;
}
```

Note: hashing the candidate first and comparing the hashes is itself constant-time relative to the corpus of devices (we do an O(n) loop regardless of whether the first device matches). This is the right shape for ≤5 devices.

### Why hash, not encrypt or sign?

- We don't need to *issue* anything verifiable client-side. We *issue and remember* — clipping the token verbatim into a server-side table and looking it up is enough.
- Hashing means a server-disk compromise (someone steals `devices.json`) doesn't yield directly-usable tokens. The attacker would need to brute-force a 256-bit pre-image — economically infeasible.
- SHA-256 is fast enough that we don't worry about online brute force per the threat model (VPN + single-use OTP + small device count).

### Assumption Log entries (see §A)

- A1 — alphabet for OTP (31 chars vs spec-suggested 28).
- A2 — `crypto.randomInt` uniform distribution properties (HIGH confidence — it's documented to be uniform, but flagging as `[CITED]` rather than `[VERIFIED]` because we did not exhaustively reverse-engineer V8's implementation).

---

## §3 — R-3: `devices.json` schema + atomic-write pattern

### What the codebase actually does today

**Verified by grep at `a231b64`:** there is NO atomic-rename write pattern in either `sessions.js` or `config.js`. Both write directly with `writeFileSync`. The CONTEXT.md note ("`sessions.json` persistence already follows an atomic-rename pattern") is **incorrect**.

- `sessions.js:762` — `writeFileSync(SAVED_PATH, JSON.stringify(data, null, 2));` — plain write, no temp+rename. `[VERIFIED: sessions.js:762]`
- `config.js:218` — `writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));` — plain write. `[VERIFIED: config.js:218]`

### Recommendation

Two viable paths, planner can pick at PLAN time:

**Option 3A (recommended, minimum-diff)** — mirror the existing pattern exactly. Use a plain `writeFileSync(DEVICES_PATH, JSON.stringify(data, null, 2))`. This is consistent with the rest of the codebase and avoids introducing a new idiom into a single file. The threat of partial-write corruption is low because we write infrequently (on pair, on `last_seen` update bursts, on revoke).

**Option 3B (more defensive, slight diff increase)** — introduce `atomicWriteJson(path, obj)` in `utils.js` and use it for `devices.json`. The new helper is ~6 lines. This is "the right thing" but breaks pattern-consistency with the rest of the project; if we add it we should leave a follow-up TODO to migrate `sessions.json` and `config.json` to the same helper in a separate phase. Lance to decide at PLAN time.

Recommended skeleton for Option 3B:

```js
// utils.js — append at bottom, beside validateCwdPath
function atomicWriteJson(path, data) {
  const tmp = path + '.tmp-' + crypto.randomBytes(4).toString('hex');
  require('fs').writeFileSync(tmp, JSON.stringify(data, null, 2));
  require('fs').renameSync(tmp, path);  // atomic on POSIX, best-effort on Windows
}
```

### Schema (locked by CONTEXT, restated for completeness)

```json
{
  "version": 1,
  "devices": [
    {
      "id":          "dev_<22 base64url chars>",
      "label":       "Lance iPhone",
      "fingerprint": "ua-hash-<sha256 first 12 chars of UA string at pair-time>",
      "paired_at":   "2026-06-05T12:34:56.789Z",
      "last_seen":   "2026-06-05T12:34:56.789Z",
      "token_hash":  "sha256:<64 hex chars>"
    }
  ]
}
```

Notes:
- `version: 1` enables future migrations the same way `loadSessions` handles the missing-`replayable` flag (sessions.js:777).
- `fingerprint` is advisory — it's stored at pair time and could later be used to detect token-stuffing across user-agents, but Phase 16 does NOT gate on fingerprint match (CONTEXT §"Deferred Ideas" — device fingerprint *verification* is out of scope).

### Module shape

Mirror `loadSessions()` / `saveSessions()` (sessions.js:770-784, 762):

```js
// NEW FILE: devices.js
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');

const DEVICES_PATH = join(DATA_DIR, 'devices.json');
const BOOTSTRAP_PATH = join(DATA_DIR, 'bootstrap.otp');

let store = { version: 1, devices: [] };

function load() {
  if (!existsSync(DEVICES_PATH)) {
    store = { version: 1, devices: [] };
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(DEVICES_PATH, 'utf8'));
    store = { version: parsed.version || 1, devices: Array.isArray(parsed.devices) ? parsed.devices : [] };
    console.log(`[devices] Loaded ${store.devices.length} paired device(s)`);
  } catch (e) {
    console.warn(`[devices] Failed to parse ${DEVICES_PATH}: ${e.message}. Starting empty.`);
    store = { version: 1, devices: [] };
  }
}

function save() {
  writeFileSync(DEVICES_PATH, JSON.stringify(store, null, 2));
}

function list() { return store.devices; }
function findByTokenHash(hash) { /* timingSafeEqual loop as in R-2 */ }
function add(deviceRecord) { store.devices.push(deviceRecord); save(); }
function remove(deviceId) {
  const before = store.devices.length;
  store.devices = store.devices.filter(d => d.id !== deviceId);
  if (store.devices.length !== before) save();
  return before - store.devices.length;
}
function touchLastSeen(deviceId) { /* mutate + save */ }

module.exports = { load, save, list, findByTokenHash, add, remove, touchLastSeen, DEVICES_PATH, BOOTSTRAP_PATH };
```

Called from `server.js` after `sessions.loadSessions()` and before `wss` is wired:

```js
// server.js, after line 60 (sessions.loadSessions())
const devices = require('./devices');
devices.load();
```

---

## §4 — R-4: Closing currently-open WebSockets on revoke

To satisfy AC5 ("every open WS for that token closes within 1s"), the server needs to find every `ws` belonging to a given `token_hash` and call `ws.close(4401, 'revoked')` on each.

### Pattern A (RECOMMENDED) — attach hash to `ws`

When the WS connects (after auth passes), tag the `ws` instance:

```js
// In server.js handleProtocols-and-tagging splice (see §10 code example),
// OR in handlers.js onConnection() prologue:
ws.deviceId = matchedDevice.id;
ws.deviceTokenHash = matchedDevice.token_hash;
```

Revoke iterates `sessions.clients` (the existing Set):

```js
// In devices.js or wherever the revoke handler lives:
function revokeDevice(deviceId) {
  const removed = devices.remove(deviceId);
  if (!removed) return { ok: false, error: 'device not found' };
  // Close every live WS belonging to this device.
  let closedCount = 0;
  for (const ws of sessions.clients) {
    if (ws.deviceId === deviceId) {
      try { ws.close(4401, 'revoked'); } catch {}
      closedCount++;
    }
  }
  // Tell the surviving (other-device) clients the device list changed,
  // so their Settings panel re-renders without that row.
  sessions.broadcast({ type: 'device.revoked', deviceId });
  return { ok: true, closedCount };
}
```

**Cleanup is automatic.** The existing `ws.on('close', () => sessions.clients.delete(ws))` at handlers.js:755 removes the closed sockets from the broadcast Set; we don't need to clean up the `deviceId` property because the `ws` object is GC'd with the close. **Verified:** `[VERIFIED: handlers.js:755]`.

### Pattern B (alternative) — parallel Map

Maintain `sessions.clientsByToken = new Map<token_hash, Set<ws>>()`. Revoke does `clientsByToken.get(hash)?.forEach(ws => ws.close(...))`. Add on auth-pass, remove on `ws.on('close')`. O(1) lookup, but doubles the bookkeeping.

### Why Pattern A wins for clideck

- clideck's threat model says n ≤ 5 devices, so the O(n) iteration in Pattern A is ~5 operations — well under 1ms.
- Pattern A adds zero new module-scope state. Pattern B requires plumbing the Map through `sessions.js`'s exports, the new add path on auth, the close-handler cleanup, and tests for the map staying consistent with the broadcast Set. Three new failure modes for an optimisation we don't need.
- Pattern A composes with `sessions.broadcast` exactly the way the existing code already iterates `clients`.

### Close-code choice: `4401`

- RFC 6455 §7.4.2 reserves `4000-4999` for application use. `[CITED: rfc-editor.org/rfc/rfc6455#section-7.4.2]`
- Verified `ws@8.19.0` `isValidStatusCode` allows `3000-4999`. `[VERIFIED: node_modules/ws/lib/validation.js:37-44]`
- Search of the codebase for existing close-code usage: `grep -rn '\.close(40\|\.close(41\|\.close(44\|\.close(10\|\.close(43\|\.close(1000' --include='*.js' .` returns no matches outside `node_modules`. **`4401` is unused elsewhere in clideck — safe to claim.** `[VERIFIED: repo grep at HEAD a231b64]`

The mnemonic `4401 = "4000 (app) + 401 (HTTP unauthorized)"` is also what other projects (e.g. wscat docs, several Stack Overflow patterns) use; this makes server-log inspection easier even though it has no spec-level meaning.

### Reason string

`ws.close(4401, reason)` accepts a UTF-8 string up to 123 bytes (RFC 6455 §7.1.6 minus the 2 status-code bytes). Use short reasons:
- `'unpaired'` — token was missing or unknown at upgrade time
- `'revoked'` — token was valid at connect but the device was revoked while connected
- `'expired'` — reserved for future use (Phase 16 has no token rotation)

The client distinguishes these via the `close` event's `reason` property if needed; for Phase 16 the client only cares that `event.code === 4401` (or 1006 — see R-7).

---

## §5 — R-5: Client-side token storage on iOS Safari

### The problem

iOS Safari's Intelligent Tracking Prevention (ITP) clears site-scoped storage (including `localStorage`) for sites the user hasn't directly interacted with for 7 days. A clideck PWA on Lance's phone, used twice a week, is right at the threshold. If `localStorage.getItem('clideck.deviceToken')` returns `null` after a 7-day gap, the phone is silently un-paired and Lance has to re-OTP.

### What ITP actually does in 2026

`[CITED: webkit.org/blog/9521/intelligent-tracking-prevention-2-3/]` (this is the foundational 2019 post; subsequent updates extended the policy):

- ITP's 7-day storage cap applies to **script-writable cookies and `localStorage`** for top-level sites where the user has no observed interaction in the past 7 days.
- "Observed interaction" includes tap, click, scroll, type on the page itself — not just visits.
- IndexedDB has historically been treated similarly under ITP after the 2020-onwards updates, but the eviction is less aggressive (typically tied to overall storage pressure, not just the 7-day window).
- **Crucial nuance: ITP behaviour changes for installed PWAs.** Safari treats a site added to the home screen as a first-party app context, NOT a tracked third-party. The 7-day cap is relaxed (in some iOS versions, removed entirely) once the manifest declares `display: standalone` and the user has added to home screen. `[ASSUMED — confidence: MEDIUM, based on multiple WebKit blog posts and Mozilla observations through 2024; exact behaviour on iOS 17+ is hard to pin without device testing]`

### Recommended primary + fallback

**Primary storage: `localStorage`.** Synchronous API, simplest to thread into the existing `app.js` boot path. For Phase 16 v1, `localStorage` is the storage layer.

**Mitigations against ITP eviction:**

1. **Document the PWA install path in CONTEXT/SPEC.** When Lance adds clideck to his iPhone home screen (Share → Add to Home Screen), ITP's 7-day eviction is significantly relaxed because Safari now treats the site as a top-level app context with regular user engagement.

2. **No mitigation at the storage layer for Phase 16.** The fallback for "phone got silently un-paired" is "re-OTP from desktop" — the same as the lost-phone path. This is acceptable per the threat model (lost-or-stolen-phone re-pair is already a documented user flow).

3. **Future-phase work (NOT Phase 16):** if Lance starts seeing real-world silent-unpair drift, the upgrade path is IndexedDB. IndexedDB is async (so the boot-time check becomes a Promise rather than a sync `if (localStorage.getItem(...))`), which is invasive but tractable. The fallback below is for *if/when* Lance asks for it — not for Phase 16.

```js
// Phase 16 PRIMARY (recommend ship this)
const STORAGE_KEY = 'clideck.deviceToken';
const ID_KEY = 'clideck.deviceId';
function readToken() { return localStorage.getItem(STORAGE_KEY); }
function writeToken(token, deviceId) {
  localStorage.setItem(STORAGE_KEY, token);
  localStorage.setItem(ID_KEY, deviceId);
}
function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ID_KEY);
}
```

### Cookie alternative — why we're NOT using it

- `httpOnly` cookies can't be read by JS, so they can't be passed via `new WebSocket(url, [protocol, token])`. The browser only sends `Cookie:` on the WS upgrade request — we'd have to read it server-side and ignore the subprotocol path. That's a viable design but breaks D-01.
- Non-`httpOnly` cookies are XSS-readable, no better than `localStorage` for the threat model, and add the cookie-on-every-request overhead.
- iOS Safari ITP also evicts non-`httpOnly` cookies on the same 7-day timer.

### Assumption Log entries

- A3 — ITP behaviour for installed PWAs on iOS 17/18 is `[ASSUMED]` based on documentation and community reports; Lance should manually verify by leaving the PWA un-interacted for 8 days and checking if the token survives. If it doesn't, plan a follow-up Phase 17.

---

## §6 — R-6: `4401` close-code propagation to client + reload-to-pair

### Verified browser behaviour

Per RFC 6455 §7.4.2 and confirmed via MDN's `CloseEvent` interface `[CITED: developer.mozilla.org/en-US/docs/Web/API/CloseEvent]`:

- An application-defined close code in the 4000-4999 range arrives on the client as `event.code === 4401` when the server sent a normal close frame.
- `event.reason` is the UTF-8 string the server passed to `ws.close(code, reason)`.
- The browser does NOT modify or remap codes in the 4000-4999 range — they're passed through verbatim.

### Client-side handler

```js
// public/js/app.js — extend the existing state.ws.onclose at line 484
state.ws.onclose = (event) => {
  connectedAt = null;
  renderStatusBadge();
  clearHeartbeat();

  if (event.code === 4401) {
    // Server rejected our token or revoked it. Wipe local credentials and
    // redirect to /pair — the user re-pairs from there. This intentionally
    // does NOT preserve the in-flight UI state; the SPEC's threat model
    // treats post-revoke session UI as 'must be torn down immediately'.
    try {
      localStorage.removeItem('clideck.deviceToken');
      localStorage.removeItem('clideck.deviceId');
    } catch { /* localStorage blocked — proceed anyway */ }
    window.location.href = '/pair';
    return; // do NOT schedule reconnect
  }

  // Existing reconnect logic for all other close reasons (network drop,
  // server restart, NAT timeout, etc.) — unchanged from current main.
  if (!lastDropToastId) {
    lastDropToastId = `ws-reconnect-${Date.now()}`;
    showToast('Connection lost — reconnecting…', { id: lastDropToastId, type: 'warn', duration: 0 });
  }
  setTimeout(connect, 1000);
};
```

### Close-code-survives-redirect

The browser fires the `close` event synchronously when it receives the close frame. By the time `window.location.href = '/pair'` runs, we've already read `event.code`. The redirect tears down the current page (including the in-memory `state` object and the closed `ws`), but the `localStorage.removeItem` calls have already executed and the navigation request is the next thing on the browser's task queue. **Verified by reasoning, not empirically tested.** `[ASSUMED — but this is the standard event-loop ordering; very high confidence]`

---

## §7 — R-7: Inline `Sec-WebSocket-Protocol` in Node's HTTP upgrade flow

### The question the prompt raised

> Can we reject the WS upgrade with a custom close code at the HTTP level (so the client sees `event.code === 4401`)? Or does the connection-establishment failure surface as just `event.code === 1006` (abnormal closure)?

### The answer

**The HTTP upgrade `abortHandshake` path returns an HTTP status code (e.g. 401), NOT a WebSocket close frame.** This is fundamental to how RFC 6455 §4 defines the protocol — until the handshake completes (HTTP 101), the connection is still HTTP, and there's no WebSocket close-frame envelope to put a 4401 into.

Verified by code: `abortHandshake(socket, code, ...)` at `node_modules/ws/lib/websocket-server.js:497` calls `socket.write('HTTP/1.1 <code> <reason>\r\n\r\n')` and `socket.destroy()`. There is no close-frame written.

The browser-side consequence: the `WebSocket` constructor's `onclose` fires with `event.code === 1006` ("abnormal closure" — RFC 6455 §7.1.5: "designated for use … to indicate that the connection was closed abnormally, e.g., without sending or receiving a Close control frame"). `event.reason` is the empty string. The 401 HTTP status code IS visible on `WebSocket.onerror`'s `event` only in Firefox developer tools — JavaScript code cannot read it.

### Two design options, evaluated

**Option 7A — reject in `verifyClient`, accept the 1006 mapping.**

Pros: Simplest. The handshake never completes, so by definition no `clients.add(ws)` ever runs. AC4 ("never appears in sessions.clients") is satisfied by construction.

Cons: The client cannot distinguish "auth failed" from "network broke" on the first connect. We MUST treat 1006 + no-token-in-localStorage AND 1006 + token-in-localStorage as both "go to /pair" — but that's symmetric with the no-token case anyway. Empty localStorage + 1006 → /pair. Has-token + 1006 → assume token rejected, clear localStorage, → /pair.

The only false-positive scenario: Lance's iPhone has a valid token but the VPN momentarily drops during the WS upgrade handshake. The client sees 1006, clears localStorage, redirects to /pair, Lance re-OTPs unnecessarily. **Probability assessment:** rare in practice — the upgrade window is sub-second; the VPN drop would have to land in that window. If it happens once a month it's a minor annoyance, not a usability disaster. Re-pair is 30 seconds of friction.

**Option 7B — accept the handshake, then immediately send `ws.close(4401, 'unpaired')`.**

Pros: Client sees the precise 4401 code. No false-positive risk.

Cons: This breaks AC4: the WS connection IS technically established, and the `ws` object exists. Even if we never call `sessions.clients.add(ws)`, we have to be extremely careful that no other code path observes the connection. This is fragile — a future contributor adds a `clients.add` in the new auth-pass path and now unpaired connections leak in.

### Recommendation: Option 7A, with a hybrid mitigation

Use Option 7A as the primary mechanism (reject in `verifyClient` → HTTP 401 → client sees 1006). Soften the false-positive case by **distinguishing the boot-time WS handshake from the in-flight revoke case**:

- **Boot-time auth failure** (`event.code === 1006` AND we have a `localStorage.deviceToken`): clear and redirect to /pair. Lance might re-OTP unnecessarily on a transient network blip; we accept this rare false-positive.
- **In-flight revoke** (`event.code === 4401` because the connection was already up when revoke ran and Pattern A from R-4 called `ws.close(4401, 'revoked')`): clear and redirect to /pair. This path is unambiguous.

Both branches converge on the same UX (`localStorage.removeItem` + `/pair` redirect), so the implementation is essentially:

```js
state.ws.onclose = (event) => {
  // ... existing teardown ...
  const hasToken = !!localStorage.getItem('clideck.deviceToken');
  const looksLikeAuthFail = event.code === 4401
    || (event.code === 1006 && hasToken /* and the WS never reached 'open' */);
  if (looksLikeAuthFail) {
    localStorage.removeItem('clideck.deviceToken');
    localStorage.removeItem('clideck.deviceId');
    window.location.href = '/pair';
    return;
  }
  // ... existing reconnect path ...
};
```

The "WS never reached `open`" sub-condition is checkable via a module-scoped flag set in `state.ws.onopen` — if `onclose` fires without `onopen` having fired, the handshake itself failed:

```js
let connectedAtLeastOnce = false;
state.ws.onopen = () => { connectedAtLeastOnce = true; /* ... existing ... */ };
state.ws.onclose = (event) => {
  if (event.code === 4401 || (!connectedAtLeastOnce && event.code === 1006 && hasToken)) {
    // ... clear + /pair ...
  }
  connectedAtLeastOnce = false;  // reset for next attempt
  // ... existing reconnect ...
};
```

This is the recommended implementation. It distinguishes the two close paths cleanly.

### Why not return a custom 4xx via verifyClient's 2-arg form to signal "auth failed"?

We could pass `4401` as the HTTP status code (`callback(false, 4401, 'unpaired')`), but:
- HTTP status code 4401 is invalid (max 599). `ws@8.19.0`'s `abortHandshake` will write it anyway (`socket.write('HTTP/1.1 4401 unpaired\r\n...')`), which the browser will treat as malformed or as a 4xx of some kind, but the JS API still surfaces `event.code === 1006`. The HTTP status from the upgrade response is NOT propagated to the WebSocket `close` event.
- Stick with HTTP 401 on rejection (or 403; 401 implies a `WWW-Authenticate` header which we don't send, so 403 is arguably more correct — but the WebSocket API ignores it either way).

### Splice point in code

Where the new `verifyClient` lives — `server.js:366-371`:

```js
// CURRENT (server.js:366-371) — verbatim from HEAD a231b64:
const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }) => {
    return isAllowedWsOrigin(req.headers.origin, req.headers.host);
  },
});
```

This is the splice point. The new shape (Phase 16):

```js
// PROPOSED — Phase 16, server.js:366-380
const devices = require('./devices');
const wss = new WebSocketServer({
  server,
  // 2-arg callback form — lets us send a custom HTTP status on rejection
  verifyClient: ({ req }, callback) => {
    // 1) Existing origin check — preserved verbatim (do NOT regress).
    if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) {
      return callback(false, 403, 'origin not allowed');
    }
    // 2) Device-token check (new — Phase 16).
    const rawToken = readDeviceToken(req);  // see R-1
    if (!rawToken) {
      return callback(false, 401, 'unpaired');
    }
    const device = devices.findByToken(rawToken);  // hashes + timingSafeEqual loop
    if (!device) {
      return callback(false, 401, 'unpaired');
    }
    // Stash on req so onConnection (R-4 Pattern A) can tag the ws instance.
    req.clideckDevice = device;
    return callback(true);
  },
  handleProtocols: (protocols) => {
    // Required because we sent 'clideck-device-token' as one of the offered
    // subprotocols — the browser refuses the handshake if the server doesn't
    // echo back a subprotocol it offered.
    return protocols.has('clideck-device-token') ? 'clideck-device-token' : false;
  },
});

wss.on('connection', (ws, req) => {
  // Tag the ws BEFORE handing to onConnection so revoke can find it.
  // req.clideckDevice was set in verifyClient above.
  ws.deviceId = req.clideckDevice.id;
  ws.deviceTokenHash = req.clideckDevice.token_hash;
  devices.touchLastSeen(req.clideckDevice.id);
  return onConnection(ws);
});
```

**Verified note:** `wss.on('connection', onConnection)` at server.js:372 currently receives only `ws`. The `req` is the second argument — verified at `node_modules/ws/lib/websocket-server.js:439` (`server.emit('connection', ws, req)`). Existing `onConnection(ws)` ignores `req`; the new wrapper above passes through.

---

## §8 — Pitfalls & Open Questions

### Pitfall P-1 — OTP brute-force exposure

The OTP is 6 chars from a ~31-char alphabet (887M combinations). Single-use + 5-min TTL bounds brute-force to: 5 × 60 × max-requests-per-second-the-VPN-allows. Assuming 10 req/sec sustained (VPN-bound, no rate limiting per CONTEXT/SPEC), that's 3000 attempts per 5-min window — probability of guessing a specific OTP is 3000 / 887M = 3.4×10^-6. Acceptable per SPEC threat model. **No mitigation needed.**

### Pitfall P-2 — Server boot OTP shown in clipboard / scrollback

The boot banner prints the OTP to stdout. If Lance runs clideck in a tmux/screen session, the OTP is captured in scrollback indefinitely. **Mitigation:** delete `.clideck/bootstrap.otp` on first successful redeem (already in D-02), AND clear the in-memory OTP variable. The stdout scrollback is by design — Lance is the only one with shell access; this is acceptable. Don't try to "redact" stdout.

### Pitfall P-3 — Race between revoke and reconnect

If Lance revokes a device from desktop while the phone is reconnecting after a network blip, there's a race: revoke might fire before the phone's reconnect attempt completes. Result: the phone sees 1006 (rejection) rather than 4401 (revoke). Per R-7, both paths converge on clear+/pair, so this is **not a bug — just an observable inconsistency in close codes**. No mitigation needed.

### Pitfall P-4 — `paired_at` and `last_seen` clock skew

If the server clock jumps (NTP correction, manual `date` set), the `last_seen` timestamps drift. This is harmless (the UI shows "now"/"5m ago"/"1h ago" relative to the current server clock). No mitigation.

### Pitfall P-5 — Multiple browsers on the same device

If Lance opens two tabs in the same browser on his iPhone, they share `localStorage` and both attempt WS connect with the same token. Pattern A's `ws.deviceId === deviceId` will close BOTH on revoke, which is the desired behaviour. No issue.

### Pitfall P-6 — `Sec-WebSocket-Protocol` ordering in the array

The browser sends array elements in array order. The server receives them as a Set (which preserves insertion order). Per R-1, we expect `['clideck-device-token', token]`. If the browser swaps the order, our `readDeviceToken` helper handles both (it does `parts.find(p => p !== 'clideck-device-token')`). Defence-in-depth is free; no mitigation needed.

### Open Question Q-1 — Exact OTP alphabet

SPEC §"Owner bootstrap" says "no `0/O/1/I/l`" — that's 5 chars excluded. Lowercase `l` only matters if we include lowercase letters at all. The proposed `A-Z 2-9 minus {I, L, O}` = 31 chars. **Planner / Lance to confirm at PLAN time.** Recommendation: 31-char uppercase-only alphabet. Keyspace 887M is fine.

### Open Question Q-2 — Atomic-write or plain-write for `devices.json`

R-3 Option 3A (plain write, matches existing pattern) vs Option 3B (atomic temp+rename). **Planner to decide.** Recommendation: Option 3A for consistency, file a follow-up todo if Lance wants the more defensive write everywhere.

### Open Question Q-3 — Edit-label inline UX

SPEC says "Edit-label inline" in the Linked devices panel. Specifics deferred: is it click-to-edit on the row, or a pencil-icon button, or a separate modal? **Planner / Lance to lock at PLAN time.** Recommendation: click-to-edit on the label text, mirroring how `session-rename` already works in the sidebar (`sessions.js:387 — function rename`).

### Open Question Q-4 — Does the `/pair` page get served when `devices.json` is empty (bootstrap mode)?

D-02 says the bootstrap OTP is generated when `devices.json` has zero devices. The `/pair` page presumably accepts that OTP same as a user-minted OTP. Question: should the `/pair` page UI show a banner ("This is the first device — use the bootstrap code from your server logs") when `devices.json` is empty? **Planner to decide; not a blocker for research.**

### Open Question Q-5 — Behaviour when the OS WebSocket library masks `event.code` over a buggy proxy

Some intermediate proxies strip WebSocket close frames, causing the browser to see 1006 even when the server sent 4401. We can't detect this server-side. Per R-7, both paths converge on clear+/pair, so this is **not a usability issue — only a logs-clarity issue**.

---

## §9 — Recommended file landmarks (validated at HEAD `a231b64`)

| File | Line | Current content | Phase 16 splice |
|------|------|-----------------|------------------|
| `server.js` | 4 | `const { WebSocketServer } = require('ws');` | (unchanged) |
| `server.js` | 52 | `const { onConnection } = require('./handlers');` | Add: `const devices = require('./devices');` immediately below. |
| `server.js` | 60 | `sessions.loadSessions();` | Add: `devices.load();` immediately below (before `transcript.init`). |
| `server.js` | 98 | `const server = http.createServer((req, res) => {` | Add new HTTP route branches for `GET /pair`, `POST /pair/redeem`, `POST /pair/mint-otp` — place ABOVE the existing `if (req.method === 'POST' && (req.url === '/v1/logs' …)` block at line 101, OR (cleaner) extract a `routes/pair.js` module called from inside the request handler. |
| `server.js` | 343 | `\|\| resolve(PUBLIC_ROOT, (req.url === '/' ? 'index.html' : req.url).replace(/^\//, ''));` | The static-file fallthrough. `GET /pair` should serve `public/pair.html` here OR be handled in a dedicated route ABOVE this fallthrough. |
| `server.js` | 366-371 | `const wss = new WebSocketServer({ server, verifyClient: ({ req }) => { return isAllowedWsOrigin(req.headers.origin, req.headers.host); }, });` | **Primary splice.** Convert to 2-arg `verifyClient` form and add device-token gate per R-7 code example above. Add `handleProtocols` to echo back `'clideck-device-token'`. |
| `server.js` | 372 | `wss.on('connection', onConnection);` | Change to the new `(ws, req) => { ws.deviceId = req.clideckDevice.id; ... onConnection(ws); }` wrapper from R-7. |
| `handlers.js` | 267 | `sessions.clients.add(ws);` | (unchanged — auth happened before reaching here per R-7) |
| `handlers.js` | 298 | `ws.on('message', (raw) => {` | Add WS-message arm for `device.list.get` and `device.revoke` inside the switch (around lines 376-396 region where other `case` clauses live). |
| `handlers.js` | 755 | `ws.on('close', () => sessions.clients.delete(ws));` | (unchanged — the close handler is fine for cleanup; the `deviceId` property goes with the GC'd `ws` object) |
| `sessions.js` | 21 | `const clients = new Set();` | (unchanged — Pattern A annotates the `ws` instances, no new module-scope state) |
| `sessions.js` | 53-75 | `function broadcast(msg) { ... }` | Add `device.list` and `device.revoked` to whatever Set the broadcast targets — they go to ALL clients (the standard `for (const c of clients) ...` loop already does this). |
| `public/index.html` | 245-249 | The 4 settings-cat buttons (`general`, `agents`, `notifications`, `appearance`) | Add a 5th `data-cat="devices"` button beside them in the sidebar. |
| `public/index.html` | 280-368 | The `#settings-overlay` panels | Add a new `<div id="settings-devices" class="settings-panel hidden p-6 max-w-2xl">…</div>` panel beside the existing ones (e.g. after `#settings-appearance` ending around line 480). |
| `public/js/settings.js` | 25-28 | `switchCategory` toggles `.hidden` on `.settings-panel` matching `settings-${catId}` | (no change — the new panel works with this naming convention out of the box) |
| `public/js/settings.js` | 89-99 | `export function renderSettings() { ... renderAgentList(); renderThemeSection(); ... }` | Add `renderLinkedDevices()` to the render chain. |
| `public/js/settings.js` | (end of file) | (new function) | Add `function renderLinkedDevices()` + click handlers for revoke buttons (call `confirmClose` with D-06's two copy variants). |
| `public/js/state.js` | 4-13 | The `state` literal | Add `linkedDevices: []` and `deviceId: null`. |
| `public/js/app.js` | 104-118 | `function connect() { state.ws = new WebSocket(...); ... }` | Change line 106: pass `['clideck-device-token', localStorage.getItem('clideck.deviceToken')]` as the second arg to `new WebSocket`. Add the boot-time check BEFORE `connect()` is first called (look for it near line 104 / wherever `connect()` is initially invoked). Add `device.list` and `device.revoked` cases to the `state.ws.onmessage` switch. |
| `public/js/app.js` | 484-498 | `state.ws.onclose = () => { ... setTimeout(connect, 1000); };` | Extend per R-6 / R-7 code example. |
| `public/js/confirm.js` | 22-33 | `export function confirmClose(message, confirmLabel, opts = {})` | (no change — D-06 uses the existing `{hideConfirm, cancelLabel}` shape) |
| `utils.js` | (end of file) | n/a | (optional, Option 3B) Add `atomicWriteJson(path, data)` helper. |
| NEW `devices.js` | — | — | New module per R-3. |
| NEW `public/pair.html` | — | — | Standalone OTP-entry form. ~80 lines vanilla HTML/CSS, no module imports. |
| NEW `public/js/pair.js` | — | — | Standalone JS for pair.html. ~50-60 lines. Reads `<input>`, POSTs to `/pair/redeem`, on success stores token to localStorage + redirects to `/`. |

### Files NOT touched (and why)

- `paths.js` — `DATA_DIR` already resolves `~/.clideck/`; `devices.json` and `bootstrap.otp` live there with no new wiring.
- `runtime.js`, `config.js` — bootstrap OTP is not a config item per D-02 (it's a stdout banner + a one-shot file).
- `transcript.js`, `telemetry-receiver.js`, `plugin-loader.js`, `activity.js`, `shutdown.js` — orthogonal.
- `plugins/*` — no plugin should care about pairing.

---

## §10 — Code examples (for the planner to quote in PLAN tasks)

### 10.1 — `server.js:366-381` splice (verifyClient + handleProtocols)

```js
// server.js — Phase 16 WS auth gate
// Replaces lines 366-371 on HEAD a231b64.
const devices = require('./devices');

function readDeviceToken(req) {
  const raw = req.headers['sec-websocket-protocol'] || '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.includes('clideck-device-token')) return null;
  return parts.find(p => p !== 'clideck-device-token') || null;
}

const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }, callback) => {
    if (!isAllowedWsOrigin(req.headers.origin, req.headers.host)) {
      return callback(false, 403, 'origin not allowed');
    }
    const rawToken = readDeviceToken(req);
    if (!rawToken) return callback(false, 401, 'unpaired');
    const device = devices.findByToken(rawToken);  // hashes + timingSafeEqual
    if (!device) return callback(false, 401, 'unpaired');
    req.clideckDevice = device;
    return callback(true);
  },
  handleProtocols: (protocols) => {
    return protocols.has('clideck-device-token') ? 'clideck-device-token' : false;
  },
});

wss.on('connection', (ws, req) => {
  ws.deviceId = req.clideckDevice.id;
  ws.deviceTokenHash = req.clideckDevice.token_hash;
  devices.touchLastSeen(req.clideckDevice.id);
  return onConnection(ws);
});

wss.on('error', (err) => {
  console.error('[wss] error:', err.code || err.message);
});
```

### 10.2 — `devices.js` core functions

```js
// NEW FILE: devices.js
const { readFileSync, writeFileSync, existsSync, unlinkSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');

const DEVICES_PATH = join(DATA_DIR, 'devices.json');
const BOOTSTRAP_PATH = join(DATA_DIR, 'bootstrap.otp');

let store = { version: 1, devices: [] };

function load() {
  if (!existsSync(DEVICES_PATH)) {
    store = { version: 1, devices: [] };
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(DEVICES_PATH, 'utf8'));
    store = {
      version: parsed.version || 1,
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    };
    console.log(`[devices] Loaded ${store.devices.length} paired device(s)`);
  } catch (e) {
    console.warn(`[devices] Failed to parse ${DEVICES_PATH}: ${e.message}. Starting empty.`);
    store = { version: 1, devices: [] };
  }
}

function save() {
  writeFileSync(DEVICES_PATH, JSON.stringify(store, null, 2));
}

function hashToken(rawToken) {
  return 'sha256:' + crypto.createHash('sha256').update(rawToken).digest('hex');
}

function safeEqualHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function findByToken(rawToken) {
  if (!rawToken) return null;
  const h = hashToken(rawToken);
  for (const d of store.devices) {
    if (safeEqualHash(d.token_hash, h)) return d;
  }
  return null;
}

function mintToken() { return crypto.randomBytes(32).toString('base64url'); }
function mintDeviceId() { return 'dev_' + crypto.randomBytes(16).toString('base64url'); }

function add({ label, uaFingerprint, rawToken }) {
  const now = new Date().toISOString();
  const record = {
    id: mintDeviceId(),
    label: String(label || 'Device').slice(0, 32).trim() || 'Device',
    fingerprint: uaFingerprint || null,
    paired_at: now,
    last_seen: now,
    token_hash: hashToken(rawToken),
  };
  store.devices.push(record);
  save();
  return record;
}

function remove(deviceId) {
  const before = store.devices.length;
  store.devices = store.devices.filter(d => d.id !== deviceId);
  if (store.devices.length !== before) save();
  return before - store.devices.length;
}

function touchLastSeen(deviceId) {
  const d = store.devices.find(x => x.id === deviceId);
  if (!d) return;
  d.last_seen = new Date().toISOString();
  // Note: save() is debounced in practice — calling it on every WS reconnect
  // would write devices.json hundreds of times per session. The planner should
  // either (a) batch via a 30s interval like sessions.startAutoSave, or (b)
  // hold last_seen in memory and persist on shutdown. Recommend (a).
  save();
}

function list() { return store.devices.slice(); }
function isEmpty() { return store.devices.length === 0; }
function clearBootstrap() { try { unlinkSync(BOOTSTRAP_PATH); } catch {} }

module.exports = {
  load, save, list, isEmpty,
  findByToken, add, remove, touchLastSeen,
  mintToken, hashToken,
  DEVICES_PATH, BOOTSTRAP_PATH, clearBootstrap,
};
```

### 10.3 — OTP store (in-memory) and bootstrap

```js
// NEW FILE: pair-otp.js (or inline in server.js or routes/pair.js)
const crypto = require('crypto');
const { writeFileSync } = require('fs');
const devices = require('./devices');

const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  // 31 chars; see Q-1
const OTP_TTL_MS = 5 * 60 * 1000;

// otp -> { expiresAt, used, isBootstrap }
const otpStore = new Map();

function generateOtp() {
  let out = '';
  for (let i = 0; i < 6; i++) out += OTP_ALPHABET[crypto.randomInt(0, OTP_ALPHABET.length)];
  return out;
}

function mintOtp({ ttlSeconds = 300, isBootstrap = false } = {}) {
  const otp = generateOtp();
  const expiresAt = Date.now() + Math.min(ttlSeconds, 900) * 1000;  // hard cap 15min
  otpStore.set(otp, { expiresAt, used: false, isBootstrap });
  return { otp, expiresAt: new Date(expiresAt).toISOString() };
}

function redeemOtp(otp) {
  const entry = otpStore.get(String(otp || '').toUpperCase());
  if (!entry) return { ok: false, error: 'invalid' };
  if (entry.used) return { ok: false, error: 'used' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(otp);
    return { ok: false, error: 'expired' };
  }
  entry.used = true;
  otpStore.delete(otp);
  return { ok: true, isBootstrap: entry.isBootstrap };
}

// Periodic sweep — drop expired entries so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [otp, entry] of otpStore) if (entry.expiresAt < now) otpStore.delete(otp);
}, 60 * 1000).unref();

function bootstrapIfNeeded() {
  if (!devices.isEmpty()) return;
  const { otp } = mintOtp({ ttlSeconds: 24 * 3600, isBootstrap: true });  // 24h
  writeFileSync(devices.BOOTSTRAP_PATH, otp + '\n');
  console.log(
    `\n\x1b[38;5;105m  [clideck] bootstrap pair code: ${otp.slice(0,3)}-${otp.slice(3)}\x1b[0m\n` +
    `\x1b[38;5;245m  Paste into /pair on the first device.\x1b[0m\n` +
    `\x1b[38;5;245m  Also written to ${devices.BOOTSTRAP_PATH}\x1b[0m\n`
  );
}

module.exports = { mintOtp, redeemOtp, bootstrapIfNeeded };
```

### 10.4 — `/pair/redeem` HTTP route handler

```js
// server.js — new HTTP route, place ABOVE the static-file fallthrough at line 343.
if (req.method === 'POST' && req.url === '/pair/redeem') {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 4096) { req.destroy(); return; }  // cap small
  });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid-json' }));
    }
    const otp = String(payload.otp || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const label = String(payload.label || 'Device').slice(0, 32).trim() || 'Device';
    const uaHint = String(payload.ua_hint || '').slice(0, 200);
    const redeem = pairOtp.redeemOtp(otp);
    if (!redeem.ok) {
      res.writeHead(redeem.error === 'expired' ? 410 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: redeem.error }));
    }
    const rawToken = devices.mintToken();
    const uaFingerprint = require('crypto').createHash('sha256').update(uaHint).digest('hex').slice(0, 12);
    const record = devices.add({ label, uaFingerprint, rawToken });
    if (redeem.isBootstrap) devices.clearBootstrap();
    // CRITICAL: this is the ONE moment the raw token is returned. After this
    // response, the raw token exists only in the client's localStorage; the
    // server holds only the hash. Per SPEC AC8.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, device_id: record.id, token: rawToken, label: record.label }));
  });
  return;
}

if (req.method === 'POST' && req.url === '/pair/mint-otp') {
  // Must be authenticated — but we don't have a session-cookie / token scheme
  // for HTTP. Recommend: this route reads the same Sec-WebSocket-Protocol-style
  // device-token from a custom header (X-Clideck-Device-Token), and verifies
  // it the same way the WS gate does. Planner to lock the exact header name.
  // ...
}

if (req.method === 'GET' && req.url === '/pair') {
  // Serve public/pair.html, NOT public/index.html. Inline for clarity:
  const pairHtml = readFileSync(join(PUBLIC_ROOT, 'pair.html'));
  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(pairHtml);
}
```

### 10.5 — Browser-side WS construction with subprotocol

```js
// public/js/app.js:106 — REPLACE the single-arg WebSocket construction
// CURRENT:
// state.ws = new WebSocket(`${wsProtocol}//${location.host}`);

// PROPOSED:
const deviceToken = localStorage.getItem('clideck.deviceToken');
if (!deviceToken) {
  // No token — go to /pair. This path also fires on a fresh phone.
  window.location.href = '/pair';
  return;  // do NOT construct the WS
}
state.ws = new WebSocket(
  `${wsProtocol}//${location.host}`,
  ['clideck-device-token', deviceToken]
);
```

### 10.6 — Revoke handler in `handlers.js`

```js
// handlers.js — new case inside the ws.on('message') switch around line 376
case 'device.revoke': {
  const targetId = String(msg.deviceId || '');
  if (!targetId) {
    ws.send(JSON.stringify({ type: 'device.revoke.result', ok: false, error: 'no deviceId' }));
    break;
  }
  const devices = require('./devices');
  const removed = devices.remove(targetId);
  if (!removed) {
    ws.send(JSON.stringify({ type: 'device.revoke.result', ok: false, error: 'not found' }));
    break;
  }
  // Close every live WS belonging to the revoked device (Pattern A from R-4).
  let closedCount = 0;
  for (const otherWs of sessions.clients) {
    if (otherWs.deviceId === targetId) {
      try { otherWs.close(4401, 'revoked'); } catch {}
      closedCount++;
    }
  }
  // Tell remaining clients to refresh their Linked Devices list.
  sessions.broadcast({ type: 'device.revoked', deviceId: targetId });
  ws.send(JSON.stringify({ type: 'device.revoke.result', ok: true, deviceId: targetId, closedCount }));
  break;
}

case 'device.list.get': {
  const devices = require('./devices');
  const list = devices.list().map(d => ({
    id: d.id, label: d.label, paired_at: d.paired_at, last_seen: d.last_seen,
    // Live status — derive from sessions.clients on the fly. O(devices × clients) ≤ 25.
    live: [...sessions.clients].some(c => c.deviceId === d.id),
  }));
  ws.send(JSON.stringify({ type: 'device.list', list }));
  break;
}
```

### 10.7 — Client-side onclose extension

See §6 / §7 for the full code. Repeating the recommended shape:

```js
let connectedAtLeastOnce = false;
state.ws.onopen = () => {
  connectedAtLeastOnce = true;
  // ... existing onopen body ...
};
state.ws.onclose = (event) => {
  connectedAt = null;
  renderStatusBadge();
  clearHeartbeat();

  const hasToken = !!localStorage.getItem('clideck.deviceToken');
  const isAuthFail = event.code === 4401 ||
    (!connectedAtLeastOnce && event.code === 1006 && hasToken);
  if (isAuthFail) {
    localStorage.removeItem('clideck.deviceToken');
    localStorage.removeItem('clideck.deviceId');
    window.location.href = '/pair';
    return;
  }

  connectedAtLeastOnce = false;
  if (!lastDropToastId) {
    lastDropToastId = `ws-reconnect-${Date.now()}`;
    showToast('Connection lost — reconnecting…', { id: lastDropToastId, type: 'warn', duration: 0 });
  }
  setTimeout(connect, 1000);
};
```

### 10.8 — Unit test scaffolding (mirror `tests/check-cwd-handler.test.js` style)

```js
// tests/devices-store.test.js — example shape
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

let TEST_DATA_DIR;
function freshDevices() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require('path').sep}clideck${require('path').sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../devices.js');
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-devices-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});
afterEach(() => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('devices store', () => {
  it('round-trips token hash, not raw token', () => {
    const devices = freshDevices();
    devices.load();
    const rawToken = '<token-redacted>';  // not a real token
    const rec = devices.add({ label: 'Test', uaFingerprint: 'ua-test', rawToken });
    // Reload from disk
    const devices2 = freshDevices();
    devices2.load();
    const found = devices2.list().find(d => d.id === rec.id);
    expect(found).toBeTruthy();
    expect(found.token_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(found)).not.toContain(rawToken);  // raw never persists
  });
});
```

---

## §A — Assumption Log

| # | Claim | Section | Source / Confidence | Risk if Wrong |
|---|-------|---------|---------------------|---------------|
| A1 | OTP alphabet should be 31 chars (`A-Z minus {I, L, O}` + `2-9`) yielding ~887M keyspace | §2, §10.3 | `[ASSUMED]` — SPEC said "no `0/O/1/I/l`" implying 28 chars but my count is 31; planner to confirm at PLAN time | Brute-force probability changes by ~3×; still well below threshold. Low risk. |
| A2 | `crypto.randomInt(0, n)` produces uniform integers without modulo bias | §2 | `[CITED: nodejs.org/api/crypto.html]` — documented uniform, internally uses rejection sampling | None — Node API docs explicit. |
| A3 | iOS Safari ITP storage cap is relaxed for installed PWAs in iOS 17/18+ | §5 | `[ASSUMED]` — multiple WebKit blog posts + community reports through 2024; not empirically tested on Lance's exact iOS | If wrong: phone silently un-pairs every ~7 days. Mitigation already documented (re-OTP from desktop). Low-medium risk. |
| A4 | All reverse proxies in `clideck-docker-lance` stack pass `Sec-WebSocket-Protocol` through unaltered with 43-char tokens | §1 | `[ASSUMED]` — nginx, Caddy, Traefik defaults all accept; not tested with the actual deployment | If wrong: phone can't connect via reverse proxy. Mitigation already documented in CONTEXT.md (D-01 override to `?token=` query). Low risk. |
| A5 | RFC 6455 4xxx close codes survive intermediate proxies | §7 (Q-5) | `[ASSUMED]` based on RFC + general practice | If wrong: client sees 1006 even when server sent 4401. Both paths converge on the same UX. No functional impact. |
| A6 | `window.location.href = '/pair'` synchronously navigates after `localStorage.removeItem` returns | §6 | `[ASSUMED]` based on event-loop ordering | If wrong: token might persist into the next page-load. Unlikely; standard browser behaviour. |
| A7 | Setting `ws.deviceId = ...` is safe (no name collision with ws library or other clideck code) | §4, §7 | `[VERIFIED]` — grep'd `node_modules/ws` for `_deviceId` / `deviceId` (no hit), grep'd clideck repo for `ws.deviceId` (no hit) | Low risk. |
| A8 | `n ≤ 5` devices means O(n) timingSafeEqual is fine | §2, §4 | `[CITED: SPEC threat model]` — clideck's deployment is single-user (Lance) | If wrong (e.g. clideck gets adopted by a team): 50 devices still O(50) per upgrade = sub-ms. Even 500 is fine. Negligible risk. |

---

## §B — State of the Art

| Old / training-data approach | Current approach (2026) | When changed |
|------------------------------|------------------------|--------------|
| Pass token in `?token=` query | `Sec-WebSocket-Protocol` header | RFC 6455 §1.9 standardised the subprotocol field; mainstream adoption ~2018+. Query-string tokens are still widely used but suffer the access-log + browser-history exfil paths called out in CONTEXT.md D-01. |
| `bcrypt`/`argon2` for token hash | SHA-256 | Bcrypt/Argon2 are for *password* hashing (slow, work-factor-tuned) because passwords are low-entropy. A 256-bit opaque token has full entropy already; SHA-256 is the right tool for "remember this token by hash". `[CITED: OWASP Password Storage Cheat Sheet]` |
| Cookies with `httpOnly + Secure + SameSite=Strict` | `localStorage` + WebSocket subprotocol | For our specific use (token must be readable by JS to pass via subprotocol), cookies don't compose. The XSS-resistance argument for `httpOnly` doesn't apply when the same JS context constructs the WebSocket. |
| Long-lived JWT signed with HS256 | Opaque random tokens + server-side table | JWTs are stateless — revocation requires either a blocklist (defeating "stateless") or short TTLs + refresh tokens (more moving parts). Opaque tokens give us instant server-side revocation for free. The SPEC is explicit: bespoke token model is the locked simplicity choice. |

---

## §C — Sources

### Primary (HIGH confidence — verified by direct read)

- `node_modules/ws/lib/websocket-server.js` (clideck repo, ws@8.19.0) — `verifyClient`, `handleProtocols`, `abortHandshake` flow. Lines 247-405, 497-525.
- `node_modules/ws/lib/subprotocol.js` (ws@8.19.0) — `parse(header) → Set<string>`. Lines 12-60.
- `node_modules/ws/lib/validation.js` (ws@8.19.0) — `tokenChars` table, `isValidStatusCode`. Lines 19-44.
- `/home/clideck/projects/clideck/handlers.js` HEAD `a231b64` — `onConnection` line 266, `sessions.clients.add(ws)` line 267, message switch lines 298-754, close handler line 755.
- `/home/clideck/projects/clideck/server.js` HEAD `a231b64` — `WebSocketServer` setup line 366, current `verifyClient` lines 368-370, `wss.on('connection', onConnection)` line 372.
- `/home/clideck/projects/clideck/sessions.js` HEAD `a231b64` — `clients = new Set()` line 21, `broadcast` lines 53-75, `writeFileSync(SAVED_PATH, ...)` line 762, `loadSessions` lines 770-784. **NO atomic-write helper** — verified.
- `/home/clideck/projects/clideck/config.js` HEAD `a231b64` — `writeFileSync(CONFIG_PATH, ...)` line 218. Plain write, no atomicity.
- `/home/clideck/projects/clideck/utils.js` HEAD `a231b64` — no crypto helpers; `crypto` used directly in `sessions.js:4`, `runtime.js:32`, `config.js:191`, `paste-blobs.js:106`, `plugin-loader.js:2,34`.
- `/home/clideck/projects/clideck/public/js/confirm.js` HEAD `a231b64` — Phase 10 `{hideConfirm, cancelLabel}` shape.
- `/home/clideck/projects/clideck/public/index.html` HEAD `a231b64` — settings overlay structure, settings-cat buttons.

### Secondary (MEDIUM-HIGH confidence — verified against authoritative external docs)

- `nodejs.org/api/crypto.html` — `randomInt`, `randomBytes`, `timingSafeEqual`, `createHash` signatures. (Fetched 2026-06-05.)
- `nodejs.org/api/buffer.html#buffers-and-character-encodings` — `'base64url'` encoding (Node 14+).
- `developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket` — constructor `protocols` parameter behaviour.
- `developer.mozilla.org/en-US/docs/Web/API/CloseEvent` — `event.code`, `event.reason` semantics.
- `rfc-editor.org/rfc/rfc6455#section-7.4.2` — close code 4000-4999 reserved for application use.
- `rfc-editor.org/rfc/rfc6455#section-7.1.5` — close code 1006 ("abnormal closure").
- `webkit.org/blog/9521/intelligent-tracking-prevention-2-3/` — ITP storage policies (referenced from MEDIUM context for §5).

### Tertiary (LOW confidence — flagged in Assumption Log)

- iOS 17/18 ITP-on-installed-PWA behaviour — `[ASSUMED A3]`, needs Lance's manual confirmation.
- Reverse-proxy subprotocol pass-through for `clideck-docker-lance` stack — `[ASSUMED A4]`, OVERRIDE-condition documented in CONTEXT D-01.

---

## §D — Metadata

**Confidence breakdown:**
- R-1 (subprotocol transport): **HIGH** — verified against ws source.
- R-2 (crypto primitives): **HIGH** — Node crypto API documented and stable since v14.
- R-3 (devices.json schema + atomic-write): **HIGH** (schema) / **HIGH** (recommendation) — the CONTEXT claim of an existing atomic-write pattern is wrong; verified.
- R-4 (revoke closes sockets): **HIGH** — Pattern A maps cleanly onto existing `sessions.clients` Set.
- R-5 (iOS Safari storage): **MEDIUM-LOW** — recommendation given, but ITP behaviour for PWAs is moving target.
- R-6 (4401 propagation): **HIGH** — RFC 6455 explicit.
- R-7 (handshake reject codes): **HIGH** — verified ws source + RFC; the 1006-vs-4401 ambiguity is real and the hybrid mitigation is the right call.

**Research date:** 2026-06-05.
**Valid until:** 2026-07-05 (30 days for the stable RFC/Node crypto findings); 2026-06-19 (14 days for iOS Safari ITP findings — Apple ships Safari point releases on a faster cadence).
**Validated against:** HEAD `a231b64414ae9587bb680a1c75ceaa5851371f85` on branch `main`.
