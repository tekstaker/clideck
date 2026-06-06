---
phase: 16-device-pairing-for-mobile-access
plan: 01
type: execute
wave: 0
state: complete (RED-state authored — by design)
date: 2026-06-05
duration_seconds: 814
duration_pretty: ~13min
requirements_addressed: [AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9]
files_created:
  - tests/pair-otp.test.js
  - tests/devices-json.test.js
  - tests/pair-redeem.test.js
  - tests/ws-auth-gate.test.js
  - tests/revoke-closes-socket.test.js
  - tests/bootstrap-otp.test.js
  - tests/device-revoke-rebuild.test.js
  - e2e/pair-flow.spec.js
  - e2e/revoke-flow.spec.js
files_modified: []
commits:
  - c35418a: "test(phase-16-01): author tests/pair-otp.test.js as RED-state TDD gate for AC9"
  - f5264e7: "test(phase-16-01): author tests/devices-json.test.js as RED-state TDD gate for AC8"
  - 625b623: "test(phase-16-01): author tests/pair-redeem.test.js as RED-state TDD gate for AC2/AC8/AC9"
  - ebf10ea: "test(phase-16-01): author tests/ws-auth-gate.test.js as RED-state TDD gate for AC4"
  - a9fab75: "test(phase-16-01): author tests/revoke-closes-socket.test.js as RED-state TDD gate for AC5"
  - f99bbec: "test(phase-16-01): author tests/bootstrap-otp.test.js as RED-state TDD gate for AC7 / D-02"
  - 4d25337: "test(phase-16-01): author tests/device-revoke-rebuild.test.js as RED-state TDD gate for AC6"
  - 5578eee: "test(phase-16-01): author e2e/pair-flow.spec.js as RED-state TDD gate for AC1/AC2/AC3/AC7"
  - c0d3234: "test(phase-16-01): author e2e/revoke-flow.spec.js as RED-state TDD gate for AC5 / AC6 / D-06"
metrics:
  vitest_specs_authored: 7
  playwright_specs_authored: 2
  total_it_blocks_authored: 53
  preexisting_tests_still_green: 162
  new_red_tests: 53
  new_red_playwright_tests: 4 (2 + 2; 1 e2e test is test.skip-gated on AC2 succeeding)
---

# Phase 16 Plan 01: Wave 0 — RED-state TDD gates Summary

Authored 9 test files (7 vitest + 2 Playwright) as RED-state TDD contracts
for the 9 acceptance criteria of phase 16 (device pairing). Per
CLAUDE.md §2 these tests ARE the definition of done for plans
16-02..16-07; each is failing today by design because the modules /
routes / panels they target do not yet exist. Plan 16-08 will verify
that all 9 specs flip green at the end of the phase.

## Per-spec breakdown

| File | AC mapping | RED reason today | Wave that turns it green |
|---|---|---|---|
| `tests/pair-otp.test.js` (7 it-blocks) | AC9 (OTP single-use + TTL + distinct error codes) | `../pair-otp.js` does not exist | 16-03 |
| `tests/devices-json.test.js` (9 it-blocks) | AC8 (raw token never persists), AC2 (persist hash on pair) | `../devices.js` does not exist | 16-02 |
| `tests/pair-redeem.test.js` (10 it-blocks) | AC2, AC8 (token-not-in-logs), AC9, AC7 (bootstrap clear) | `../routes/pair.js`, `../devices.js`, `../pair-otp.js` do not exist | 16-04 (route) + 16-02 + 16-03 |
| `tests/ws-auth-gate.test.js` (8 it-blocks) | AC4 (unknown token → 4401, never in sessions.clients) | `../auth-gate.js` (`makeVerifyClient` + `readDeviceToken`) does not exist | 16-05 |
| `tests/revoke-closes-socket.test.js` (7 it-blocks) | AC5 (revoke closes live sockets within 1s) | `sessions.closeDevice` is not a function | 16-05 (sessions.closeDevice) + 16-07 (handlers.js device.revoke arm) |
| `tests/bootstrap-otp.test.js` (7 it-blocks) | AC7 + D-02 (bootstrap path + single-use bootstrap.otp file) | `../pair-otp.js` (`bootstrapIfNeeded`) and `../devices.js` (`isEmpty`, `clearBootstrap`, `BOOTSTRAP_PATH`) do not exist | 16-03 (bootstrap) + 16-02 (devices.isEmpty/clearBootstrap) |
| `tests/device-revoke-rebuild.test.js` (5 it-blocks) | AC6 (per-token, not per-fingerprint — re-pair after revoke) | `../devices.js` + `../pair-otp.js` do not exist | 16-02 + 16-03 |
| `e2e/pair-flow.spec.js` (3 tests) | AC1, AC2, AC3, AC7 | No `/pair` route, no `/pair/redeem`, no bootstrap.otp, no app.js localStorage check, no app.js onclose 4401 handler | 16-04 (routes) + 16-03 (bootstrap wire) + 16-06 (client) |
| `e2e/revoke-flow.spec.js` (2 tests) | AC5, AC6, D-06 | No Settings → Linked devices panel, no `device.list` / `device.revoke` arms, no onclose 4401 → /pair redirect | 16-05 + 16-06 + 16-07 |

## RED-state proof (current run)

### vitest — full suite (post-Wave-0)
```
 Test Files  7 failed | 20 passed (27)
      Tests  53 failed | 162 passed (215)
   Start at  14:04:21
   Duration  21.51s
```
The **162 pre-existing tests stayed green** (success criterion satisfied —
no regression). The 53 new failures are exactly the 7 new RED specs
(7 + 9 + 10 + 8 + 7 + 7 + 5 = 53).

Per-file failure mode (verified individually before each commit):

| File | exit | new failures | failure-mode signature |
|---|---|---|---|
| `tests/pair-otp.test.js` | 1 | 7/7 | `MODULE_NOT_FOUND ../pair-otp.js` |
| `tests/devices-json.test.js` | 1 | 9/9 | `MODULE_NOT_FOUND ../devices.js` |
| `tests/pair-redeem.test.js` | 1 | 10/10 | `MODULE_NOT_FOUND ../devices.js` (first import wins) |
| `tests/ws-auth-gate.test.js` | 1 | 8/8 | `MODULE_NOT_FOUND ../devices.js` (first import wins) |
| `tests/revoke-closes-socket.test.js` | 1 | 7/7 | `TypeError: sessions.closeDevice is not a function` |
| `tests/bootstrap-otp.test.js` | 1 | 7/7 | `MODULE_NOT_FOUND ../devices.js` (first import wins) |
| `tests/device-revoke-rebuild.test.js` | 1 | 5/5 | `MODULE_NOT_FOUND ../devices.js` (first import wins) |

### Playwright — both new specs
```
playwright exit: 1
4 failed
  [chromium] › e2e/pair-flow.spec.js — AC1 — empty localStorage redirects to /pair with no WS
  [chromium] › e2e/pair-flow.spec.js — AC2 + AC7 — bootstrap OTP end-to-end
  [chromium] › e2e/revoke-flow.spec.js — other-device revoke
  [chromium] › e2e/revoke-flow.spec.js — self-revoke
1 skipped
  [chromium] › e2e/pair-flow.spec.js — AC3 (test.skip-gated on AC2 token capture; never runs while AC2 is RED)
```

Note: this host **does have Chromium libs installed** (contrary to the
plan's Phase 15 precedent caveat), so Playwright actually ran instead
of falling back to a `node --check` syntax-verification gate. Both
specs are demonstrably RED for the correct reasons.

## Deviations from plan

### None functional — all 9 tasks executed exactly as written

The plan was followed verbatim. No Rules 1-4 fired during execution.
No architectural changes were needed; no auth gates were hit. The plan
was a pure test-authoring exercise with no production-code touches.

### Documentation-grade observations (no code impact)

1. **Line-number drift verified, harmless** (CLAUDE.md §1):
   - PATTERNS.md was pinned against commit `b4a09fb`.
   - Current HEAD `feat/device-pairing-for-mobile-access` at `a38d0b0`
     shows `verifyClient` on **server.js:368** (PATTERNS said 366 — a
     two-line drift). The tests assert behaviour not lines so this is
     a SUMMARY-only flag for 16-VERIFICATION.md.
   - `function broadcast` (sessions.js:53) and `const clients = new
     Set()` (sessions.js:21) are unchanged from the planner's
     references — verified pre-write.

2. **Vitest version on this host is 4.1.6** (per `package.json`
   devDependencies). All `// @vitest-environment node` directives,
   `vi.useFakeTimers`, `vi.spyOn`, `expect.poll` semantics behave as
   documented.

3. **The fall-through helper file path** in the few cases where
   multiple modules import together (`pair-redeem`, `ws-auth-gate`,
   `bootstrap-otp`, `device-revoke-rebuild`) — the `MODULE_NOT_FOUND`
   from `../devices.js` is the **first** require that fails, masking
   the secondary `../pair-otp.js` etc. error. This is expected and
   benign: every test file's `freshFoo()` helper requires the module
   set as a single side-effect, and the first miss wins. Once Wave 1
   plan 16-02 ships `devices.js`, the next plan that misses will
   surface its own MODULE_NOT_FOUND, and so on.

## Known stubs

**None.** This plan only authors tests — no UI components, no
hardcoded empty literals flowing to render. The test files'
`syntheticToken()` and `synthHash()` helpers are intentional
non-cryptographic fixtures (per CLAUDE.md §13) and are documented in
the file headers as such.

## CLAUDE.md compliance

- **§1 (verify before claiming done)**: every test file was run with
  `npx vitest run <file>` (or `npx playwright test <file>`) BEFORE the
  commit; the exit code + per-test failure mode was captured into the
  commit message. No "should work" / "looks correct" handwave.
- **§2 (TDD-first)**: this entire plan IS the TDD-first contract for
  waves 1-3. Every behaviour-adding task downstream has a RED test
  authored here first.
- **§3 (commit autonomously and often; respect remote)**: 9 atomic
  per-task commits landed on `feat/device-pairing-for-mobile-access`.
  **NOT pushed** — the remote is `https://github.com/tekstaker/clideck.git`
  (GitHub), commit-but-don't-push per the rule.
- **§4 (git identity)**: `Samuel Harding <dev1@lancetek.com>` verified
  via `git config user.email` before the first commit. Untouched.
- **§5 (verbose commit messages on personal projects)**: each of the 9
  commit messages includes the RED reason, the contract the test
  pins, which Wave 1-3 plan satisfies it, and CLAUDE.md
  cross-references.
- **§13 (secrets hygiene)**: no real tokens, OTPs, or fingerprints in
  any test file. All synthetic per-test (`syntheticToken()`,
  `synthHash()`, generated OTPs via `mintOtp()`). The bootstrap OTP is
  read into a local variable in the e2e specs and never echoed to
  test stdout; the comment block in each spec calls this out.

## Phase 15 merge-order recap (PATTERNS §3)

PATTERNS §3 flagged Phase 15 merge-order pressure. **Phase 15 has NOT
merged to main**, so this Wave 0 was authored against the current
main lineage (`feat/device-pairing-for-mobile-access` at `a38d0b0`).
When/if Phase 15 lands first, the auth-gate splice in `handlers.js`
shifts by one line (S-1 in PATTERNS §3), and the state.js literal
gains a sibling field `otherClientsConnected: false` (S-3). Neither
change affects the RED test contracts here — only the production-code
splices in Waves 1-3 will need to re-target post-merge.

The e2e specs in particular are designed to be merge-resilient: they
use feature selectors (`#settings-devices`, `[data-cat="devices"]`,
`#pair-submit`, `localStorage.clideck.deviceToken`) rather than
line-numbered DOM positions.

## Commit-message-style summary (quotable into 16-VERIFICATION.md)

> Wave 0 (plan 16-01) authored 9 test files — 7 vitest unit specs (53
> total it-blocks) and 2 Playwright e2e specs (5 tests, 1 test.skip-gated)
> — as RED-state TDD contracts for the 9 ACs of phase 16. Every
> behaviour-adding task in Waves 1-3 has a failing test authored here
> first per CLAUDE.md §2. The pre-existing 162-test green baseline was
> not regressed. 9 atomic commits landed on
> feat/device-pairing-for-mobile-access; not pushed (GitHub remote).
> Each commit message documents the RED reason and the wave that
> turns it green so a future checker can verify "intended RED" vs.
> "accidental regression."

## Self-Check: PASSED

Files created (all verified present, all 9):
- FOUND: tests/pair-otp.test.js
- FOUND: tests/devices-json.test.js
- FOUND: tests/pair-redeem.test.js
- FOUND: tests/ws-auth-gate.test.js
- FOUND: tests/revoke-closes-socket.test.js
- FOUND: tests/bootstrap-otp.test.js
- FOUND: tests/device-revoke-rebuild.test.js
- FOUND: e2e/pair-flow.spec.js
- FOUND: e2e/revoke-flow.spec.js

Commits in git log (all verified present, all 9):
- FOUND: c35418a (pair-otp)
- FOUND: f5264e7 (devices-json)
- FOUND: 625b623 (pair-redeem)
- FOUND: ebf10ea (ws-auth-gate)
- FOUND: a9fab75 (revoke-closes-socket)
- FOUND: f99bbec (bootstrap-otp)
- FOUND: 4d25337 (device-revoke-rebuild)
- FOUND: 5578eee (pair-flow.spec.js)
- FOUND: c0d3234 (revoke-flow.spec.js)
