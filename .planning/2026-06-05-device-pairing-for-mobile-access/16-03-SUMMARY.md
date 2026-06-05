---
phase: 16-device-pairing-for-mobile-access
plan: 03
type: execute
wave: 1
state: complete
date: 2026-06-05
duration_seconds: 240
duration_pretty: ~4min
requirements_addressed: [AC2 (partial — OTP mint/redeem half), AC7 (full — owner bootstrap path machinery), AC9 (full — OTP single-use + TTL + distinct error codes), D-02 (full — bootstrap-OTP-to-stdout + .clideck/bootstrap.otp recovery file), D-04 / Q-1 (full — 31-char unambiguous alphabet locked)]
files_created:
  - pair-otp.js
files_modified: []
commits:
  - 39ab9cf: "feat(pair-otp): 6-char unambiguous-alphabet OTPs with 5-min TTL + single-use + bootstrap auto-mint (Phase 16 D-02, AC7 / AC9)"
metrics:
  baseline_tests_before: "44 failed | 171 passed (215)"
  baseline_tests_after:  "25 failed | 190 passed (215)"
  delta_tests_flipped_green: 19
  delta_tests_regressed: 0
  red_files_before: 6
  red_files_after: 3
  red_files_remaining: [pair-redeem, ws-auth-gate, revoke-closes-socket]
  bonus_unblocked: "tests/device-revoke-rebuild.test.js (5 tests) — already passing once pair-otp landed"
key_decisions:
  - "Alphabet locked to the 31-char `ABCDEFGHJKMNPQRSTUVWXYZ23456789` per RESEARCH Q-1; SPEC's 'no 0/O/1/I/l' phrasing yields 31 by my count (the lowercase l is moot because the canonical form is uppercase-only)"
  - "Two-tier TTL caps: 900s (15min) for user-minted, 86400s (24h) for bootstrap — defensive against caller bugs minting a never-expiring OTP"
  - "setInterval sweep uses a 1-HOUR grace window past expiry rather than deleting immediately, so fake-timer-driven tests (and slow human users) always see 'expired' rather than racing to 'invalid'"
  - "setInterval.unref() on the sweep is REQUIRED (not optional) — without it vitest hangs after the suite finishes because the interval keeps the event loop alive"
  - "Second-redeem returns 'used' not 'invalid' — we mark `used:true` on success but do NOT delete, so the spec's distinct-error-code contract holds; the sweep GCs used+expired entries inside the grace window"
  - "Bootstrap-OTP-to-stdout is the deliberate, bounded CLAUDE.md §13 exception — single-use, 24h TTL, visible only to whoever has shell access (= Lance); the only viable bootstrap from a fresh install"
---

# Phase 16 Plan 03: Wave 1 — `pair-otp.js` OTP layer + bootstrap (GREEN)

`pair-otp.js` shipped. Pure in-memory module: 6-char OTPs from the 31-char
unambiguous alphabet, single-use, TTL-bounded, with the owner-bootstrap
auto-mint that turns a fresh install (empty `devices.json`) into a
recoverable system via a stdout banner + `.clideck/bootstrap.otp` file.
No HTTP, no WebSocket, no edits to any other production file — the
`/pair/redeem` HTTP route lands in 16-04, the WS auth gate in 16-05.

**Both Wave 0 contracts flipped RED → GREEN:**

- `tests/pair-otp.test.js` — 7 / 7 it-blocks pass
- `tests/bootstrap-otp.test.js` — 7 / 7 it-blocks pass

**Bonus: `tests/device-revoke-rebuild.test.js` (5 tests) also flipped GREEN**
once `pair-otp.js` landed — that file was previously RED on
`require('../pair-otp.js')` even though its assertions are about the
`devices` module. Spec list narrowed from 6 RED files to 3.

**Zero regression in the 171 pre-existing GREEN tests.**

---

## The 31-char alphabet pin (RESEARCH Q-1)

```
OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'  // 31 chars
```

SPEC originally said "no `0/O/1/I/l`" — that excludes 5 visually
ambiguous characters from the alphanumeric 36, leaving 31. The lowercase
`l` in the SPEC's exclusion list is moot here because the canonical OTP
form is **uppercase-only** (and `redeemOtp` toUpperCases the input
before lookup). Lowercase letters never enter the alphabet.

Keyspace = 31^6 ≈ 887M. RESEARCH §8 P-1 modelled the brute-force
probability at a sustained 10 req/sec rate against a single live
5-min-TTL window — works out to ~3.4×10⁻⁶, well under any reasonable
threshold for a VPN-fronted owner-only surface. With single-use bound
on top, an attacker has one shot per OTP, not a sustained guess loop.

The Wave-0 spec at `tests/pair-otp.test.js:77` pins the literal alphabet
in a regex:

```js
expect(otp).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
```

So **changing the alphabet is a coordinated edit** with the test, never
unilateral.

## CLAUDE.md §13 deliberate exception — the bootstrap banner

`bootstrapIfNeeded()` prints the bootstrap OTP to stdout in a coloured
3-line banner. CLAUDE.md §13 normally forbids logging secrets, including
ones found in files the operator already has. Phase 16 declares this the
**one intentional, bounded exception** in the phase — and it's flagged in
both `CONTEXT.md` D-02 and the inline comment in `pair-otp.js`
immediately above the `console.log`.

Why the exception:

1. **Chicken-and-egg.** The system is "fresh install, no paired
   device, no UI access". The only way for the owner to authenticate is
   via a value the owner can read from somewhere they already have
   access to. The two places that fit are stdout (visible over SSH) and
   the data directory (writable by the server). We write to both.
2. **Bounds are tight.** Single-use (Map.entry.used flag), 24h TTL,
   24-byte payload, visible only to whoever has shell on the server.
   For clideck that's Lance; for any other operator it's whoever they
   gave shell to — i.e. someone who already has full system access.
3. **The alternative is worse.** "Require a paired device to mint the
   first OTP" creates an unbootstrappable system.

Banner format (matches RESEARCH §10.3):

```
  [clideck] bootstrap pair code: ABC-DEF
  Paste into /pair on the first device.
  Also written to /home/clideck/.clideck/bootstrap.otp
```

With ANSI 256-colour codes (`\x1b[38;5;105m` for the code line, `245`
for the secondary lines) so the recovery path is visually distinct from
normal startup chatter.

## `setInterval.unref()` — required, not optional

The 60-second sweep `setInterval(...)` is opportunistic GC for expired
entries. The actual correctness path is `redeemOtp` itself, which checks
`Date.now() > entry.expiresAt` on every call; the sweep just keeps the
Map from growing unbounded.

`.unref()` is **load-bearing**: a `setInterval` without `unref` keeps
the Node event loop alive even after the user-facing process work is
done. Without `.unref()` the vitest process hangs after the suite
finishes because the interval is still pending. The plan called this out
explicitly, RESEARCH §10.3 called it out, and the smoke check in the
plan's verification section is exactly:

```bash
$ timeout 5 node -e "require('./pair-otp'); console.log('exited cleanly');"
exited cleanly
```

Returns in <0.1s. If this hangs (i.e. you forget the `.unref()`), the
`timeout 5` will kill it and exit non-zero. Verified GREEN.

Grep confirms:

```bash
$ grep -n '.unref()' pair-otp.js
135:}, 60 * 1000).unref();
```

## The 1-hour sweep grace window (an undocumented-in-spec subtlety)

The RESEARCH §10.3 canonical sketch deletes expired entries the moment
the sweep observes them. That fails the `redeemOtp(<expired>) →
{ ok:false, error:'expired' }` spec when fake timers are in play:

`vi.advanceTimersByTime(6 * 60 * 1000)` advances 6 minutes through the
fake clock, which fires the 60s sweep **6 times in a row** before
control returns to the test. Each sweep iteration deletes the expired
entry. By the time `redeemOtp` runs, the entry is gone → `'invalid'`,
not `'expired'`. The spec asserts `'expired'`.

Fix: only sweep entries that are **>1 hour past expiry** (`SWEEP_GRACE_MS
= 60 * 60 * 1000`). The redeem path always finds the entry inside that
window and reports `'expired'` correctly. The Map still grows bounded:
worst-case sustained-mint rate is a few OTPs per day, an extra hour of
retention adds at most a few entries. Bootstrap OTPs (24h TTL) hang
around for 25h total before sweep — negligible.

The grace also makes the post-mortem experience friendlier for slow
human users: "I typed it 30 seconds after it expired and got `'expired'`
not `'invalid'`" is a strictly better error message.

## TTL caps — defensive against caller bugs

```js
const cap = isBootstrap ? 86400 : 900;
const effectiveTtl = Math.min(ttlSeconds, cap);
```

- **User-minted** (default 300s = 5min, hard cap 900s = 15min). The
  default matches AC9's "5-min TTL"; the cap protects against a future
  caller accidentally passing `300_000` (milliseconds, not seconds)
  and minting a 3-day OTP.
- **Bootstrap** (default 86400s = 24h, hard cap 86400s = 24h). Long
  enough for Lance to start the server over SSH, read the banner, walk
  to his phone, and pair the device. Not so long that a stale bootstrap
  OTP becomes a permanent credential lying around on disk and stdout
  history.

Bootstrap callers must explicitly pass `isBootstrap: true` to opt into
the longer ceiling — there's no way for a normal caller to accidentally
get the 24h cap.

## Second-redeem semantics — `'used'` not `'invalid'`

On a successful redeem we set `entry.used = true` but do **not** delete
the entry. A second call therefore sees `entry.used === true` and
returns `{ ok: false, error: 'used' }`. The Wave-0 spec at
`tests/pair-otp.test.js:98` pins this specifically:

```js
expect(second.error).toBe('used');
```

The alternative ("delete on success, second call returns 'invalid'")
would degrade the caller's debugging signal: there'd be no way to
distinguish "you used it already" from "no such OTP". Memory bounding
falls back on the sweep, which removes used+expired entries inside the
1-hour grace window — `(TTL + grace)` not `(time-until-second-redeem)`.

## Normalisation — case-insensitive + hyphen-tolerant

`redeemOtp` runs the input through:

```js
String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
```

This handles:

- Lowercase paste (`'abc123'` → `'ABC123'`)
- Hyphenated form from the banner (`'ABC-DEF'` → `'ABCDEF'`)
- Surrounding whitespace, accidental punctuation
- Empty / null / non-string input (returns `''` → caller sees `'invalid'`)

This mirrors the upcoming `/pair/redeem` HTTP body normalisation in
16-04 (RESEARCH §10.4) so users can paste either form from the bootstrap
banner.

---

## Module surface delivered

```js
module.exports = { mintOtp, redeemOtp, bootstrapIfNeeded, OTP_ALPHABET };
```

`generateOtp` and `normaliseOtp` are intentionally not exported — they
are internal implementation helpers and the spec only contracts the
public 4.

### Shape checks (every acceptance_criteria from the plan)

| Check | Command | Output |
|---|---|---|
| File exists | `test -f pair-otp.js` | exit 0 |
| Alphabet exported | `node -e "console.log(require('./pair-otp').OTP_ALPHABET)"` | `ABCDEFGHJKMNPQRSTUVWXYZ23456789` |
| Alphabet length | `node -e "console.log(require('./pair-otp').OTP_ALPHABET.length)"` | `31` |
| mintOtp shape | `node -e "const r = require('./pair-otp').mintOtp(); console.log(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(r.otp), typeof r.expiresAt)"` | `true string` |
| redeemOtp single-use | `node -e "const o = require('./pair-otp'); const {otp} = o.mintOtp(); console.log(o.redeemOtp(otp).ok, o.redeemOtp(otp).ok, o.redeemOtp(otp).error)"` | `true false used` |
| `.unref()` present | `grep -F '.unref()' pair-otp.js` | 1 match |
| Smoke-no-hang | `timeout 5 node -e "require('./pair-otp'); console.log('exited cleanly');"` | `exited cleanly` (<0.1s) |
| Syntax | `node --check pair-otp.js` | exit 0 |
| Wave 0 specs | `npx vitest run tests/pair-otp.test.js tests/bootstrap-otp.test.js` | 14 passed / 14 |

---

## Test deltas

### Targeted GREEN — the contracts this plan satisfies

```
$ npx vitest run tests/pair-otp.test.js tests/bootstrap-otp.test.js --reporter=verbose
 Test Files  2 passed (2)
      Tests  14 passed (14)
   Duration  286ms
```

All 14 it-blocks now pass — pair-otp.test.js contract (7) + bootstrap-otp.test.js contract (7):

**`tests/pair-otp.test.js` (AC9):**

1. `mintOtp() returns { otp, expiresAt } with a 6-char string and ISO timestamp`
2. `generated OTP only uses chars from the 31-char unambiguous alphabet (Q-1 / D-04)`
3. `redeemOtp(otp) returns { ok: true, isBootstrap: false } on first call for a user-minted OTP`
4. `redeemOtp(otp) returns { ok: false, error: "used" } on second call with the same OTP (single-use)`
5. `redeemOtp(<unknown OTP>) returns { ok: false, error: "invalid" }`
6. `redeemOtp(<expired OTP>) returns { ok: false, error: "expired" } after TTL passes`
7. `redeemOtp is case-insensitive — accepts lowercase form`

**`tests/bootstrap-otp.test.js` (AC7, D-02):**

1. `on empty devices.json: writes 6-char OTP to ${DATA_DIR}/bootstrap.otp and logs the bootstrap pair code banner to stdout`
2. `when devices has ≥1 device: no file written, no banner logged`
3. `the OTP in bootstrap.otp matches the OTP visible in the captured console.log banner (same value)`
4. `bootstrap.otp file content is the 6-char OTP + trailing newline (no extra whitespace)`
5. `after redeeming the bootstrap OTP + clearBootstrap(), existsSync(BOOTSTRAP_PATH) is false`
6. `bootstrap OTP has a long TTL (24h per RESEARCH §10.3): still redeemable after 6h fake-time advance`
7. `bootstrap OTP redeems with isBootstrap: true (distinguishable from a user-minted OTP)`

### Full suite regression check

```
$ npx vitest run
 Test Files  3 failed | 24 passed (27)
      Tests  25 failed | 190 passed (215)
   Duration  20.97s
```

Compare to the 16-02-SUMMARY.md baseline:

```
                     Test Files  Tests
After 16-02:         6 failed   44 failed | 171 passed
After this plan:     3 failed   25 failed | 190 passed
Delta:               -3 files   -19 failed +19 passed
```

Wait — the planned delta was 14 (pair-otp 7 + bootstrap-otp 7). Actual
delta is **19 tests / 3 files** because `tests/device-revoke-rebuild.test.js`
(5 tests) was previously RED solely on its `require('../pair-otp.js')`
line — its assertions all run against the already-shipped `devices.js`
module. Once `pair-otp.js` existed, those 5 tests went GREEN with no
additional code from this plan. **Bonus unblock.**

### Tests that stay RED by design (and which plan turns each one green)

| File | Tests still RED | Why still RED | Closes in |
|---|---|---|---|
| `tests/pair-redeem.test.js` | 10 | `../routes/pair.js` does not exist (OTP dependency now satisfied) | 16-04 |
| `tests/ws-auth-gate.test.js` | 8 | `../auth-gate.js` does not exist | 16-05 |
| `tests/revoke-closes-socket.test.js` | 7 | `sessions.closeDevice` is not a function | 16-05 |

3 RED files / 25 RED tests remain after this plan, all owed by 16-04
(HTTP route) and 16-05 (WS auth gate + revoke iterator). The e2e specs
remain RED until 16-06 wires the client and 16-07 ships the Settings
panel.

---

## Files touched

- `pair-otp.js` (new, 169 lines including the header comment block) — the
  OTP module.

**Nothing else touched.** No `devices.js`, no `server.js`, no
`handlers.js`, no `sessions.js`, no client code, no test files, no
config. This plan is the OTP module in isolation per the wave 1
boundary — same discipline as 16-02.

## Out-of-scope discoveries

**None.** The plan called for a near-verbatim reproduction of RESEARCH
§10.3 with the alphabet exported and the bootstrap TTL distinction
locked, and that's what shipped. The only deviation from the literal
RESEARCH §10.3 sketch is the **1-hour sweep grace window** — and that
was forced by an interaction between `vi.useFakeTimers()` and the spec
contract for `'expired'` vs `'invalid'` errors, documented above and in
the module's header comment. No new modules, no new dependencies, no
schema changes.

## Deferred follow-ups

**None for Phase 17.** This module is small (169 lines) and the surface
is locked by the Wave-0 spec. The sweep grace window is the only piece
of "extra" code; if a future operator wants tighter memory bounds they
can shrink `SWEEP_GRACE_MS`, but at clideck's expected mint rate
(<10/day) the current 1h grace adds bounded overhead.

The one open thread is **rate-limiting `/pair/mint-otp`** (i.e. a future
caller bug + an attacker spamming the mint endpoint = unbounded Map
growth inside the grace window). That's an HTTP-route concern, not an
OTP-module concern — landed in 16-04's purview.

## Self-Check

```
$ test -f /home/clideck/projects/clideck/pair-otp.js && echo FOUND || echo MISSING
FOUND
$ git log --oneline -1 39ab9cf
39ab9cf feat(pair-otp): 6-char unambiguous-alphabet OTPs with 5-min TTL + single-use + bootstrap auto-mint (Phase 16 D-02, AC7 / AC9)
$ npx vitest run tests/pair-otp.test.js tests/bootstrap-otp.test.js tests/devices-json.test.js 2>&1 | tail -3
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

Self-Check: PASSED.
