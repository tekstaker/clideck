// Phase 16 — HTTP route handlers for the device-pairing handshake.
//
// Three pure-function handlers, each (req, res, deps) → writes response:
//
//   handleRedeemHttp(req, res, { devices, pairOtp })
//     POST /pair/redeem — UNAUTHENTICATED. Body: { otp, label, ua_hint }.
//     Single surface where the raw token leaves the server: returned ONCE in
//     the response body on success. AC2 / AC7 / AC8 / AC9 contract.
//
//   handleMintOtpHttp(req, res, { devices, pairOtp })
//     POST /pair/mint-otp — AUTHENTICATED via the X-Clideck-Device-Token
//     HTTP header (RESEARCH §10.4 / planner pin in 16-04 PLAN). Same lookup
//     as the WS verifyClient gate (devices.findByToken → timing-safe hash
//     compare) so the lifetime semantics stay identical: revoke a device →
//     both surfaces start rejecting on the next call.
//
//   servePairHtml(req, res)
//     GET /pair — serves public/pair.html. 16-04 ships the placeholder; 16-06
//     replaces it with the full pair UI. Defensive 503 if the file is missing.
//
// ─── Dependency injection rationale (PATTERNS §1 row 7) ───────────────────
// `devices` and `pairOtp` are passed in via the `deps` arg rather than
// required at module-scope. This is the project's first HTTP-handler unit
// test, and the Wave-0 spec at tests/pair-redeem.test.js wires fresh
// modules per test via require-cache wipe. With DI the tests don't have to
// monkey-patch globals — they just pass freshly-required `devices` and
// `pairOtp` into the handler. Production (server.js) supplies its own
// module-scoped singletons; tests supply per-test instances. Same surface,
// different lifetimes.
//
// ─── Per CLAUDE.md §13 — secrets hygiene ──────────────────────────────────
// The raw token (43-char base64url) appears in EXACTLY ONE place: the
// response body of a successful /pair/redeem. NEVER in a console.log, never
// in an Error message, never in a JSON.stringify of an entire request. The
// AC8 test in pair-redeem.test.js spies on console.log and asserts the raw
// token never appears in any captured call. This module is also careful not
// to log the minted OTP from /pair/mint-otp — though shorter-lived, it's
// still a credential.
//
// ─── readJson/sendJson/jsonError helpers ──────────────────────────────────
// Modelled on session-ask.js:7-33. The shape differs slightly:
//   - readJson here is callback-style (cb(err, payload)) so the handler can
//     do its own response-writing in the on-end callback without async/await
//     plumbing through the deps. Tests inject body chunks via req.emit('data')
//     + req.emit('end'), so the synchronous-ish callback shape is what the
//     spec drives.
//   - sendJson sets Content-Type and ends — identical to session-ask.
//   - jsonError is sugar for `sendJson(res, status, { ok: false, error })`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 4096-byte cap from RESEARCH §10.4 / PLAN <behavior>. Anything bigger and
// we destroy the request without writing a response — tests/pair-redeem
// asserts the request emits 'close' and res.ended stays false.
const MAX_REDEEM_BODY = 4096;

function readJson(req, maxBytes, cb) {
  const chunks = [];
  let total = 0;
  let done = false;
  function finish(err, payload) {
    if (done) return;
    done = true;
    cb(err, payload);
  }
  req.on('data', (chunk) => {
    if (done) return;
    total += chunk.length;
    if (total > maxBytes) {
      // Per Wave-0 spec: cap blown → req.destroy(), no response written.
      done = true;
      try { req.destroy(); } catch {}
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    const body = Buffer.concat(chunks).toString('utf8');
    if (!body) return finish(null, {});
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return finish(new Error('invalid-json')); }
    finish(null, parsed);
  });
  req.on('error', (e) => finish(e));
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function jsonError(res, status, error) {
  sendJson(res, status, { ok: false, error });
}

// ─── POST /pair/redeem ────────────────────────────────────────────────────
//
// Body shape (validated + normalised):
//   { otp: string, label?: string, ua_hint?: string }
//
// Response on success: { ok: true, device_id, token, label }   (200)
// Response on error:   { ok: false, error: 'expired'|'used'|'invalid'|'invalid-json' }
// HTTP status maps:
//   - 200: ok
//   - 400: 'invalid-json' | 'used' | 'invalid'  (the OTP layer can't tell
//          'never existed' from 'wrong format' so both surface as 'invalid')
//   - 410: 'expired' — semantic Gone, distinguishable from 400 'used'
//
// Normalisation contract (matches pair-otp.js's `normaliseOtp`):
//   - otp: upper-cased, stripped to A-Z 0-9 only
//   - label: trimmed, capped at 32 chars, fallback 'Device' if empty after sanitise
//   - ua_hint: capped at 200 chars
//
// Bootstrap flow: when pair-otp.redeemOtp returns `isBootstrap: true`, this
// handler calls devices.clearBootstrap() AFTER the successful add(). That
// deletes the on-disk .clideck/bootstrap.otp file (the recovery path is
// closed once the first device pairs).
function handleRedeemHttp(req, res, { devices, pairOtp }) {
  readJson(req, MAX_REDEEM_BODY, (err, payload) => {
    if (err) {
      // The only readJson failure mode that delivers an error here is
      // invalid-json — the body-cap path destroys the request and never
      // calls back.
      return jsonError(res, 400, 'invalid-json');
    }
    payload = payload || {};

    // Normalise. The OTP normaliser mirrors pair-otp.normaliseOtp exactly so
    // a hyphenated user-typed OTP ('ABC-DEF') redeems against the stored
    // 'ABCDEF' key. pair-otp also normalises internally — both layers do it
    // defensively because either could be the upstream caller in tests.
    const otp = String(payload.otp || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sanitisedLabel = String(payload.label || 'Device').slice(0, 32).trim() || 'Device';
    const uaHint = String(payload.ua_hint || '').slice(0, 200);

    const result = pairOtp.redeemOtp(otp);
    if (!result.ok) {
      // Distinct status codes by error type — AC9 mandates the client can
      // distinguish expired vs used vs invalid.
      if (result.error === 'expired') return jsonError(res, 410, 'expired');
      if (result.error === 'used')    return jsonError(res, 400, 'used');
      return jsonError(res, 400, 'invalid');
    }

    // Successful redeem. Mint a fresh device token + fingerprint, persist
    // the device record with the SHA-256 hash of the token (NOT the raw
    // token — AC8 invariant), return the raw token in the response body
    // exactly once.
    const rawToken = devices.mintToken();
    const uaFingerprint = uaHint
      ? crypto.createHash('sha256').update(uaHint).digest('hex').slice(0, 12)
      : null;
    const record = devices.add({ label: sanitisedLabel, uaFingerprint, rawToken });

    // Bootstrap close-out: if this was the bootstrap OTP, delete the
    // recovery file on disk. The OTP itself is already marked `used` in the
    // pair-otp store so it can't be redeemed twice anyway; deleting the
    // file removes the lingering credential on the filesystem.
    if (result.isBootstrap) {
      devices.clearBootstrap();
    }

    // Per CLAUDE.md §13: rawToken appears here in the response body and
    // NOWHERE ELSE. Do not console.log this object, do not log the token
    // value separately. The AC8 spec asserts this with a console.log spy.
    sendJson(res, 200, {
      ok: true,
      device_id: record.id,
      token: rawToken,
      label: record.label,
    });
  });
}

// ─── POST /pair/mint-otp ──────────────────────────────────────────────────
//
// Auth gate: the X-Clideck-Device-Token HTTP header (planner pin at 16-04
// PLAN, resolving RESEARCH §10.4 Q open). The header value is the raw
// 43-char base64url token the browser stored in localStorage at pair-time.
// We use devices.findByToken to look it up — same call as the WS
// verifyClient gate, same SHA-256-hash + timingSafeEqual semantics. This
// keeps lifetime in sync: revoke a device, and both /pair/mint-otp AND the
// next WS reconnect will reject.
//
// Body is intentionally ignored. POST is chosen over GET because:
//   - GETs to /pair/mint-otp could be cached by intermediates
//   - POSTs are not idempotent by convention, which matches "mints a new OTP"
//   - It keeps the route surface aligned with /pair/redeem (also POST)
//
// Response on success: { ok: true, otp, expires_at }   (200)
// Response on auth fail: { ok: false, error: 'unauthorized' } (401)
//
// Per CLAUDE.md §13: do NOT log the minted OTP. It is a short-lived
// credential — printed to the response body and that's the only surface.
function handleMintOtpHttp(req, res, { devices, pairOtp }) {
  const headerToken = req.headers && req.headers['x-clideck-device-token'];
  if (!headerToken || typeof headerToken !== 'string' || !headerToken.trim()) {
    return jsonError(res, 401, 'unauthorized');
  }
  const device = devices.findByToken(headerToken);
  if (!device) {
    return jsonError(res, 401, 'unauthorized');
  }
  // 5-minute TTL is the user-facing default per pair-otp.js. The cap in
  // pair-otp clamps user-minted OTPs at 900s regardless of what's passed.
  const { otp, expiresAt } = pairOtp.mintOtp({ ttlSeconds: 300 });
  sendJson(res, 200, { ok: true, otp, expires_at: expiresAt });
}

// ─── GET /pair ────────────────────────────────────────────────────────────
//
// Serves public/pair.html. The 503 fallback is defensive — under normal
// operation Task 3 of plan 16-04 creates the placeholder and 16-06 swaps
// in the full UI; the 503 only fires if a deploy somehow loses the file.
function servePairHtml(req, res) {
  const pairHtmlPath = path.join(__dirname, '..', 'public', 'pair.html');
  if (!fs.existsSync(pairHtmlPath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('pair page not yet built');
  }
  try {
    const body = fs.readFileSync(pairHtmlPath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('failed to read pair page');
  }
}

module.exports = {
  handleRedeemHttp,
  handleMintOtpHttp,
  servePairHtml,
  readJson,
  sendJson,
  jsonError,
};
