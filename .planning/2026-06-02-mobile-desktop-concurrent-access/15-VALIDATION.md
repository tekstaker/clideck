---
phase: 12
slug: mobile-desktop-concurrent-access
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-02
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `15-RESEARCH.md` § Validation Architecture and `SPEC.md` requirements R1..R6.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (unit)** | `vitest@^4.1.6` |
| **Framework (E2E)** | `@playwright/test@^1.60.0` |
| **DOM env (unit DOM tests)** | `happy-dom@^20.9.0` |
| **Config file (unit)** | none — vitest auto-detects; no `vitest.config.*` in repo |
| **Config file (E2E)** | `playwright.config.js` — `testDir: ./e2e`, single Chromium project, port 4099, isolated `TEST_HOME` |
| **Quick run command** | `npm run test` (full unit), or `npx vitest run <file>` (single file) |
| **Full suite command** | `npm run test && npm run test:e2e` |
| **Estimated runtime** | unit ~ 5–10s · E2E ~ 30–60s (when Chromium libs available) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test` (vitest, full unit suite — ~5–10s)
- **After every plan wave:** Run `npm run test && npm run test:e2e`
- **Before `/gsd:verify-work`:** Full suite must be green (or documented in `15-VERIFICATION.md` per D-19 if Chromium libs unavailable locally — falls back to manual real-device path for R3)
- **Max feedback latency:** ~10s for unit tests (per-commit)

---

## Per-Task Verification Map

> Plan IDs are placeholders — exact `12-NN` numbering is set during plan-creation. Mapping is from SPEC requirement → validation gate.

| Req | Plan focus | Wave | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|------------|------|------------|-----------------|-----------|-------------------|-------------|--------|
| R1 | `clideck-remote` deletion sweep | 1 | V5 / V7 | Server no longer exposes `case 'remote.*':` WS arms; deleted `case` arms cannot leak server state via `remote.error` | E2E + grep | `npx playwright test e2e/clideck-remote-deletion.spec.js` + `git grep -nE "remote-modal\|clideck-remote\|btn-remote\|version-remote\|remote\.(update\|error\|installing\|status\|pair\|unpair)" -- 'public/' '*.js' ':!CHANGELOG.md' ':!.planning/'` | ❌ W0 — new file `e2e/clideck-remote-deletion.spec.js` | ⬜ pending |
| R1 | Dashboard loads with no console errors after deletion | 1 | — | n/a | E2E (existing) | `npx playwright test e2e/smoke.spec.js` | ✅ exists (asserts `errors == []`) | ⬜ pending |
| R2 | Server `resize` is a no-op against mock pty | 2 | V5 | `sessions.resize({cols: huge, rows: huge})` cannot resize the PTY — DoS surface removed | unit (vitest) | `npx vitest run tests/sessions-resize.test.js` | ❌ W0 — new file `tests/sessions-resize.test.js` | ⬜ pending |
| R2 | `{type:'resize'}` WS message does NOT change PTY size | 2 | V5 | Malformed `resize` payload ignored server-side (defense-in-depth even with VPN model) | E2E | `npx playwright test e2e/pty-size-locked.spec.js` | ❌ W0 — new file `e2e/pty-size-locked.spec.js` | ⬜ pending |
| R3 | Tap on `.term-wrap` (mobile context) raises native soft keyboard via `.xterm-helper-textarea` | 3 | — | n/a | E2E (mobile context) | `npx playwright test e2e/mobile-touch.spec.js` | ❌ W0 — new file `e2e/mobile-touch.spec.js` (uses `browser.newContext({...devices['iPhone 12']})`) | ⬜ pending |
| R3 | Manual real-device verification (Android via LAN over `clideck-docker-lance`) | 3 | — | n/a | Manual | Document in `15-VERIFICATION.md` per D-14 / D-19 | — (manual) | ⬜ pending |
| R4 | Two browser contexts attach to same session — both inject input + both see both output streams | 4 | — | n/a (concurrent input is free-for-all per phase decision) | E2E (two-context) | `npx playwright test e2e/concurrent-input.spec.js` | ❌ W0 — new file `e2e/concurrent-input.spec.js` | ⬜ pending |
| R5 | `updateOtherClientIndicator(count)` toggles `.hidden` on every `.other-client-indicator` based on `count > 1` | 3 | — | n/a | unit (vitest + happy-dom) | `npx vitest run tests/other-client-indicator.test.js` | ❌ W0 — new file `tests/other-client-indicator.test.js` | ⬜ pending |
| R5 | Indicator visible on Tab A when Tab B connects, hidden when B disconnects | 4 | — | n/a | E2E (two-context) | `npx playwright test e2e/concurrent-input.spec.js` (shared file with R4) | ❌ W0 — covered by R4 file with additional assertions | ⬜ pending |
| R5 | New session rows added AFTER count crossed 2 still render with indicator visible (no construction-time regression — RESEARCH G9 risk) | 4 | — | n/a | unit (vitest + happy-dom) | Extends `tests/other-client-indicator.test.js` with a "row created while otherClientsConnected==true" case | ❌ W0 — same file as R5 toggle test | ⬜ pending |
| R6 | At 375×667 (iPhone 12), `document.body.scrollWidth === window.innerWidth` (no page-body horizontal scroll); sidebar toggle reachable | 3 | — | n/a | E2E (mobile context) | `npx playwright test e2e/mobile-viewport.spec.js` | ❌ W0 — new file `e2e/mobile-viewport.spec.js` | ⬜ pending |
| R6 | Walkthrough: load → switch session → tap terminal → open sidebar → close → create new session → delete | 3 | — | n/a | E2E (mobile context) | Same file as above with a sequential `test('walkthrough', …)` block | ❌ W0 — included in `e2e/mobile-viewport.spec.js` | ⬜ pending |
| R1+R5 | Indicator does NOT collide with unread-dot / working-indicator (Phase 5 mutex) | 4 | — | n/a | E2E (existing, extend) | `npx playwright test e2e/session-indicator-mutex.spec.js` (extend) | ✅ exists — extend with `.other-client-indicator` presence + slot-independence assertion | ⬜ pending |
| existing-no-regress | `tests/display-sizing.test.js:104–120` still passes (client still SENDS `resize`; only server response changes per D-05) | post-R2 | — | n/a | unit (vitest, existing) | `npx vitest run tests/display-sizing.test.js` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Tests authored before implementation (TDD per CLAUDE.md §2). Sequenced so the failing tests exist before the implementation tasks land.

- [ ] `tests/sessions-resize.test.js` — vitest unit, covers R2. Mocks `sessions.get(id)` returning a session with `pty.resize` spy; calls `sessions.resize({id, cols:40, rows:10})`; asserts `pty.resize` was NOT invoked. **WILL FAIL** until `sessions.js:368` body is replaced with a no-op.
- [ ] `tests/other-client-indicator.test.js` — vitest unit (happy-dom). Sets up two `.other-client-indicator` spans + state-flag plumbing; asserts `updateOtherClientIndicator(2)` removes `.hidden` from both; `updateOtherClientIndicator(1)` restores it. Also covers G9 risk: a row added when `state.otherClientsConnected==true` MUST render without `.hidden`. **WILL FAIL** until the helper is exported and the row template reads the flag.
- [ ] `e2e/clideck-remote-deletion.spec.js` — Playwright, covers R1. Asserts `#remote-modal`, `#btn-remote`, `#version-remote` absent from DOM. Asserts no `pageerror` / `console.error` during load. Asserts the post-deletion `git grep` returns zero (shell-exec inside `test.beforeAll`). **WILL FAIL** until all R1 deletions land.
- [ ] `e2e/pty-size-locked.spec.js` — Playwright, covers R2 end-to-end. Creates a session sized 120×30 from the desktop context; reads `term.cols` via xterm internals; sends a manual `{type:'resize', cols:40, rows:10}` over the WS; polls and asserts `term.cols === 120` after the no-op interval. **WILL FAIL** until R2 lands.
- [ ] `e2e/mobile-touch.spec.js` — Playwright with `browser.newContext({...devices['iPhone 12']})`. Verifies R3 — tap on `.term-wrap` focuses `.xterm-helper-textarea`. **WILL PASS or FAIL by environment** — verification path; if Chromium libs unavailable, defer to D-14 manual path.
- [ ] `e2e/concurrent-input.spec.js` — Playwright two-context. Verifies R4 (both clients see both inputs) and R5 (indicator visibility on Tab A when Tab B connects/disconnects). Cleanest two-context idiom: `browser.newContext()` × 2, each `.newPage()`, each `goto('/')`, then driver function for terminal input. **WILL FAIL** until R5 client-side wiring + R2 PTY lock land.
- [ ] `e2e/mobile-viewport.spec.js` — Playwright `devices['iPhone 12']` context. Asserts no page-body horizontal scroll at 375×667 + sequential walkthrough (load → switch session → tap terminal → open sidebar → close → create → delete). **WILL FAIL** until R6 CSS overflow + R1 deletion sweep complete.
- [ ] Extend `e2e/session-indicator-mutex.spec.js` (existing) — add assertion that `.other-client-indicator` lives in a different DOM slot than `.unread-dot` / `.session-status` and does NOT toggle either of those classes.
- [ ] No framework install needed — `vitest`, `happy-dom`, `@playwright/test` already in devDeps.
- [ ] No `vitest.config.*` needed — auto-detects.
- [ ] No `playwright.config.js` changes — per-test mobile contexts (Pattern A from RESEARCH §6) avoid project additions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native iOS / Android soft-keyboard raises on terminal tap | R3 / D-14 | Native soft-keyboard activation depends on real OS / mobile browser behaviour; Playwright mobile emulation can verify `.xterm-helper-textarea` receives focus but not the OS-level keyboard pop | (1) Bring up the dev container behind OpenVPN; (2) connect a real Android phone (Chrome Mobile) or iOS (Safari) to the dashboard URL on LAN; (3) tap the terminal pane; (4) confirm native soft keyboard raises; (5) type `echo hello` + Enter; (6) confirm output visible on phone AND a concurrently-attached desktop. Document result in `15-VERIFICATION.md`. **NOT a blocker** — Playwright `e2e/mobile-touch.spec.js` is the primary R3 gate per D-14. |
| Chromium library availability for Playwright runtime | (all E2E) | `clideck-docker/TEST-ENV-DEPS.md` notes sudo-gated Chromium libs in the local WSL dev env | If `npm run test:e2e` fails on missing Chromium host libs (`libnss3`, `libatk-bridge-2.0-0`, etc.), document in `15-VERIFICATION.md` per D-19 and defer execution to CI or a sudo-enabled host. The specs themselves still serve as a verifiable contract. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 new test files in §Wave 0 Requirements above)
- [ ] No watch-mode flags (all commands use `vitest run` / `playwright test`, no `--watch`)
- [ ] Feedback latency < 10s for unit per-commit cycle
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 fixtures + tests authored and the per-task verification map is populated by the planner

**Approval:** pending (filled by planner once PLAN.md files map every task to a row in §Per-Task Verification Map)
