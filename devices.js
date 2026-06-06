// Phase 16 — Device pairing persistence layer.
//
// Pure data + crypto module. NO HTTP, NO WebSocket. This is the data store
// behind the linked-devices feature: it persists `.clideck/devices.json`,
// mints opaque per-device tokens + device IDs, hashes tokens BEFORE
// persistence so the raw token never lives on disk (AC8), and looks up
// devices by raw token with a constant-time hash compare (AC8 defence in
// depth).
//
// Wiring lives elsewhere:
//   - server.js (Phase 16-04 / 16-05) calls `devices.load()` at boot,
//     immediately after `sessions.loadSessions()`, before `wss` is wired.
//   - server.js's verifyClient gate calls `devices.findByToken(rawToken)`
//     to authorize WebSocket upgrades.
//   - handlers.js calls `devices.touchLastSeen(deviceId)` on each
//     successful WS connect.
//   - The `/pair/redeem` route (Phase 16-03) calls `devices.add(...)` and
//     `devices.clearBootstrap()` after a successful OTP redeem.
//
// Persistence pin — Option A (plain writeFileSync, NO atomic-rename):
//   PATTERNS §2.2 + RESEARCH §3 / Q-2 pinned this to match the existing
//   project precedent at sessions.js:762 and config.js:218. Introducing a
//   single atomic-rename file in Phase 16 would create a discipline
//   asymmetry (one safe file, two unsafe siblings) — the kind of half-
//   applied discipline that's worse than no discipline at all. Phase 17
//   is the planned point for a uniform retrofit of all three persisters
//   to a shared `atomicWriteJson` helper.
//
// touchLastSeen() is NOT debounced. At Lance's scale (1 owner, ~3 paired
// devices, ~tens of WS connects/day) this writes devices.json a handful
// of times per day — fine. RESEARCH §10.2 flagged this as a Phase 17
// candidate to batch via the same 30s-interval idiom as
// sessions.startAutoSave().
//
// Per CLAUDE.md §13: NO raw token ever appears in console.log or in
// devices.json on disk. The raw token exists only:
//   (1) once at pair-time in the /pair/redeem HTTP response body, and
//   (2) on the paired browser/phone in localStorage.
// Everywhere else — including this module's persistence — it lives only
// as `sha256:<64-hex>`.

const { readFileSync, writeFileSync, existsSync, unlinkSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');

const DEVICES_PATH = join(DATA_DIR, 'devices.json');
const BOOTSTRAP_PATH = join(DATA_DIR, 'bootstrap.otp');

// Module-scope mutable state — intentional, mirrors the sessions.js /
// config.js precedent (PATTERNS §1 row 10). Tests use a require-cache
// wipe + fresh-require to get a clean closure per test.
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

// Option A pin — plain writeFileSync, no temp+rename. Matches
// sessions.js:762 and config.js:218.
function save() {
  writeFileSync(DEVICES_PATH, JSON.stringify(store, null, 2));
}

// 'sha256:<64-hex>' — the 'sha256:' string-prefix idiom matches
// plugin-loader.js:2,34 and is the schema CONTEXT.md locked.
function hashToken(rawToken) {
  return 'sha256:' + crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Constant-time hash compare. `crypto.timingSafeEqual` throws on mismatched
// buffer length, so we guard length and type BEFORE the call (RESEARCH §2
// R-2 table). Returns boolean — never throws on bad input.
function safeEqualHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// O(n) loop over devices, constant-time per comparison. n ≤ 5 in
// clideck's threat model — well under 1ms even with full hashing.
// Returns the matching device record or null. Null on falsy input.
function findByToken(rawToken) {
  if (!rawToken) return null;
  const h = hashToken(rawToken);
  for (const d of store.devices) {
    if (safeEqualHash(d.token_hash, h)) return d;
  }
  return null;
}

// 32 random bytes → 43-char base64url string. 256 bits of entropy.
// base64url uses only `A-Z a-z 0-9 - _` — all valid RFC 7230 token chars,
// safe to put in `Sec-WebSocket-Protocol` (RESEARCH §1).
function mintToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// 16 random bytes → 22-char base64url → 'dev_' + 22 = 26-char id.
// 128 bits of entropy — collision-resistant well past clideck's scale.
// Intentionally NOT exported per RESEARCH §10.2 exports list — `add()`
// is the only legitimate caller.
function mintDeviceId() {
  return 'dev_' + crypto.randomBytes(16).toString('base64url');
}

function add({ label, uaFingerprint, rawToken }) {
  const now = new Date().toISOString();
  // Label: trim, cap at 32 chars, fall back to 'Device' if empty after
  // sanitisation. D-04 — labels are free-form, no uniqueness check.
  const sanitisedLabel = String(label || 'Device').slice(0, 32).trim() || 'Device';
  const record = {
    id: mintDeviceId(),
    label: sanitisedLabel,
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

// NO DEBOUNCE — see header comment for rationale. At Lance's scale this is
// fine; Phase 17 candidate for batching via a sessions.startAutoSave-style
// interval.
function touchLastSeen(deviceId) {
  const d = store.devices.find(x => x.id === deviceId);
  if (!d) return;
  d.last_seen = new Date().toISOString();
  save();
}

// Defensive copy — callers must not mutate the underlying store via
// list(). The existing `sessions.broadcast(...)` iteration pattern over
// `clients` Set assumes a stable view; mirror that discipline here.
function list() {
  return store.devices.slice();
}

function isEmpty() {
  return store.devices.length === 0;
}

// Bootstrap file is owned by pair-otp.js (Plan 16-03) — only the *minting*
// path writes BOOTSTRAP_PATH. clearBootstrap() lives here because it's
// called on first-successful-redeem from inside the devices.add() flow
// in /pair/redeem (RESEARCH §10.4).
function clearBootstrap() {
  try { unlinkSync(BOOTSTRAP_PATH); } catch {}
}

module.exports = {
  load, save, list, isEmpty,
  findByToken, add, remove, touchLastSeen,
  mintToken, hashToken,
  DEVICES_PATH, BOOTSTRAP_PATH, clearBootstrap,
};
