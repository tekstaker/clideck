// Phase 16 — One-time pairing-code (OTP) layer for the linked-devices feature.
//
// Pure in-memory module. NO HTTP, NO WebSocket, NO persistence. The OTP store
// is a `Map<otp, { expiresAt, used, isBootstrap }>` that lives only for the
// life of the Node process. On restart all user-minted OTPs are gone (their
// 5-minute TTL bounds the loss to ≤5 min anyway), and `bootstrapIfNeeded()`
// will re-mint a bootstrap OTP if `devices.json` is still empty.
//
// Why a Map and not a file: the 5-min TTL + single-use semantics combined
// with the very small number of expected pairing operations (Lance + a
// handful of devices) means an in-memory store is the smallest correct
// thing. Persistence would add risk (a stale OTP surviving a restart could
// be replayed) for zero benefit (user just re-mints from the Settings UI).
//
// Wiring lives in `server.js` (Plan 16-04):
//   - At boot, after `devices.load()`, call `bootstrapIfNeeded()`. If the
//     server has no paired devices, this prints a recovery OTP to stdout
//     and writes it to `.clideck/bootstrap.otp` so the owner can pair the
//     first device with nothing but shell access.
//   - The `/pair/redeem` route calls `redeemOtp(otp)`; on `{ ok: true, isBootstrap: true }`
//     it then calls `devices.clearBootstrap()` to delete the recovery file.
//   - The `/pair/mint-otp` route (owner-authenticated) calls `mintOtp()`
//     and returns the OTP + expiresAt to the Settings panel.
//
// ─── Alphabet pin (RESEARCH Q-1) ────────────────────────────────────────────
// `OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'` — exactly 31 chars.
// Excludes the visually ambiguous {0, O, 1, I, L} from the alphanumeric 36.
// Keyspace = 31^6 ≈ 887M. Even at a sustained 10 req/sec brute-force rate
// against a single live 5-min-TTL window, the hit probability is ~3.4×10⁻⁶
// (RESEARCH §8 P-1). For a VPN-fronted owner-only surface that's fine.
// The Wave-0 spec pins this literal alphabet — changing it is a coordinated
// edit with tests/pair-otp.test.js.
//
// ─── TTL caps (defensive against caller bugs) ──────────────────────────────
// User-minted OTPs are capped at 900s (15 min) regardless of what the caller
// passes; the default is 300s (5 min). Bootstrap OTPs are capped at 24h
// (86400s) and default to that. The cap prevents a buggy future caller from
// accidentally minting a never-expiring OTP. The bootstrap path explicitly
// passes `isBootstrap: true` so it gets the 24h ceiling — long enough to
// survive the time between Lance starting the server, reading the banner
// over SSH, and walking to his phone, but not so long that a stale bootstrap
// OTP becomes a credential lying around indefinitely.
//
// ─── setInterval.unref() pin (RESEARCH §10.3) ──────────────────────────────
// The 60-second sweep is opportunistic GC for expired entries — the
// correctness path is `redeemOtp` itself, which checks `Date.now() > expiresAt`
// on every call. The sweep just stops the Map from growing unbounded over
// a long-running server. `.unref()` is REQUIRED: without it the interval
// keeps the Node event loop alive and the vitest process hangs after the
// suite completes. (We learned this the hard way in Phase 16 wave 0.)
//
// ─── Per CLAUDE.md §13: deliberate, bounded secret-in-logs exception ───────
// `bootstrapIfNeeded()` prints the bootstrap OTP to stdout. This is the
// ONLY intentional secret-in-logs in Phase 16 and is called out explicitly
// in CONTEXT D-02. Rationale: the only way to bootstrap from a fresh install
// (no paired device, no UI access yet) is via a value the owner can read
// from a place they already have access to — the server's stdout. The
// alternative (require a paired device to mint the first OTP) is a
// chicken-and-egg problem. Bounds: single-use, 24h TTL, visible only to
// whoever has shell on the server (which is Lance, by definition).

const crypto = require('crypto');
const { writeFileSync } = require('fs');
const devices = require('./devices');

const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars — see header.

// otp -> { expiresAt: <ms since epoch>, used: bool, isBootstrap: bool }
const otpStore = new Map();

function generateOtp() {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += OTP_ALPHABET[crypto.randomInt(0, OTP_ALPHABET.length)];
  }
  return out;
}

// Canonical normaliser used by both the in-process redeem path and the
// `/pair/redeem` HTTP handler (Plan 16-04 mirrors this regex). Accepts
// lowercase, hyphens, and surrounding whitespace, returns the UPPER form
// with only the 31-char alphabet's chars retained. Empty / non-string input
// becomes `''` — `redeemOtp` then short-circuits to `{ ok: false, error: 'invalid' }`.
function normaliseOtp(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function mintOtp({ ttlSeconds = 300, isBootstrap = false } = {}) {
  const otp = generateOtp();
  // Two-tier cap: bootstrap callers can opt into a 24h window; everything
  // else is hard-capped at 15min regardless of what's passed.
  const cap = isBootstrap ? 86400 : 900;
  const effectiveTtl = Math.min(ttlSeconds, cap);
  const expiresAt = Date.now() + effectiveTtl * 1000;
  otpStore.set(otp, { expiresAt, used: false, isBootstrap });
  return { otp, expiresAt: new Date(expiresAt).toISOString() };
}

function redeemOtp(otp) {
  const key = normaliseOtp(otp);
  if (!key) return { ok: false, error: 'invalid' };
  const entry = otpStore.get(key);
  if (!entry) return { ok: false, error: 'invalid' };
  if (entry.used) return { ok: false, error: 'used' };
  if (Date.now() > entry.expiresAt) {
    // Leave the entry in the store; the sweep's 1-hour grace window will
    // GC it later. Deleting here would make a *second* expired-redeem
    // return 'invalid' instead of 'expired' — a strictly worse signal
    // for the caller debugging "why didn't my OTP work?".
    return { ok: false, error: 'expired' };
  }
  // INTENTIONAL: mark used but do NOT delete. The Wave-0 spec asserts a
  // second call to redeemOtp(<same otp>) returns { ok: false, error: 'used' };
  // deleting on success would degrade that to 'invalid'. The sweep removes
  // used+expired entries after the grace window — memory is bounded by
  // (TTL + grace), not by deletion-on-redeem.
  entry.used = true;
  return { ok: true, isBootstrap: entry.isBootstrap };
}

// Periodic sweep — drops long-expired entries so the Map can't grow
// unbounded over a long-running server.
//
// ─── Why the 1-hour grace window? ───────────────────────────────────────────
// The Wave-0 spec asserts that `redeemOtp(<expired>)` returns
// `{ ok: false, error: 'expired' }` — explicitly distinguishable from
// `'invalid'` (never existed). If the sweep deleted entries the instant
// they expired, an unlucky redeem call that lands *after* the sweep ran
// would see no entry and return `'invalid'` instead of `'expired'`. Tests
// using `vi.advanceTimersByTime(...)` hit this every time because fake
// timers fire the sweep many times in a row.
//
// The fix: only delete entries that are *long* past their TTL (1 hour
// grace). Within that window `redeemOtp` always finds the entry and
// reports `'expired'` correctly; the Map still grows bounded — at the
// worst-case sustained-mint rate of a few OTPs per day, an extra hour
// of retention adds at most a few entries. Bootstrap OTPs (24h TTL)
// hang around for 25h total before sweep, also negligible.
//
// Correctness still rests in `redeemOtp` itself (which checks `Date.now()
// > expiresAt` on every call). The sweep is purely opportunistic GC.
//
// `.unref()` is REQUIRED — see header comment. Without it the test runner
// hangs after the suite finishes because this interval keeps the event
// loop alive.
const SWEEP_GRACE_MS = 60 * 60 * 1000; // 1 hour past expiry before GC.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpStore) {
    if (entry.expiresAt + SWEEP_GRACE_MS < now) otpStore.delete(key);
  }
}, 60 * 1000).unref();

function bootstrapIfNeeded() {
  if (!devices.isEmpty()) return;
  const { otp } = mintOtp({ ttlSeconds: 86400, isBootstrap: true });
  writeFileSync(devices.BOOTSTRAP_PATH, otp + '\n');
  // Intentional: bootstrap recovery path. The OTP is single-use, short-lived,
  // and visible only to whoever has shell access to the server. Per Phase 16
  // SPEC + CONTEXT D-02. This is the CLAUDE.md §13 deliberate exception.
  const hyphenated = otp.slice(0, 3) + '-' + otp.slice(3);
  console.log(
    `\n\x1b[38;5;105m  [clideck] bootstrap pair code: ${hyphenated}\x1b[0m\n` +
    `\x1b[38;5;245m  Paste into /pair on the first device.\x1b[0m\n` +
    `\x1b[38;5;245m  Also written to ${devices.BOOTSTRAP_PATH}\x1b[0m\n`
  );
}

module.exports = { mintOtp, redeemOtp, bootstrapIfNeeded, OTP_ALPHABET };
