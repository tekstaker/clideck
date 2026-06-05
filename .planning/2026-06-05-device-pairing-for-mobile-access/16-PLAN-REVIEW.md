---
phase: 16-device-pairing-for-mobile-access
reviewed: 2026-06-05
reviewer: gsd-plan-checker (goal-backward verification, pre-execution)
verdict: pass
plans_checked: 8
blockers: 0
warnings: 6
plans_pinned_at: HEAD a231b64 (confirmed live via grep)
---

# Phase 16 — Plan-set goal-backward review

## TL;DR

All 8 plans cleanly cover the 9 SPEC ACs, the 6 CONTEXT decisions, and the in-scope
artifacts under the Phase 15 merge-order rule. Wave 0 (16-01) writes the RED TDD
contracts for every behaviour-adding task in Waves 1–3, and each downstream plan
identifies the exact Wave 0 spec it must turn GREEN. **Verdict: PASS — proceed to
`/gsd-execute-phase 16`.** Six WARNINGs are documented (none blocking) for the
executor to handle inline; the two most material are the depends_on under-
declaration in 16-05 (Task 3 depends on 16-04's `devices.load()` boot wiring,
which the frontmatter `depends_on` already captures, but the wave-2 plans should
be aware the dispatcher's `devices` closure binding requires Splice A from 16-04
to have run first) and the e2e-gate-on-Chromium-libs deferral path (which 16-08
already documents per Phase 15 precedent).

## AC trace (9-row goal-backward table)

| # | SPEC AC | Implementing plan(s) | RED test in 16-01 (Task #) | Status |
|---|---------|---------------------|----------------------------|--------|
| AC1 | Fresh load is gated → `/pair`, no session list, no WS | 16-06 Task 3 (boot-time localStorage gate in `connect()`) + 16-04 Task 3 (placeholder `public/pair.html` so the redirect target serves 200) | Task 8 (`e2e/pair-flow.spec.js`, Test 1 — empty localStorage → /pair, no `window.__ws`) | PASS |
| AC2 | Successful pair persists, reload into dashboard with live WS | 16-04 Task 1 (`POST /pair/redeem` handler) + 16-02 Task 1 (devices.add → token_hash to disk) + 16-06 Task 1 (pair.js POST + localStorage.set + redirect to `/`) | Task 3 (`tests/pair-redeem.test.js` — 200 happy path + DI contract) **and** Task 8 (`e2e/pair-flow.spec.js`, Test 2 — bootstrap pair end-to-end → dashboard) | PASS |
| AC3 | Known device reconnects silently | 16-05 Task 1 + Task 3 (verifyClient accepts known token via subprotocol; (ws,req) wrapper tags ws.deviceId) + 16-06 Task 3 (`connect()` builds `new WebSocket(url, ['clideck-device-token', token])`) | Task 8 (`e2e/pair-flow.spec.js`, Test 3 — token in localStorage → goto `/` → no /pair redirect, WS connects) | PASS |
| AC4 | Unknown token = reject, never in sessions.clients, close 4401 | 16-05 Task 1 (auth-gate.js `makeVerifyClient` returns `callback(false, 401, 'unpaired')`) + 16-05 Task 3 (server.js wires it BEFORE wss.on('connection')) | Task 4 (`tests/ws-auth-gate.test.js` — covers absent header, sentinel-only, unknown token, origin-deny, all variants) | PASS [Â¹] |
| AC5 | Revoke closes live sockets within 1s | 16-05 Task 2 (sessions.closeDevice iterates clients, calls `c.close(4401, 'revoked')`) + 16-05 Task 4 (handlers.js `device.revoke` arm: remove → closeDevice → broadcast) + 16-06 Task 4 (client onclose hybrid clears localStorage on 4401) + 16-07 Task 2 (Settings panel Revoke button sends `device.revoke`) | Task 5 (`tests/revoke-closes-socket.test.js` — 50-fake-client latency budget `<1000ms`) **and** Task 9 (`e2e/revoke-flow.spec.js` — observe `device.revoke` sent + 4401 closes + /pair redirect) | PASS |
| AC6 | Revoked device can re-pair (per-token, not per-fingerprint) | 16-02 + 16-03 + 16-04 (full mint → add → remove → mint → re-add cycle through the device store + OTP layer + redeem route) | Task 7 (`tests/device-revoke-rebuild.test.js` — 5 it-blocks including "same UA fingerprint can re-pair") | PASS |
| AC7 | Owner bootstrap path works (D-02 boot OTP → stdout + .clideck/bootstrap.otp) | 16-03 Task 1 (`bootstrapIfNeeded()` mints + writes file + banner) + 16-04 Task 2 (server.js boot calls `pairOtp.bootstrapIfNeeded()` after `devices.load()`) + 16-04 Task 1 (`/pair/redeem` calls `devices.clearBootstrap()` on `isBootstrap:true`) | Task 6 (`tests/bootstrap-otp.test.js` — 7 it-blocks: write on empty, no-op on populated, OTP matches banner, deletion on redeem, 24h TTL, `isBootstrap:true` flag) | PASS |
| AC8 | Token never leaks (only token_hash in persistence + logs) | 16-02 Task 1 (token_hash only via `hashToken` before `add`, plain writeFileSync) + 16-04 Task 1 (no `console.log` of rawToken; explicit grep guard in acceptance criteria) + 16-06 Task 1 (no `console.log` of token in pair.js or app.js; explicit `grep -E 'console\.log.*[Tt]oken'` guard) + 16-08 Task 3 (live grep audit of diff + DATADIR) | Task 2 (`tests/devices-json.test.js` — `expect(JSON.stringify(found)).not.toContain(rawToken)`) **and** Task 3 (`tests/pair-redeem.test.js` — `vi.spyOn(console, 'log')` captures zero token-bearing calls) | PASS |
| AC9 | OTP single-use + TTL honored, distinct error codes | 16-03 Task 1 (`redeemOtp` returns `invalid|used|expired` distinct shapes; 5-min user TTL, 24h bootstrap TTL) + 16-04 Task 1 (HTTP-layer mapping: 410 for expired, 400 for used/invalid) | Task 1 (`tests/pair-otp.test.js` — 7 it-blocks covering all 4 result shapes) **and** Task 3 (`tests/pair-redeem.test.js` — asserts 410 for expired, 400 for used/invalid) | PASS |

[¹] AC4 is achieved by the verifyClient-rejection path returning HTTP 401 at the upgrade level, which the browser surfaces as `event.code === 1006` (RFC 6455 fact, verified in RESEARCH §7). The plans correctly handle this asymmetry via the 16-06 onclose hybrid (`event.code === 4401 || (!connectedAtLeastOnce && event.code === 1006 && hasToken)`) so AC4's "rejected → no session data" is satisfied by construction; the client UX is symmetric across both 4401 and 1006-with-stored-token. This is a genuine design subtlety, not a gap.

## Cross-cutting findings

| Gate | Status | Evidence |
|------|--------|----------|
| **TDD coverage (CLAUDE.md §2)** | PASS | Spot-check of 5 randomly-sampled Wave 1–3 tasks: (a) 16-02 Task 1 → covered by 16-01 Task 2 (devices-json.test.js, 9 it-blocks). (b) 16-03 Task 1 → covered by 16-01 Tasks 1+6 (pair-otp + bootstrap-otp, 14 it-blocks). (c) 16-04 Task 1 → covered by 16-01 Task 3 (pair-redeem, 10 it-blocks). (d) 16-05 Task 2 (sessions.closeDevice) → covered by 16-01 Task 5 (revoke-closes-socket, 7 it-blocks). (e) 16-06 Task 4 (onclose hybrid) → covered by 16-01 Task 9 (e2e revoke-flow self-revoke arm). Every Wave 1–3 behaviour-adding task has a RED test authored Wave 0 first. |
| **Honest gap reporting (CLAUDE.md §1)** | PASS | Every plan's `<verify>` block uses runnable commands (`npx vitest run …`, `node -c server.js`, `grep -F …`). 16-08 Task 2 explicitly documents the Chromium-libs-missing deferral path per Phase 15 D-14 precedent. No plan uses "assume tests pass" language; every acceptance criterion is a runnable check. |
| **Verbose commit shape (CLAUDE.md §5)** | PASS | Each plan's `<output>` block prescribes a per-plan SUMMARY.md capturing rationale, pin decisions, and verification output — exactly the verbose-commit ammunition the personal-project style needs. The commit-message wording itself is the executor's prerogative per the workflow, but the SUMMARY content is rich. |
| **Phase 15 merge-order awareness (PATTERNS §3)** | PASS | Every plan that touches handlers.js / sessions.js / server.js / state.js / app.js carries an explicit `[verify line numbers pre-execute]` note. PATTERNS §3 makes the recommendation "Phase 15 merges first, then Phase 16 plans regenerate against the post-merge tree" and 16-05 / 16-04 / 16-06 / 16-07 each repeat the re-grep advice in `<read_first>`. 16-08 Task 5's VERIFICATION includes a Phase 15 Merge-Order section. |
| **Decision honoring (D-01..D-06)** | PASS | D-01 (subprotocol) → 16-05 Task 3 splice. D-02 (boot OTP to stdout + file) → 16-03 Task 1 + 16-04 Task 2. D-03 (hard server reject + soft client redirect) → 16-05 + 16-06 split exactly along this seam. D-04 (free-form labels, `(2)/(3)` suffix at render time) → 16-07 Task 2 implements the suffix counter. D-05 (do NOT touch clients.count) → no plan modifies handlers.js:267's adjacent area or sessions.broadcast clients.count; auth-gate runs server-side in `verifyClient` before wss.on('connection'), so the broadcast (when it exists post-Phase-15-merge) is never triggered for unpaired sockets. D-06 (two confirm-modal variants) → 16-07 Task 2 with explicit string content for both variants. |
| **Secrets hygiene (CLAUDE.md §13)** | PASS | Bootstrap-OTP-to-stdout is acknowledged as the single deliberate, bounded exception in 16-03 Task 1 (`// Intentional: bootstrap recovery path. The OTP is single-use, short-lived, and visible only to whoever has shell access`). No other plan logs OTP or token values: 16-04 has explicit grep guards (`! grep -E "console\.log.*rawToken"`), 16-06 has `! grep -E 'console\.log.*[Tt]oken'` in pair.js, 16-07 documents "no token_hash in UI." 16-08 Task 3 performs the live grep + DATADIR audit. |
| **Closed-fence respect (SPEC out-of-scope)** | PASS | Spot-checked all 8 plans: zero mention of public exposure, TLS, rate-limiting beyond OTP TTL, SSO/OAuth/WebAuthn, token rotation, or modification to Phase 15's mobile-desktop work. The only TLS reference is in 16-08's R3 path which assumes Lance deploys to clideck-docker-lance (correct boundary — TLS lives there per SPEC). |
| **Frontmatter `requirements` coverage** | PASS | All 9 AC IDs (AC1–AC9) appear in at least one plan's `requirements:` field. 16-01 covers all 9 (it's the test-authoring wave). 16-04 covers AC1/AC2/AC7/AC8/AC9. 16-05 covers AC4/AC5. 16-06 covers AC1/AC2/AC3/AC5. 16-07 covers AC2/AC5/AC6. 16-08 covers all 9 (verification). No AC is left unmapped. |
| **Architectural tier compliance** | PASS | RESEARCH does not contain a formal Architectural Responsibility Map table, but the natural tier assignment is correct: auth runs server-side in `verifyClient` (16-05), persistence is the devices.js server module (16-02), client merely passes the token via subprotocol header (16-06). No security-sensitive capability is placed on the browser tier. |
| **Cross-plan data contracts** | PASS | Three shared entities: (1) `devices.json` — written by 16-02, read by 16-04 (redeem add) and 16-05 (verifyClient lookup, revoke remove). All three use the same load/save/findByToken/add/remove API; no conflicting transforms. (2) `state.linkedDevices` — written by app.js's `device.list` arm (16-07 Task 3), read by settings.js renderLinkedDevices (16-07 Task 2). (3) `ws.deviceId` / `ws.deviceTokenHash` — set in server.js wrapper (16-05 Task 3), read by sessions.closeDevice (16-05 Task 2) and the device.list "live" computation in handlers.js (16-05 Task 4). Consistent producer/consumer split, no surprises. |
| **CLAUDE.md global compliance** | PASS | §1 (verify before claiming done) — each plan's `<verify>` block uses runnable commands. §2 (TDD) — see "TDD coverage" row. §3 (commit-don't-push on GitHub remotes) — every plan's success_criteria includes "Commit lands on `main`, NOT pushed (CLAUDE.md §3)" and the remote is verified GitHub (`origin https://github.com/tekstaker/clideck.git`). §5 (verbose commits) — see "Verbose commit shape" row. §13 (secrets) — see "Secrets hygiene" row. §14 (demand elegance) — 16-02 PATTERNS §2.2 atomic-write call-out, 16-04's "no atomic-rename file alone" pin, 16-05's Pattern A vs B rationale all surface the elegance check. |

## Anti-pattern flags

| Check | Finding |
|-------|---------|
| Autonomous plan with mid-execution user-judgment task? | None. 16-08 is correctly marked `autonomous: false` because Task 4 is the `checkpoint:human-verify` R3 real-device smoke; all other Wave 0–3 plans are autonomous and contain no checkpoint tasks. |
| `files_modified` mismatch with `<action>` block files? | None. Each plan's frontmatter `files_modified` list exactly matches the files touched in its `<action>` blocks. 16-04 lists `routes/pair.js` + `server.js` and adds Task 3 for `public/pair.html` (which is also in `files_modified` — verified: line 9 lists it as `public/pair.html`). Wait — 16-04 frontmatter lists `routes/pair.js` and `server.js` but **NOT** `public/pair.html` even though Task 3 creates that file. **WARNING [W1] — see below.** |
| `depends_on` missing a real dependency? | 16-05 declares `depends_on: [16-01, 16-02, 16-03, 16-04]` — correct (server.js Splice B in 16-05 Task 3 binds the `devices` and `pairOtp` closure variables introduced by 16-04 Splice A). 16-06 declares all of 16-01..16-05 — correct (pair.html replacement depends on 16-04's placeholder; onclose hybrid for 4401 depends on 16-05's revoke flow). 16-07 depends on all of 16-01..16-06 — correct (state.deviceId from 16-06; `device.list` / `device.revoke` arms from 16-05; pair.html from 16-04+16-06). 16-08 depends on all of 16-01..16-07 — correct (verification rollup). No undeclared dependencies caught. |
| Wave 0 RED plan's `<verify>` exit-code contradicts task type? | 16-01 Tasks 1–7 each correctly note in the `<automated>` block "expected: exit 1, MODULE_NOT_FOUND" (RED state) and the acceptance_criteria says `exits non-zero (RED)`. Tasks 8–9 (Playwright) say "exits non-zero (RED)" too. Consistent. |

## Warnings (non-blocking)

**W1 — `files_modified` missing `public/pair.html` in 16-04 frontmatter.**
- File: `16-04-PLAN.md` line 7-10
- Issue: Task 3 creates `public/pair.html` but the `files_modified:` list only declares `routes/pair.js` and `server.js`. The `<artifacts>` block also omits `public/pair.html`.
- Fix hint: Add `- public/pair.html` to `files_modified:` and add a corresponding `artifacts:` entry. Cosmetic — the executor will create the file per Task 3's `<files>` directive regardless.

**W2 — `pair-otp.js` not listed as a key dependency artifact in 16-04's `must_haves.key_links`.**
- File: `16-04-PLAN.md` lines 27-40
- Issue: 16-04 inline-requires `./routes/pair` and depends on `pairOtp.bootstrapIfNeeded()` being defined, but the key_links only show the server.js→routes/pair.js path. The `require('./pair-otp')` call at boot in Splice A (Task 2) implicitly depends on 16-03 (which IS in `depends_on`).
- Fix hint: Add a key_link `from: server.js to: pair-otp.js via: "require('./pair-otp')"`. Documentation gap only; the dependency graph itself is correct.

**W3 — `auth-gate.js` not declared in 16-05's `files_modified` list as a NEW file the test expects to find at the path it specifies.**
- File: `16-05-PLAN.md` lines 7-12
- Issue: `auth-gate.js` IS in the frontmatter `files_modified:` (line 9), good. But 16-01 Task 4's `freshGate()` does `return require('../auth-gate.js')` — pinning the module name as `auth-gate.js` at the project root. 16-05 honours this. No actual mismatch.
- Resolution: This is not a bug; on re-read the dependency is consistent. **Downgrading to INFO.** No fix needed.

**W4 — Playwright e2e (Tasks 8/9 in 16-01) may not run in this WSL environment.**
- File: `16-01-PLAN.md` Task 8 line 493 and Task 9 line 536 acceptance_criteria say "exits non-zero (RED)" but the prerequisite is Chromium libs being installed. If Chromium can't launch, the test errors at boot rather than asserting-failing, which is still "exits non-zero" but for the wrong reason.
- Fix hint: 16-08 Task 2 already documents the Chromium-libs deferral path with "DEFERRED — manual R3" — so the executor knows what to do if Playwright can't launch on Wave 0 either. Optionally add the same deferral note to 16-01 Task 8/9 acceptance criteria for clarity.

**W5 — `routes/pair.js` directory creation not explicitly called out as a precondition.**
- File: `16-04-PLAN.md` Task 1 line 199
- Issue: The action says "Create … `routes/pair.js` (directory and file new)" but Bash tool semantics require the parent directory to exist before `Write`. Executor must run `mkdir -p routes` or rely on `Write` to mkdir recursively.
- Fix hint: Add `mkdir -p routes` as an explicit step OR call out that the executor's Write tool handles parent creation. Trivial.

**W6 — `touchLastSeen` writes devices.json on EVERY WS reconnect with no debouncer.**
- File: `16-02-PLAN.md` Task 1 line 158 (documented honest gap) and 16-05 Task 3 wraps `devices.touchLastSeen(req.clideckDevice.id)` into every accepted upgrade.
- Issue: For a desktop with 3 phones reconnecting every few minutes (NAT timeout) this is 100s of writes/day. Acceptable at clideck's "Lance + 3 phones" scale, but worth flagging because both 16-02 and 16-08's follow-ups section name it as a Phase 17 candidate.
- Fix hint: Already documented as a Phase 17 follow-up. No fix required for Phase 16.

## Suggested fixes (one-line, file:line where possible)

1. `16-04-PLAN.md:7-10` — add `- public/pair.html` to `files_modified:` and a matching `artifacts:` entry. (W1)
2. `16-04-PLAN.md:27-40` — add `from: server.js to: pair-otp.js via: "require('./pair-otp')"` key_link. (W2)
3. `16-04-PLAN.md:199` — note that `routes/` parent dir needs `mkdir -p` before Write. (W5)
4. `16-01-PLAN.md:493,536` — add Chromium-libs deferral note pointing to 16-08 Task 2's recovery path. (W4)
5. (No fix required for W3 or W6 — W3 was a misread on my part; W6 is correctly deferred.)

## Overall verdict + recommendation

**VERDICT: PASS — proceed to `/gsd-execute-phase 16`.**

The plan set goal-backward verifies cleanly. Every AC has at least one implementing
plan AND at least one RED test in 16-01 that the implementing plan must turn
GREEN. Dependencies are correctly declared. The Phase 15 merge-order pressure is
recognised in every line-number-sensitive plan with explicit "re-grep before
editing" notes. CLAUDE.md global rules §1, §2, §3, §5, §13, §14 are honored.

The 6 warnings are cosmetic / documentation-level. None block execution.
W1 (frontmatter `files_modified` missing `public/pair.html` in 16-04) is the only
warning I'd recommend the executor patch inline at the start of 16-04 — 30 seconds
of editing the YAML frontmatter, no behavioural impact. W2 / W4 / W5 are
nice-to-haves; the executor will navigate around them naturally.

**No "user decision needed" — the 6 CONTEXT.md decisions are all locked and the
plans honor them precisely. Lance can authorise `/gsd-execute-phase 16` without
re-running discuss-phase.**

If any of Tasks 1–9 in 16-01 emerge from execution as accidentally-GREEN (e.g.
the module-not-found path resolves to a stub somewhere), the executor must
treat that as a fail-the-RED-state bug per CLAUDE.md §2 — re-author the test
to fail for the right reason. 16-01's per-task acceptance criteria already
include `exits non-zero (RED)` so this is covered.

Per CLAUDE.md §3: this review document commits to `main` but is NOT pushed
(GitHub remote — `origin https://github.com/tekstaker/clideck.git`).

— gsd-plan-checker, 2026-06-05
