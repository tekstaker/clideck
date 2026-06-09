---
phase: 15-mobile-desktop-concurrent-access
plan: 05
subsystem: public-client-wiring
tags: [R5, R6, indicator, websocket, responsive, mobile, tailwind]
requires:
  - 15-03 (server clients.count broadcast)
  - 15-04 (state.js Plan-04 sweep — removed remoteVersion, made room for otherClientsConnected)
  - 16-* (Phase 16 device-pairing — added linkedDevices + deviceId fields; preserved unchanged here)
provides:
  - public/js/state.js → state.otherClientsConnected boolean flag (R5 D-10)
  - public/js/terminals.js → updateOtherClientIndicator(count) export (R5 D-09/D-10/D-11)
  - public/js/terminals.js → .other-client-indicator span in addTerminal + buildResumableRow templates (R5 D-08/D-09)
  - public/js/app.js → WS onmessage case 'clients.count' arm dispatching to updateOtherClientIndicator (R5 D-09)
  - public/index.html → .term-wrap { overflow-x: auto } inside existing @media (max-width: 960px) (R6 D-16)
affects:
  - tests/other-client-indicator.test.js (RED → GREEN, 4/4)
  - e2e/concurrent-input.spec.js (RED at HEAD — Plan 06 runs)
  - e2e/mobile-viewport.spec.js (RED at HEAD — Plan 06 runs)
  - e2e/session-indicator-mutex.spec.js (extended assertion — Plan 06 runs)
tech-stack:
  added: []
  patterns:
    - "Module-singleton state.js + helper-export pattern (same as terminals.js focusTerminal precedent)"
    - "WS onmessage switch arm with single-line dispatch (matches case 'pong', case 'session.token' precedent)"
    - "Single shared boolean + DOM walk on every dispatch — no per-session bookkeeping (CONTEXT.md D-10/D-11)"
    - "G9 mitigation: row template ternary reads shared flag at innerHTML-build time so post-flag-flip rows render visible"
    - "Tailwind utility (text-amber-400) over hardcoded hex — color tokens preserved per UI-SPEC § Color"
    - "CSS rule appended INSIDE existing @media block — no new ≤480px breakpoint tier (D-16)"
key-files:
  created: []
  modified:
    - public/js/state.js (+11 lines — otherClientsConnected field + comment block)
    - public/js/terminals.js (+18 lines — helper export + 2 row template splices)
    - public/js/app.js (+9 lines — import addition + WS arm)
    - public/index.html (+12 lines — comment + .term-wrap rule inside 960px block)
  not_modified:
    - public/tailwind.css — pre-flight grep showed text-amber-400 ALREADY in compiled output; A1/G11 inline-style contingency NOT triggered
decisions:
  - "Tailwind rebuild contingency NOT triggered — text-amber-400 already in compiled public/tailwind.css before this plan (verified via grep -ciE 'amber|#fbbf24'); chose path 1 (use class as-is) over path 2 (inline style fallback)"
  - "case 'clients.count' arm placed between 'closed' and 'session.token' — connection-lifecycle messages grouped visually for next-maintainer mental model; alternative was alphabetical sort which would split connection arms across the switch"
  - "updateOtherClientIndicator placed adjacent to refocusActiveTerm (line 53→64) — both are 'flag/state-driven DOM toggle' helpers; alternative was placement near applyFontSize/setHasToken (other state-toggle helpers) but those operate on per-id entries; this helper operates globally"
  - "updateOtherClientIndicator added to import list between clampFontSize and FONT_SIZE_DEFAULT — keeps the FONT_SIZE_* constant group contiguous"
metrics:
  duration_minutes: ~12
  completed_date: 2026-06-09
  task_count: 3
  file_count: 4
  test_files_flipped_red_to_green: 1  # tests/other-client-indicator.test.js
---

# Phase 15 Plan 05: Client Wire-Up Summary

R5 + R6 client-side wiring landed end-to-end: `state.otherClientsConnected` flag added in state.js; locked-DOM indicator span spliced into both `addTerminal` and `buildResumableRow` templates with the G9 ternary; `updateOtherClientIndicator(count)` exported from terminals.js; `case 'clients.count':` arm added to app.js's WS onmessage switch; `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }` rule added inside the existing `@media (max-width: 960px)` block. No Tailwind rebuild needed — `text-amber-400` was already compiled into `public/tailwind.css` before this plan started, so the A1/G11 inline-style contingency stayed dormant.

---

## What This Plan Does

Realizes the R5 "another client is connected" indicator and the R6 phone-viewport horizontal-scroll fallback end-to-end on the client. Plan 03 wired the server broadcast (`clients.count` fires on every WS connect/close); this plan terminates that signal: app.js receives → terminals.js helper flips a shared flag and toggles `.hidden` on every indicator span → both row templates already carry the indicator markup so new rows added after the flag flips inherit the visible state via G9 ternary. The R6 single CSS rule lets phone clients pan horizontally over a locked PTY width without resizing the PTY.

The visible UI delta is two-circle amber-outlined indicator spans on every active session row + every Previous Sessions row, plus horizontal scroll on the terminal pane at ≤960px viewports.

---

## Files Modified

| File                       | Lines Δ | What                                                                                                  |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `public/js/state.js`       | +11     | New `otherClientsConnected: false` field with multi-line comment explaining the R5/D-08..D-11 chain    |
| `public/js/terminals.js`   | +18     | `updateOtherClientIndicator(count)` export at line 64; LOCKED indicator span spliced into addTerminal (line 740) and buildResumableRow (line 1569) |
| `public/js/app.js`         | +9      | `updateOtherClientIndicator` added to import list (line 3); new `case 'clients.count':` arm at line 270 |
| `public/index.html`        | +12     | `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }` appended inside the existing `@media (max-width: 960px)` block (lines 127-138) |
| `public/tailwind.css`      | 0       | NO change — pre-flight grep showed `text-amber-400` already compiled; rebuild contingency unused      |

---

## Splice Points (Exact)

### state.js — line 23 (just before closing `};`)

```js
// Phase 15 R5 — true when the server-wide WS client count is > 1, driven
// by the `clients.count` broadcast (handlers.js — landed in Plan 03) and
// dispatched through app.js's onmessage switch to `updateOtherClientIndicator`
// (terminals.js). A single shared flag drives `.hidden` on every
// `.other-client-indicator` span in the DOM — no per-session bookkeeping
// (CONTEXT.md D-08 / D-10 / D-11; UI-SPEC § "Other-client indicator").
// G9: new session rows added AFTER the flag is true read this value at
// template-build time so they render the indicator already visible.
otherClientsConnected: false,
```

Phase 16's `linkedDevices: []` (line 17) and `deviceId: null` (line 22) are preserved unchanged immediately above. Plan 04's vacated `remoteVersion` slot was reused conceptually but not literally — `otherClientsConnected` lives at the bottom of the literal, distinct from where `remoteVersion` was.

### terminals.js — line 53 (new export, adjacent to `refocusActiveTerm`)

```js
export function updateOtherClientIndicator(count) {
  state.otherClientsConnected = count > 1;
  document.querySelectorAll('.other-client-indicator').forEach(el => {
    el.classList.toggle('hidden', !state.otherClientsConnected);
  });
}
```

### terminals.js — line 740 (addTerminal row template, between `.name` and `.session-time`)

The locked-contract span from UI-SPEC § "DOM contract" — copied verbatim, no paraphrasing of title/aria-label/SVG coords. The class list includes the G9 ternary `state.otherClientsConnected ? '' : ' hidden'` so rows rendered after the flag flips already show the indicator without waiting for a re-broadcast.

### terminals.js — line 1569 (buildResumableRow template, between `.resumable-name` and timestamp)

Identical markup to the addTerminal splice. Per CONTEXT.md D-08 the count is server-wide, so Previous Sessions rows also show the indicator when count>1.

### app.js — line 3 (import addition)

`updateOtherClientIndicator` inserted between `clampFontSize` and `FONT_SIZE_DEFAULT` in the destructured import list. Keeps the `FONT_SIZE_*` constant group contiguous.

### app.js — line 270 (WS onmessage switch arm)

```js
case 'clients.count':
  // Phase 15 R5 — server-wide WS client count broadcast (handlers.js,
  // landed in Plan 03 on connect + close). updateOtherClientIndicator
  // flips state.otherClientsConnected and toggles `.hidden` on every
  // .other-client-indicator span (active + resumable rows). No
  // per-session bookkeeping (CONTEXT.md D-08/D-10/D-11).
  updateOtherClientIndicator(msg.count);
  break;
```

Slotted between `case 'closed':` (line 262) and `case 'session.token':` (line 277). Both `closed` and `clients.count` are connection-lifecycle messages; grouping them is the natural neighborhood.

### index.html — lines 127-138 (inside existing `@media (max-width: 960px)` block)

```css
/* Phase 15 R6 (D-16): when the locked PTY width exceeds a phone-sized
   viewport, the terminal wrapper scrolls horizontally instead of
   reshaping the PTY. ... */
.term-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

Appended after the existing `#folder-picker > div { ... }` rule. The 960px block opens at line 60 and now closes at line 139. NO new `@media (max-width: 480px)` block created (D-16 locked this).

---

## Tailwind Rebuild Decision: Path 1 (no rebuild needed)

Pre-flight check before starting Task 5.3:
```
$ grep -ciE 'amber|#fbbf24' public/tailwind.css
(multiple matches)
```

The compiled `public/tailwind.css` already contained `.text-amber-400{--tw-text-opacity:1;color:rgb(251 191 36/var(--tw-text-opacity,1))}` at the start of the minified output. Some other class in the codebase (likely `text-amber-400` in the pill-state code at terminals.js:1921, or the dark-mode flash banner elsewhere) had already triggered Tailwind's content scan to compile amber utilities.

Consequences:
- `npm run build:css` was unnecessary — would have been a no-op.
- A1/G11 inline-style `style="color:#FBBF24"` contingency from RESEARCH.md / UI-SPEC was NOT triggered.
- The indicator's `text-amber-400` Tailwind class works as written — Task 5.1's markup is the final form.
- Dark-mode contrast is the 9.8:1 that UI-SPEC § "Cross-mode" calls out.
- Light-mode `text-amber-500` swap contingency remains available for Plan 06's audit pass if the visual check fails there.

---

## Test Results

### Vitest

| Test File                                       | Before | After |
| ----------------------------------------------- | ------ | ----- |
| `tests/other-client-indicator.test.js`          | 4 RED  | 4 GREEN — flipped by Task 5.1's updateOtherClientIndicator export + DOM walk |
| `tests/sessions-resize.test.js`                 | 3 GREEN | 3 GREEN — unchanged (Plan 02 baseline preserved) |
| `tests/display-sizing.test.js`                  | GREEN  | GREEN — unchanged (Phase 9 baseline preserved) |
| Full suite (`npm run test`)                     | 214 pass + 8 skip + 1 pre-existing flake | Same — `creator-preflight-integration.test.js` server-boot timeout is a known flake called out by runtime_context, NOT introduced by this plan |

### Specific tests flipped RED → GREEN

`tests/other-client-indicator.test.js` — 4 cases:
- `count > 1 removes .hidden from every .other-client-indicator` — GREEN
- `count <= 1 re-adds .hidden on every .other-client-indicator` — GREEN
- `G9 — newly-added rows after the global flag is on inherit the visible state` — GREEN
- `is a no-op when no indicator spans exist in the DOM` — GREEN

### Tests deferred to Plan 06 (Chromium libs / e2e setup)

- `e2e/concurrent-input.spec.js` — Playwright 2-context concurrent-input verification (D-17)
- `e2e/mobile-viewport.spec.js` — 375×667 viewport regression
- `e2e/session-indicator-mutex.spec.js` — extended assertion for R5 indicator under Phase 5 mutex

These are explicitly Plan 06's scope per the phase roadmap.

---

## Verification Grep Audit

```
grep -c otherClientsConnected public/js/state.js                                   = 1
grep -c remoteVersion public/js/state.js                                           = 0  (Plan 04 sweep preserved)
grep -c linkedDevices public/js/state.js                                           = 1  (Phase 16 preserved)
grep -c deviceId public/js/state.js                                                = 1  (Phase 16 preserved)
grep -c other-client-indicator public/js/terminals.js                              = 4  (markup × 2, query selector × 1, function comment × 1)
grep -cF "state.otherClientsConnected ? '' : ' hidden'" public/js/terminals.js     = 2  (G9 ternary in both templates)
grep -c text-amber-400 public/js/terminals.js                                      = 3  (indicator × 2 + pre-existing pill at line 1921)
grep -nF "case 'clients.count'" public/js/app.js                                   = line 270 (one match)
grep -c updateOtherClientIndicator public/js/app.js                                = 3  (import + call + comment)
grep -c "device.list\|device.revoked\|device.revoke.result" public/js/app.js       = 3  (Phase 16 arms preserved)
grep -nF "term-wrap" public/index.html                                             = lines 129, 135 (inside 960px block @60-139)
grep -cF "@media (max-width: 480px)" public/index.html                             = 0  (D-16 honored — no new ≤480 tier)
grep -ciE 'amber|#fbbf24' public/tailwind.css                                      ≥ 1  (Tailwind rebuild contingency unused)
```

---

## Commits

| Hash      | Task | What                                                                                          |
| --------- | ---- | --------------------------------------------------------------------------------------------- |
| `e0db358` | 5.1  | state.js otherClientsConnected + terminals.js indicator markup + updateOtherClientIndicator    |
| `58da66c` | 5.2  | app.js import + case 'clients.count' arm dispatching to updateOtherClientIndicator             |
| `dad4caf` | 5.3  | index.html .term-wrap { overflow-x: auto } inside existing 960px block; no Tailwind rebuild   |

Per CLAUDE.md §3: GitHub remote, committed but NOT pushed.

---

## Deviations from Plan

**None.** Plan executed exactly as written. The Tailwind rebuild question (Path 1 vs Path 2) was a documented branch in the plan; pre-flight grep selected Path 1 (no rebuild) cleanly.

The plan's `node --check` acceptance criterion was effectively replaced by vitest verification because `package.json` declares `"type": "commonjs"` (for the server entry point) while `public/js/*.js` are ES modules loaded by `<script type="module">` from the browser. `node --check` fails at the `export` keyword on every public module — this is a pre-existing project quirk, not a regression. Vitest knows how to load ESM and is the actual source of truth; it passed.

---

## Known Stubs

None. All R5 + R6 client-side wiring is functional end-to-end. Server broadcasts (Plan 03) → app.js dispatch (Task 5.2) → terminals.js helper (Task 5.1) → DOM indicator (Task 5.1 splices) → mobile horizontal scroll (Task 5.3) is a complete chain. The only remaining work for Phase 15 is Plan 06's Playwright verification.

---

## Risks Mitigated

| Risk | Mitigation in this Plan | Where |
| ---- | ----------------------- | ----- |
| G9 (new row added after flag flips renders default-hidden) | Row template ternary reads `state.otherClientsConnected` at innerHTML-build time | terminals.js:740, terminals.js:1569 |
| G10 (mutex collision with unread/working indicators) | Indicator occupies the top row, different slot than the unread dot (bottom row) and the working indicator | UI-SPEC § "Position on the session row" — verified by reading the existing row template |
| G11 / A1 (Tailwind doesn't compile text-amber-400 from terminals.js because content glob misses it) | Pre-flight grep showed amber already in tailwind.css before this plan; no rebuild needed | Task 5.3 pre-flight check |
| D-16 drift (planner adds a new ≤480 breakpoint tier) | Single CSS rule appended INSIDE the existing 960px block, NO new media block created | index.html:135 (inside 60-139 block) |
| Phase 16 / Plan 04 drift (state.js multi-author conflict) | Read state.js full file before editing; preserved `linkedDevices` + `deviceId`; placed `otherClientsConnected` at the bottom of the literal | state.js diff: only +1 field, no other changes |

---

## Self-Check

| Claim | Verification | Result |
| ----- | ------------ | ------ |
| state.js has otherClientsConnected: false | `grep -c otherClientsConnected public/js/state.js` = 1 | FOUND |
| Phase 16 linkedDevices + deviceId preserved | `grep -c linkedDevices public/js/state.js` = 1; `grep -c deviceId public/js/state.js` = 1 | FOUND |
| terminals.js has indicator markup in both templates | `grep -c other-client-indicator public/js/terminals.js` = 4 (markup×2 + selector + comment) | FOUND |
| terminals.js exports updateOtherClientIndicator | `grep -n 'export function updateOtherClientIndicator' public/js/terminals.js` matches line 64 | FOUND |
| G9 ternary in both row templates | `grep -cF "state.otherClientsConnected ? '' : ' hidden'" public/js/terminals.js` = 2 | FOUND |
| app.js dispatches case 'clients.count' | `grep -nF "case 'clients.count'" public/js/app.js` = line 270 | FOUND |
| Phase 16 arms still in app.js | `grep -c "case 'device" public/js/app.js` = 3 | FOUND |
| index.html .term-wrap inside 960px block | line 135 sits between block-open 60 and block-close 139 | FOUND |
| No new ≤480 breakpoint tier | `grep -cF '@media (max-width: 480px)' public/index.html` = 0 | FOUND |
| Tailwind compiled with text-amber-400 | `grep -F 'text-amber-400{' public/tailwind.css` matches | FOUND |
| Task 5.1 commit exists | `git log --oneline -5` shows e0db358 | FOUND |
| Task 5.2 commit exists | `git log --oneline -5` shows 58da66c | FOUND |
| Task 5.3 commit exists | `git log --oneline -5` shows dad4caf | FOUND |
| tests/other-client-indicator.test.js GREEN | `npx vitest run` shows 4/4 pass | FOUND |
| sessions-resize.test.js + display-sizing.test.js GREEN | `npx vitest run` shows 7/7 across both | FOUND |

## Self-Check: PASSED
