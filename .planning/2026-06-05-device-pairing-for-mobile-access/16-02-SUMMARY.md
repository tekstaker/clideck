---
phase: 16-device-pairing-for-mobile-access
plan: 02
type: execute
wave: 1
state: complete
date: 2026-06-05
duration_seconds: 180
duration_pretty: ~3min
requirements_addressed: [AC2 (partial — persistence half), AC4 (partial — provides findByToken for the gate), AC5 (partial — provides remove for the revoke handler), AC6 (partial — per-token semantics), AC8 (full — raw token never reaches disk)]
files_created:
  - devices.js
files_modified: []
commits:
  - 527ecdd: "feat(devices): persist linked devices in .clideck/devices.json with sha256 token-hash + timing-safe lookup (Phase 16 D-02, AC2 / AC8 partial)"
metrics:
  baseline_tests_before: "53 failed | 162 passed (215)"
  baseline_tests_after:  "44 failed | 171 passed (215)"
  delta_tests_flipped_green: 9
  delta_tests_regressed: 0
  red_files_before: 7
  red_files_after: 6
  red_files_remaining: [pair-otp, pair-redeem, bootstrap-otp, ws-auth-gate, revoke-closes-socket, device-revoke-rebuild]
key_decisions:
  - "Option A persistence pin (plain writeFileSync, no atomic-rename) — locked by PATTERNS §2.2 + RESEARCH §3 / Q-2; deferred Phase 17 retrofit of all three persisters together"
  - "touchLastSeen is NOT debounced — accepted at Lance's 1-user / ~3-device scale; Phase 17 candidate for batching via sessions.startAutoSave-style 30s interval"
  - "mintDeviceId is internal — NOT exported, only add() may call it (per RESEARCH §10.2 exports list)"
---

# Phase 16 Plan 02: Wave 1 — `devices.js` persistence layer (GREEN)

`devices.js` shipped. Pure data + crypto module: load/save the JSON store
at `${DATA_DIR}/devices.json`, mint opaque 256-bit tokens + 128-bit
device IDs, hash tokens BEFORE persistence (AC8 invariant), and look up
devices by raw token via `crypto.timingSafeEqual` on the hash. No HTTP,
no WebSocket, no edits to any other production file — the gate, the
route, and the revoke iterator land in 16-04 / 16-05.

**The Wave 0 contract `tests/devices-json.test.js` flipped RED → GREEN
(9 of 9 it-blocks).** Zero regression in the 162 pre-existing tests.

---

## Option A persistence pin — plain `writeFileSync`

PATTERNS §2.2 + RESEARCH §3 / Q-2 pinned this plan to **Option A**:
plain `writeFileSync(DEVICES_PATH, JSON.stringify(store, null, 2))`, no
temp+rename. Two-line rationale:

1. **Matches project precedent.** `sessions.js:762` and `config.js:218`
   both write JSON directly with no atomic-rename. Introducing a single
   atomic-rename file in Phase 16 would create a discipline asymmetry
   across the three persisters (devices.json safe, sessions.json +
   config.json not) — the "half-applied discipline" footgun called out
   in PATTERNS §2.2.
2. **The SPEC's atomic-rename ask is still legitimate.** It's deferred,
   not denied. The Phase 17 follow-up is to retrofit all three
   persisters in one go via a shared `atomicWriteJson(path, data)`
   helper in `utils.js`, so the project moves from "0 atomic / 3 plain"
   to "3 atomic / 0 plain" in a single coherent diff.

Verified by `grep -F '.tmp' devices.js` — no temp-file pattern in the
module. The Wave 0 spec at `tests/devices-json.test.js:160-171` even
asserts this discipline ("on-disk file uses plain writeFileSync — no
devices.json.tmp* exists alongside").

## `touchLastSeen` has NO debouncer — accepted v1, Phase 17 candidate

Every WebSocket reconnect on a paired device will (per the Wave 2
wiring in `handlers.js`) trigger `devices.touchLastSeen(deviceId)`,
which writes `devices.json` synchronously. RESEARCH §10.2 flagged that
across a noisy day this could become hundreds of writes.

At Lance's scale (1 owner, ~3 paired phones/laptops, ~tens of WS
connects per day) this works out to a handful of writes per day — well
inside the project's existing I/O budget. The Phase 17 candidate is to
batch writes via a 30s-interval autosave modelled directly on
`sessions.startAutoSave()`, with a final flush on shutdown.

---

## Module surface delivered (matches RESEARCH §10.2 + Wave 0 contract)

```js
module.exports = {
  load, save, list, isEmpty,
  findByToken, add, remove, touchLastSeen,
  mintToken, hashToken,
  DEVICES_PATH, BOOTSTRAP_PATH, clearBootstrap,
};
```

`mintDeviceId` is intentionally **not exported** — `add()` is the only
legitimate caller. Verified:

```
$ node -e "console.log(typeof require('./devices').mintDeviceId)"
undefined
```

### Shape checks (every acceptance_criteria from the plan)

| Check | Command | Output |
|---|---|---|
| File exists | `test -f devices.js` | exit 0 |
| Exports shape | `node -e "const d = require('./devices'); console.log(Object.keys(d).sort().join(','))"` | `BOOTSTRAP_PATH,DEVICES_PATH,add,clearBootstrap,findByToken,hashToken,isEmpty,list,load,mintToken,remove,save,touchLastSeen` |
| hashToken format | `node -e "console.log(require('./devices').hashToken('x'))"` | `sha256:2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881` (71 chars, sha256 + 64 hex) |
| mintToken length | `node -e "console.log(require('./devices').mintToken().length)"` | `43` |
| mintDeviceId internal | `node -e "console.log(typeof require('./devices').mintDeviceId)"` | `undefined` |
| Option A pin | `grep -F '.tmp' devices.js` | (no matches) |
| Constant-time compare | `grep -F 'timingSafeEqual' devices.js` | 2 matches (comment + actual call) |
| Syntax | `node --check devices.js` | exit 0 |

## AC8 round-trip smoke (per plan verification block)

CLAUDE.md §1 — verify, don't claim. Ran the round-trip smoke from
`16-02-PLAN.md` verbatim:

```bash
$ node -e "
    process.env.CLIDECK_DATA_DIR = require('os').tmpdir() + '/clideck-smoke-' + Date.now();
    require('fs').mkdirSync(process.env.CLIDECK_DATA_DIR, { recursive: true });
    const d = require('./devices');
    d.load();
    const rec = d.add({ label: 'Smoke', uaFingerprint: 'ua-x', rawToken: 'smoke-token-DO-NOT-LEAK' });
    const content = require('fs').readFileSync(d.DEVICES_PATH, 'utf8');
    console.log('content includes raw token?', content.includes('smoke-token-DO-NOT-LEAK'));
    console.log('content includes sha256:?',    content.includes('sha256:'));
    console.log('deviceId starts dev_?',         rec.id.startsWith('dev_'));
  "
content includes raw token? false
content includes sha256:? true
deviceId starts dev_? true
```

`false / true / true` — AC8 invariant holds: the raw token is never
written to disk; only the `sha256:<64-hex>` hash + `dev_*`-prefixed id
are persisted.

---

## Test deltas

### Targeted GREEN — the contract this plan satisfies

```
$ npx vitest run tests/devices-json.test.js
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  475ms
```

All nine Wave 0 it-blocks now pass:

1. `load() on an empty DATA_DIR initialises in-memory store to { version: 1, devices: [] }`
2. `add() appends a record with id starting "dev_" and a sha256-prefixed token_hash; returns the record`
3. `returned record has paired_at + last_seen as ISO timestamps that round-trip through Date.parse`
4. `AC8: after add() the on-disk file has exactly 1 record and raw token NEVER appears (sha256 only)`
5. `hashToken(raw) returns sha256:<64 hex chars> (length 71, sanity for safeEqualHash length guard)`
6. `findByToken(rawToken) returns the record after add(); null on wrong/empty/null input; lookup uses the hash (not raw)`
7. `remove(deviceId) removes the row and returns 1; remove(<unknown>) returns 0`
8. `touchLastSeen(id) updates the in-memory record AND persists to disk (verified by fresh reload)`
9. `on-disk file uses plain writeFileSync — no devices.json.tmp* exists alongside` (Option A discipline pin)

### Full suite regression check

```
$ npx vitest run
 Test Files  6 failed | 21 passed (27)
      Tests  44 failed | 171 passed (215)
   Duration  20.47s
```

Compare to the Wave 0 baseline recorded in `16-01-SUMMARY.md:67-72`:

```
                     Test Files  Tests
Wave 0 baseline:     7 failed   53 failed | 162 passed
After this plan:     6 failed   44 failed | 171 passed
Delta:               -1 file    -9 failed  +9 passed
```

The delta is exactly the 9 tests in `tests/devices-json.test.js`
flipping RED → GREEN. **Zero regression in the 162 pre-existing
tests.**

### Tests that stay RED by design (and which plan turns each one green)

| File | New tests still RED | Why still RED | Closes in |
|---|---|---|---|
| `tests/pair-otp.test.js` | 7 | `../pair-otp.js` does not exist | 16-03 |
| `tests/pair-redeem.test.js` | 10 | `../routes/pair.js` does not exist (devices.js dependency now satisfied) | 16-04 |
| `tests/bootstrap-otp.test.js` | 7 | `../pair-otp.js`'s `bootstrapIfNeeded` does not exist (devices.isEmpty/clearBootstrap/BOOTSTRAP_PATH now satisfied) | 16-03 |
| `tests/ws-auth-gate.test.js` | 8 | `../auth-gate.js` does not exist | 16-05 |
| `tests/revoke-closes-socket.test.js` | 7 | `sessions.closeDevice` is not a function | 16-05 |
| `tests/device-revoke-rebuild.test.js` | 5 | `../pair-otp.js`'s `mintOtp`/`redeemOtp` do not exist (devices.js half is now green) | 16-03 + 16-04 |

Half of `tests/device-revoke-rebuild.test.js`'s setup uses `devices.add`
+ `devices.remove` + `devices.findByToken` — those calls work now. The
remaining gap is the OTP cycle which lands in 16-03.

---

## Files touched

- `devices.js` (new, 180 lines including the header comment block) —
  the persistence module.

**Nothing else touched.** No `server.js`, no `handlers.js`, no
`sessions.js`, no client code, no test files, no config. This plan is
the data module in isolation per the wave 1 boundary.

## Out-of-scope discoveries

None. The line-number drift note carried in the prompt (re: 16-01
SUMMARY's `server.js:368` correction to PATTERNS' `server.js:366`) did
not affect this plan — `devices.js` is a new top-level module, no
existing line splices to anchor against.

## Deferred follow-ups (Phase 17 candidates)

1. **Atomic-write retrofit across all three JSON persisters.** Add
   `atomicWriteJson(path, data)` to `utils.js`. Switch
   `devices.save()`, `sessions.saveSessions()` and `config.save()` to
   use it in one PR. This eliminates the current
   "3 plain / 0 atomic" discipline (and, equally importantly, prevents
   any single new persister from creating a "1 atomic / N plain"
   asymmetry).
2. **`touchLastSeen` batching.** Mirror `sessions.startAutoSave()`'s
   30s-interval idiom: in-memory mutation is sync, disk flush is on
   the timer. Add a final flush on `shutdown.js`'s shutdown path.

Both items belong together if/when Lance decides the workload has
outgrown the v1 scale assumptions, OR as a one-off "tidy the
persisters" Phase 17.

## Self-Check

```
$ test -f /home/clideck/projects/clideck/devices.js && echo FOUND || echo MISSING
FOUND
$ git log --oneline -1 527ecdd
527ecdd feat(devices): persist linked devices in .clideck/devices.json with sha256 token-hash + timing-safe lookup (Phase 16 D-02, AC2 / AC8 partial)
```

Self-Check: PASSED.
