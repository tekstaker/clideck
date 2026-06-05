---
phase: 16-device-pairing-for-mobile-access
plan: 04
subsystem: auth
tags: [device-pairing, http-routes, otp, dependency-injection, node-http, vitest]

# Dependency graph
requires:
  - phase: 16-02-devices-persistence
    provides: devices.load / .add / .findByToken / .mintToken / .clearBootstrap (consumed by handleRedeemHttp + handleMintOtpHttp)
  - phase: 16-03-pair-otp
    provides: pairOtp.mintOtp / .redeemOtp / .bootstrapIfNeeded (consumed by /pair/redeem + /pair/mint-otp + boot)
provides:
  - routes/pair.js — three pure-function HTTP handlers (handleRedeemHttp / handleMintOtpHttp / servePairHtml) with dependency-injection-friendly signatures, plus the readJson/sendJson/jsonError helper trio
  - server.js boot wiring — devices.load() + pairOtp.bootstrapIfNeeded() between sessions.loadSessions() and rehydrateReplayable
  - server.js HTTP dispatch — POST /pair/redeem + POST /pair/mint-otp above the DEBUG POST catch-all, GET /pair above the static fallthrough
  - public/pair.html placeholder — minimal page with the contract DOM selectors (#otp, #label, #pair-submit, #pair-error) so e2e specs can find them; full UI ships in 16-06
  - X-Clideck-Device-Token HTTP header convention — same lookup as the WS verifyClient gate
affects:
  - 16-05 (WS auth gate) — share devices.findByToken with the new HTTP surface
  - 16-06 (pair UI + dashboard wiring) — will replace the placeholder pair.html with the full form + public/js/pair.js
  - 16-07 (revoke UI) — uses the established X-Clideck-Device-Token header for owner-authenticated mint-otp from Settings

# Tech tracking
tech-stack:
  added: []  # no new dependencies — Phase 16 sticks to node:crypto + node:fs + ws@8.19.0
  patterns:
    - "DI-friendly HTTP handlers: routes/pair.js takes (req, res, { devices, pairOtp }) — the project's FIRST HTTP-handler unit test (PATTERNS §1 row 7) drives the handlers in isolation by passing fresh require-cache-wiped modules"
    - "X-Clideck-Device-Token header gate: same opaque token that rides Sec-WebSocket-Protocol on WS upgrades is reused for HTTP /pair/mint-otp via a custom request header; identical findByToken + timingSafeEqual semantics"
    - "Route splice discipline in server.js: POST /pair/* lives ABOVE the DEBUG POST catch-all at line ~340; GET /pair lives ABOVE the static fallthrough at line ~376 (the catch-all and the fallthrough are positional hazards that bit during Task 2 — see Deviations)"

key-files:
  created:
    - routes/pair.js — three handlers + helpers (218 lines)
    - public/pair.html — minimal placeholder (42 lines)
    - .planning/2026-06-05-device-pairing-for-mobile-access/16-04-SUMMARY.md — this file
  modified:
    - server.js — boot wiring at lines 70-73; POST /pair routes at lines 345-350; GET /pair at lines 372-374
    - tests/pair-redeem.test.js — patched the `expired OTP` test's `vi.useFakeTimers()` call to opt out of faking setImmediate (Rule 1 auto-fix, see Deviations)

key-decisions:
  - "X-Clideck-Device-Token HTTP header pins RESEARCH §10.4 Q-open (how /pair/mint-otp gates). Rationale: same opaque token that the browser already stores in localStorage rides over a different surface; reuses devices.findByToken so revoke takes effect on both surfaces atomically."
  - "POST /pair/redeem returns the raw token in the response body exactly once and NEVER logs it (AC8); devices.add hashes to sha256: before persistence. The route handler has no console.log of the token value, and the Wave-0 spec spies on console.log to enforce."
  - "Routes use `inline require('./routes/pair')` inside the createServer callback, mirroring the session-ask precedent at server.js:247 — keeps the module-scope require list short and matches existing project idiom. devices + pairOtp are captured by closure from the module-scope const declarations in the boot block above."
  - "POST /pair/* dispatchers ABOVE the DEBUG POST catch-all (server.js:340) — the catch-all was discovered during integration smoke to silently 200 '{}' my routes; corrected by moving the routes above. GET /pair stays above the static fallthrough."

patterns-established:
  - "DI for HTTP handlers (deps as 3rd arg): handler(req, res, { devices, pairOtp }) — tests pass fresh module instances per test; production passes module-scope singletons. Same surface, different lifetimes."
  - "Single-surface token leak: the raw 43-char base64url token leaves the server in EXACTLY ONE place — the JSON body of a successful POST /pair/redeem. Never logged, never broadcast, never re-emitted. Tests assert this via console.log spy."
  - "OTP normalisation at two layers: routes/pair.js normalises the incoming `otp` (upper-cased, A-Z 0-9 only) BEFORE handing to pairOtp.redeemOtp; pairOtp also normalises internally as defence-in-depth — either could be the upstream caller in tests."

requirements-completed: [AC1, AC2, AC7, AC8, AC9]

# Metrics
duration: 17min
completed: 2026-06-05
---

# Phase 16 Plan 04: HTTP routes for device pairing — Summary

**Three DI-friendly route handlers (`POST /pair/redeem`, `POST /pair/mint-otp`, `GET /pair`) wired into server.js's createServer dispatch + devices.load()/pairOtp.bootstrapIfNeeded() at boot — tests/pair-redeem.test.js flips RED→GREEN, AC7+AC8+AC9 verified end-to-end with a real boot.**

## Performance

- **Duration:** 17 min 6 s
- **Started:** 2026-06-05T13:23:18Z
- **Completed:** 2026-06-05T13:40:24Z
- **Tasks:** 3 (single atomic commit per the runtime context)
- **Files modified:** 4 (1 created routes/pair.js + 1 created public/pair.html + 1 modified server.js + 1 modified tests/pair-redeem.test.js)

## Accomplishments

- `routes/pair.js` ships with three pure-function handlers + helper trio (readJson/sendJson/jsonError). DI signature `(req, res, { devices, pairOtp })` lets the Wave-0 spec drive each handler in isolation with require-cache-wiped fresh modules — the project's first HTTP-handler unit test (PATTERNS §1 row 7).
- `server.js` boot block now loads paired-device state and mints a recovery OTP when needed — `devices.load()` + `pairOtp.bootstrapIfNeeded()` between `sessions.loadSessions()` and `rehydrateReplayable(...)`. Three new dispatch branches in the http.createServer callback: POST routes above the DEBUG catch-all, GET /pair above the static fallthrough.
- `public/pair.html` placeholder ships with the contract DOM selectors (`#otp`, `#label`, `#pair-submit`, `#pair-error`) so the e2e suite authored in Wave 0 can locate them. 16-06 replaces the placeholder with the real form + `public/js/pair.js`.
- `tests/pair-redeem.test.js` flips RED → GREEN. 10/10 tests green: happy path, expired, used, invalid OTP, invalid-json body, body-cap destroy, label normalisation, two AC8 invariants (no console.log of token; sha256-hash-only-on-disk), bootstrap-clears-otp-file.
- End-to-end smoke against a fresh `CLIDECK_DATA_DIR`: bootstrap banner prints, `bootstrap.otp` written, POST /pair/redeem returns 200 with `{ok:true, device_id:dev_…, token:<43-char base64url>, label}`, `devices.json` persists `sha256:<64-hex>` (raw token grep on disk returns empty — AC8 PASS), bootstrap file deleted (AC7 PASS), /pair/mint-otp returns 401 without header and with bad token, returns 200+otp+expires_at with valid token.

## Task Commits

This plan landed as a single atomic commit per the runtime context (`REQUIRED ORDER: Write SUMMARY.md → commit → only then narration`):

1. **Task 1: routes/pair.js (handlers + helpers)** — bundled into the wave-1 commit below
2. **Task 2: server.js splices (boot + dispatchers)** — bundled into the wave-1 commit below
3. **Task 3: public/pair.html placeholder** — bundled into the wave-1 commit below

Both commits will be created after this summary is written.

## Files Created / Modified

- `routes/pair.js` — three handlers: `handleRedeemHttp` (DI deps, 4096-byte body cap, OTP normalisation, distinct status codes per error type, raw-token-in-body-only), `handleMintOtpHttp` (X-Clideck-Device-Token gated), `servePairHtml` (reads public/pair.html with defensive 503 fallback). Plus exported `readJson`/`sendJson`/`jsonError` for reuse.
- `server.js` — two splices:
  - **Splice A — boot wiring (lines 61-73 region after `sessions.loadSessions()` at line 60):** `const devices = require('./devices'); const pairOtp = require('./pair-otp'); devices.load(); pairOtp.bootstrapIfNeeded();` Comment block explains the placement discipline.
  - **Splice B — HTTP route dispatch:** POST /pair/redeem + POST /pair/mint-otp inserted ABOVE the DEBUG POST catch-all (lines 345-350, catch-all is now line 353). GET /pair inserted ABOVE the static fallthrough (lines 372-374, fallthrough now line 376).
- `public/pair.html` — 42-line placeholder with `<input id="otp">`, `<input id="label">`, `<button id="pair-submit">`, `<div id="pair-error" hidden>`, minimal embedded styling so the page is legible even before 16-06 ships the full design. Marked with `<!-- PHASE 16-04 PLACEHOLDER -->`.
- `tests/pair-redeem.test.js` — patched ONE line (the `expired OTP` test's `vi.useFakeTimers()` call) to opt out of faking setImmediate — see Deviations.

## Decisions Made

1. **`X-Clideck-Device-Token` HTTP header for `/pair/mint-otp` auth (RESEARCH §10.4 Q-open, planner pinned).** Same opaque token the browser stores in localStorage at pair-time; same `devices.findByToken` lookup as the WS verifyClient gate. Revoke a device → both surfaces start rejecting on the next call.
2. **POST /pair/* MUST sit above the DEBUG POST catch-all.** The plan said "above the static fallthrough" — which is correct for GET but not enough for POST. The DEBUG POST catch-all at server.js:340 returns `200 '{}'` for any unmatched POST, so the POST routes have to sit above that line too. Discovered during integration smoke (see Deviations).
3. **Inline `require('./routes/pair')` inside the createServer callback** rather than a top-of-file require. Matches the `session-ask` precedent at server.js:247 — keeps the module-scope require list short and the splice diff minimal.
4. **Helpers (readJson/sendJson/jsonError) exported alongside the handlers.** Trivial cost, and 16-05 / 16-07 may want to reuse the same helper trio for the device.list/device.revoke broadcasts and the Settings panel's mint-otp call.
5. **OTP normalised at BOTH the route layer AND inside pair-otp.redeemOtp.** Defence-in-depth — either could be the upstream caller in tests. Cost is one regex per redeem; benefit is the contract holds regardless of where the OTP enters the system.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Wave-0 test deadlocked under vitest@4 default `useFakeTimers()`**
- **Found during:** Task 1 (routes/pair.js)
- **Issue:** `tests/pair-redeem.test.js` line 130 calls `vi.useFakeTimers()` to advance time past the OTP's 5-min TTL. In vitest@4, the default `toFake` set includes `setImmediate`. The test's helper `postJson(...)` does `await new Promise(r => setImmediate(r))` after emitting `req.emit('end')` — with `setImmediate` faked, that promise never resolves and the test times out at 5s. Confirmed via a one-off diagnostic spec (vitest's safe-timers module documents the full faked set).
- **Fix:** Patched the single offending line to opt-in to only the timer surfaces the test actually needs: `vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })`. The OTP expiry path uses `Date.now()` only — that's the only fake we genuinely need. `setImmediate` stays real so the response-handoff await resolves.
- **Files modified:** `tests/pair-redeem.test.js` (1 line)
- **Verification:** All 10 tests in `pair-redeem.test.js` GREEN (`npx vitest run tests/pair-redeem.test.js` exits 0).
- **Committed in:** wave-1 code commit (see commit list).

**2. [Rule 1 — Bug] Routes were initially placed below the DEBUG POST catch-all at server.js:340**
- **Found during:** Task 2 integration smoke
- **Issue:** The plan said "place ABOVE the static-file fallthrough at line 342" (which is correct for GET). I followed that guidance literally and placed all three dispatchers (GET /pair, POST /pair/redeem, POST /pair/mint-otp) immediately above the static fallthrough — but that put them BELOW the DEBUG POST catch-all (`if (req.method === 'POST') { return res.writeHead(200).end('{}'); }`) which silently swallowed both POST routes. Integration smoke showed `{}` 200 responses to /pair/redeem and /pair/mint-otp instead of my handlers' responses.
- **Fix:** Split the placement: the two POST routes moved ABOVE the DEBUG POST catch-all (server.js:345-350). GET /pair stays above the static fallthrough (server.js:372-374). The DEBUG POST catch-all now lives between them at line 353 — still catching unmatched POSTs as intended (OTLP, etc.).
- **Files modified:** `server.js` (added 3 lines for POST routes; removed 2 stale duplicate lines; added explanatory comment about the catch-all hazard).
- **Verification:** Full smoke run (see below) — POST /pair/redeem now returns `{ok:true, device_id:dev_…, token:<43-char base64url>, label}` (200); POST /pair/mint-otp returns 401 without header, 200+otp+expires_at with valid token. GET /pair still serves the placeholder HTML (200).
- **Committed in:** wave-1 code commit (see commit list).

---

**Total deviations:** 2 auto-fixed (both Rule 1 — Bug).
**Impact on plan:** Both were correctness fixes blocking the AC2/AC7/AC9 contract from holding end-to-end. No scope creep, no architectural change. The test patch is one-line and well-commented; the route reorder is a positional adjustment that the plan should have flagged (PLAN noted the static fallthrough but missed the DEBUG POST catch-all at server.js:340 which was introduced in some earlier phase — line numbers are right where the plan said but the catch-all was an unmentioned hazard).

## Issues Encountered

- **Server-boot slow path under non-TTY stdin:** During the first integration smoke I waited 2-3 seconds after `node server.js &` and concluded the server hung — boot logs ended at `[plugin] seeded voice-input` with no Ready banner. Closer trace showed boot actually completes around the 5.5-6 second mark (something in the plugin/transcript/telemetry init chain takes that long even with an empty DATA_DIR). Adjusted smoke-test sleep to 8 seconds and boot completes cleanly. Not a Phase-16 regression — the slow path exists on the baseline too. No action taken; flagged here for future smoke-test authors.
- **Pre-existing test flakiness in `tests/check-cwd-handler.test.js` + `tests/mkdir-cwd-handler.test.js`:** These two specs timeout intermittently (`Test timed out in 5000ms`). Confirmed via `git stash` baseline check — failures are present on `feat/device-pairing-for-mobile-access` HEAD without my changes (baseline shows 12 failures across the two files in a 45s run; with my changes the parallel run shows 10 failures). Out-of-scope per the scope boundary; not caused by Phase 16 work.

### Pre-existing failures (not caused by this plan)

| File | Failures | Baseline match | Reason |
|------|----------|----------------|--------|
| `tests/check-cwd-handler.test.js` | 2-6 (varies) | Yes | Test-environment flakiness — `Test timed out in 5000ms` on multiple `it()` blocks |
| `tests/mkdir-cwd-handler.test.js` | 2-4 (varies) | Yes | Same as above |
| `tests/ws-auth-gate.test.js` | 10 | n/a — Wave 0 RED | Requires `auth-gate.js` which ships in plan 16-05 |
| `tests/revoke-closes-socket.test.js` | 7 | n/a — Wave 0 RED | Requires `sessions.closeDevice()` which ships in plan 16-05 |

## Verification — captured output

### Wave-0 contract spec (the test this plan flips)

```
$ npx vitest run tests/pair-redeem.test.js --reporter=verbose
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > happy path: valid OTP → 200 JSON { ok, device_id, token, label }; devices.list().length === 1
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > expired OTP → 410 JSON { ok: false, error: "expired" }
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > used OTP (second redeem) → 400 JSON { ok: false, error: "used" }
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > unknown OTP → 400 JSON { ok: false, error: "invalid" }
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > malformed JSON body → 400 JSON { ok: false, error: "invalid-json" }
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > body cap: > 4KB body destroys the request (no response, request emits close)
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > label normalisation: empty label → "Device"; 60-char label → trimmed to 32 chars
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > AC8: handler never writes the raw token to console.log between request and response
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > AC8: raw token is in the response body exactly once; devices.list()[0].token_hash is sha256:* and does NOT contain raw
 ✓ POST /pair/redeem — handler contract (AC2, AC8, AC9) > bootstrap OTP redeem deletes the .clideck/bootstrap.otp file

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### Phase 16 cumulative spec run (no regressions across waves)

```
$ npx vitest run tests/pair-redeem.test.js tests/devices-json.test.js tests/pair-otp.test.js tests/bootstrap-otp.test.js tests/device-revoke-rebuild.test.js
 Test Files  5 passed (5)
      Tests  38 passed (38)
```

(pair-redeem 10 + devices-json 9 + pair-otp 7 + bootstrap-otp 7 + device-revoke-rebuild 5 = 38)

### Integration smoke (boot → bootstrap → pair → AC8 + AC7 + mint-otp gate)

Run with `CLIDECK_DATA_DIR=$(mktemp -d) CLIDECK_PORT=4099 node server.js &` (8s boot wait). All values that derive from secrets are reported by shape, not by value, per CLAUDE.md §13.

```
=== boot log (relevant lines) ===
[clideck] bootstrap pair code: <6-char ABC-DEF format>          # CLAUDE.md §13 deliberate exception per D-02
[clideck] booted v1.31.17 pid=... bootId=... on 127.0.0.1:4099

=== bootstrap.otp written? ===
-rw-r--r-- 1 clideck clideck 7 ... bootstrap.otp                # 7 bytes = 6 OTP chars + \n

=== GET /pair ===
http=200 bytes=2259                                              # placeholder pair.html

=== POST /pair/redeem ===
ok=true device_id=dev_<22-char base64url> label=smoke-test token-shape=<43-char base64url>

=== devices.json (post-redeem) ===
version=1 devices=1 first.token_hash=<sha256 hash>
first.label=smoke-test
first.fingerprint present=true

=== AC8: raw token NOT in devices.json ===
PASS: token not in devices.json

=== AC7: bootstrap.otp cleared after first redeem ===
PASS: bootstrap.otp cleared

=== /pair/mint-otp WITHOUT header (expect 401) ===
http=401
{"ok":false,"error":"unauthorized"}

=== /pair/mint-otp with VALID token (expect 200) ===
ok=true otp-shape=<6-char> expires_at_present=true

=== /pair/mint-otp with BAD token (expect 401) ===
http=401
{"ok":false,"error":"unauthorized"}
```

### Other Wave-0 specs (still RED — expected — owned by future plans)

- `tests/ws-auth-gate.test.js` — RED, requires `auth-gate.js` (16-05 deliverable)
- `tests/revoke-closes-socket.test.js` — RED, requires `sessions.closeDevice()` (16-05 deliverable)
- `e2e/pair-flow.spec.js` — RED, requires the full pair UI (16-06 deliverable)
- `e2e/revoke-flow.spec.js` — RED, requires the Settings panel UI (16-07 deliverable)

## Phase 15 merge-order note (for the eventual integration)

Per PATTERNS §3, this plan's splices target server.js boot (line ~60) and the createServer callback (line ~340 + ~370). Neither overlaps with the Phase 15 splices in handlers.js (lines 267, 755) or sessions.js. The merge of Phase 15 will shift server.js's overall line count slightly but the splice anchors (`sessions.loadSessions()` and the DEBUG POST catch-all and `ALIASES[req.url]`) all remain grep-recognisable. Re-grep before any post-merge replay; the line numbers in this SUMMARY's "Files Created / Modified" section are valid only at HEAD `8b56324` + this plan's diff.

## Next Plan Readiness

- **16-05 (WS auth gate + revoke-closes-socket):** Ready to start. `devices.findByToken` is exported and used by routes/pair.js; 16-05 will wire the same call into a new `verifyClient` form per RESEARCH §10.1. `sessions.closeDevice()` is the new export the revoke flow needs; PATTERNS §2.3 has the template.
- **16-06 (pair UI + dashboard wiring):** Ready to start. The placeholder public/pair.html exists at the URL the e2e spec targets; 16-06 will replace it with the real form + add `public/js/pair.js` that POSTs to `/pair/redeem` and stores the returned token in localStorage.
- **No blockers.**

---
*Phase: 16-device-pairing-for-mobile-access*
*Plan: 04*
*Completed: 2026-06-05*
