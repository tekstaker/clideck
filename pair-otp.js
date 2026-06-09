// Phase 16 — One-time pairing-code (OTP) layer for the linked-devices feature.
//
// Pure in-memory module. NO HTTP, NO WebSocket, NO persistence. The OTP store
// is a `Map<otp, { expiresAt, used, isBootstrap }>` that lives only for the
// life of the Node process. On restart all user-minted OTPs are gone (their
// 5-minute TTL bounds the loss to ≤5 min anyway), and `announcePairCode()`
// re-mints a fresh reusable host pairing code at every boot.
//
// Why a Map and not a file: the 5-min TTL + single-use semantics combined
// with the very small number of expected pairing operations (Lance + a
// handful of devices) means an in-memory store is the smallest correct
// thing. Persistence would add risk (a stale OTP surviving a restart could
// be replayed) for zero benefit (user just re-mints from the Settings UI).
//
// Wiring lives in `server.js` (Plan 16-04; localhost-trust revision 2026-06-09):
//   - At boot, after `devices.load()`, call `announcePairCode()`. This ALWAYS
//     prints a reusable host pairing code to stdout and writes it to
//     `.clideck/bootstrap.otp` — whether or not devices are already paired —
//     so the owner can always grab a code (from the terminal, or via
//     `docker exec … cat`) to pair another phone/tablet.
//   - The `/pair/redeem` route calls `redeemOtp(otp)`. The host/bootstrap
//     code is reusable (not consumed) and the file is NOT cleared on redeem.
//   - The `/pair/mint-otp` route (owner-authenticated) calls `mintOtp()`
//     and returns the OTP + expiresAt to the Settings panel (single-use).
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
// `announcePairCode()` prints the host pairing code to stdout. This is the
// ONLY intentional secret-in-logs in the pairing feature and is called out
// in CONTEXT D-02. Rationale: the owner needs a value they can read from a
// place they already have access to — the server's stdout (or the
// .clideck/bootstrap.otp file via `docker exec … cat`). Bounds: 24h TTL,
// visible only to whoever has shell on the host (which is Lance, by
// definition). REUSABLE by design (2026-06-09) so one code pairs several
// devices; Lance has explicitly waived the host-visibility concern.

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
  // Two-tier consumption (CHANGED 2026-06-09):
  //   - USER-minted OTPs (Settings → Add device) stay SINGLE-USE: mark used
  //     so a second redeem returns { ok: false, error: 'used' } (AC9).
  //   - The HOST/bootstrap code is REUSABLE: Lance pairs multiple devices
  //     from the one code printed in his terminal, so we do NOT consume it.
  //     Bounded by its 24h TTL; visible only to whoever has the host shell
  //     (explicit owner waiver). See announcePairCode() header.
  if (!entry.isBootstrap) entry.used = true;
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

// announcePairCode() — print + persist a reusable host pairing code at boot.
//
// CHANGED 2026-06-09 (was bootstrapIfNeeded):
//   - ALWAYS runs, whether or not devices.json already has paired devices.
//     Previously it short-circuited once the first device paired, which left
//     Lance unable to grab a code from his terminal to pair ADDITIONAL
//     devices. Now the code is always visible — copy it from the terminal (or
//     `cat .clideck/bootstrap.otp` after `docker exec`) and paste into /pair
//     on any device.
//   - The code is REUSABLE (redeemOtp does not consume isBootstrap entries),
//     so one printed code pairs as many devices as needed within its 24h TTL.
//
// Per CLAUDE.md §13 — this is the ONE deliberate secret-in-logs exception in
// the pairing feature, and Lance has explicitly waived the host-visibility
// concern ("not worried about a security issue of showing the code on the
// machine where this is running"). Remote devices still need VPN + the code;
// loopback devices are trusted by locality and don't need it at all.
function announcePairCode() {
  const { otp } = mintOtp({ ttlSeconds: 86400, isBootstrap: true });
  writeFileSync(devices.BOOTSTRAP_PATH, otp + '\n');
  const hyphenated = otp.slice(0, 3) + '-' + otp.slice(3);
  console.log(
    `\n\x1b[38;5;105m  [clideck] pair code: ${hyphenated}\x1b[0m  \x1b[38;5;245m(reusable · 24h)\x1b[0m\n` +
    `\x1b[38;5;245m  Paste into /pair on any phone/tablet. Local browser needs no code.\x1b[0m\n` +
    `\x1b[38;5;245m  Also at ${devices.BOOTSTRAP_PATH}\x1b[0m\n`
  );
}

module.exports = { mintOtp, redeemOtp, announcePairCode, OTP_ALPHABET };
