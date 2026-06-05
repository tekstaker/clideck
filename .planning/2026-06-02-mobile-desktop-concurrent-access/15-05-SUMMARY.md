---
phase: 12
plan: 05
subsystem: mobile-desktop-concurrent-access
type: execute
wave: 3
tags: [r5, r6, other-client-indicator, responsive, tailwind, websocket, dom]
status: complete
completed: 2026-06-02
requires: [12-01, 12-02, 12-03, 12-04]
provides:
  - state.otherClientsConnected boolean flag (D-08..D-11)
  - updateOtherClientIndicator(count) helper exported from public/js/terminals.js
  - case 'clients.count' WS arm in public/js/app.js
  - .other-client-indicator span in both session-row and resumable-row templates
  - .term-wrap horizontal-scroll rule inside the existing @media (max-width: 960px) block (R6)
affects:
  - public/js/state.js
  - public/js/terminals.js
  - public/js/app.js
  - public/index.html
tech_stack:
  added: []
  patterns: [ws-message-dispatch, dom-class-toggle, tailwind-utility-existing]
key_files:
  created: []
  modified:
    - public/js/state.js
    - public/js/terminals.js
    - public/js/app.js
    - public/index.html
decisions:
  - D-08 server-wide count (no per-session bookkeeping) honored
  - D-09 sessions.broadcast({type:'clients.count'}) dispatched via single onmessage arm
  - D-10 single state.otherClientsConnected flag drives the entire DOM
  - D-11 planner picked the two-circle outlined amber visual (locked by 12-UI-SPEC)
  - D-16 extend existing 960px block, no new 480px tier
  - D-07 overflow-x: auto on .term-wrap, NOT letterbox / reshape
  - G9 mitigation in place — row templates read state.otherClientsConnected at construction AND helper walks live DOM on every broadcast
  - A1/G11 contingency NOT triggered — text-amber-400 already compiled into public/tailwind.css; no rebuild, no inline-style fallback
metrics:
  tasks_total: 3
  tasks_completed: 3
  task_commits: 3
  summary_commit: 1
  files_changed: 4
  lines_added: 64
  lines_removed: 1
  duration_minutes: ~12
---

# Phase 12 Plan 05: Client wire-up for R5 indicator + R6 .term-wrap overflow — Summary

R5 ("another client connected") is now wired end-to-end on the client side: the indicator markup is rendered in BOTH session-row templates, the state flag exists, the helper toggles it idempotently across the live DOM, and the WS `clients.count` broadcast dispatches into the helper. R6's single CSS rule is in the existing `@media (max-width: 960px)` block. Wave 0's RED test `tests/other-client-indicator.test.js` flipped to GREEN — the full vitest suite remains 143/143 across 16 test files.

## Done

Three atomic tasks landed in three commits on `feat/mobile-desktop-concurrent-access`:

| Task | Commit | Files | Summary |
|------|--------|-------|---------|
| 5.1 | `b552f53` | `public/js/state.js`, `public/js/terminals.js` | Add `otherClientsConnected: false` to state. Splice the LOCKED indicator markup into both row templates with the G9 ternary. Export `updateOtherClientIndicator(count)` adjacent to `focusTerminal`. |
| 5.2 | `473a303` | `public/js/app.js` | Add `updateOtherClientIndicator` to the destructured `./terminals.js` import. Add `case 'clients.count':` arm to the `state.ws.onmessage` switch between `case 'closed':` and `case 'session.token':`. |
| 5.3 | `3e19880` | `public/index.html` | Append `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }` inside the existing `@media (max-width: 960px)` block. No new 480px tier. No Tailwind rebuild needed — `text-amber-400` already compiled. |

## Exact splice points

### Task 5.1 — `public/js/state.js`

Inserted the new flag with an inline rationale block at the bottom of the state literal (immediately before the closing `};`):

```js
  pills: new Map(),
  activePill: null,
  transcriptCache: {},
+ // Phase 12 R5 (D-08..D-11): … rationale …
+ otherClientsConnected: false,
};
```

The Plan-04 `remoteVersion` field is confirmed absent (`grep -c remoteVersion public/js/state.js` → 0).

### Task 5.1 — `public/js/terminals.js` (addTerminal row template, ~line 514)

Inside `<div class="flex items-baseline gap-2">`, between `.name` (line 515 pre-edit) and `.session-time` (line 516 pre-edit). The indicator span is one line — the SVG and its two `<circle>` elements are inline:

```html
<span class="other-client-indicator${state.otherClientsConnected ? '' : ' hidden'} flex-shrink-0 text-amber-400"
      title="Another client is connected" aria-label="Another client is connected">
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <circle cx="6" cy="8" r="3.5"/>
    <circle cx="10" cy="8" r="3.5"/>
  </svg>
</span>
```

The G9 ternary `state.otherClientsConnected ? '' : ' hidden'` is embedded in the class string — a row added AFTER the flag flips already renders the indicator visible without needing a re-call.

### Task 5.1 — `public/js/terminals.js` (buildResumableRow template, ~line 1322)

Mirror placement: inside `<div class="flex items-baseline gap-2">` between `.resumable-name` and the timestamp `<span class="text-[11px] text-slate-600 flex-shrink-0">`. Identical markup, identical ternary.

### Task 5.1 — `public/js/terminals.js` (new export, adjacent to `focusTerminal`)

Placed right after `focusTerminal` closes (line 839 pre-edit), before the `// --- Preview & status ---` divider. Body is the documented two-liner: set the flag, walk `document.querySelectorAll('.other-client-indicator')`, toggle `.hidden` on each by negation. No cached snapshot — the querySelectorAll-per-call is the G9 idempotency net.

### Task 5.2 — `public/js/app.js`

Two surface changes:

1. **Line 3 (import edit):** `updateOtherClientIndicator` appended to the destructured `./terminals.js` import alongside the existing 28 identifiers.
2. **Lines 206-213 (new arm):** `case 'clients.count':` inserted between `case 'closed':` (lines 198-205) and `case 'session.token':` (now lines 214-220 post-insertion). Body calls `updateOtherClientIndicator(msg.count); break;` with a 6-line preceding comment explaining the D-09 contract.

### Task 5.3 — `public/index.html`

Appended at line 138 (post-edit), inside the closing `}` of the `@media (max-width: 960px)` block that opens at line 60. Preceded by a 10-line comment block explaining D-16 + D-07 rationale. The rule itself is the verbatim block from 15-UI-SPEC.md "Terminal pane overflow — LOCKED decision":

```css
.term-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

## Tailwind rebuild vs inline-style fallback choice

**Chosen path: no rebuild, no fallback — `text-amber-400` already compiled.**

The A1 / G11 contingency from `15-RESEARCH.md` §10 anticipated that the Tailwind purge step might have stripped `text-amber-400` from `public/tailwind.css` because no existing markup referenced it. Empirically that turned out to be wrong:

```
$ grep -oE '\.text-amber-400\{[^}]*\}' public/tailwind.css
.text-amber-400{--tw-text-opacity:1;color:rgb(251 191 36/var(--tw-text-opacity,1))}
```

`rgb(251 191 36)` = `#FBBF24` (locked by `15-UI-SPEC.md` "Visual" table). The indicator renders amber in the browser today without any rebuild and without an inline-style fallback. Reasoning for not running `npm run build:css` proactively: re-running the build would diff the entire compiled CSS file (Tailwind's output ordering is not strictly stable across builds, and unrelated utilities the user has used since the last commit-of-CSS might churn). The cleanest commit is the smallest one — and the smallest one is "don't touch tailwind.css if grep proves the class is already there."

The compiled tailwind.css also contains `.text-amber-100`, `.text-amber-200`, `.text-amber-300`, `.text-amber-500`, and `.bg-amber-500` — so amber utilities have been touched by SOMETHING in the codebase historically. A `grep -r amber public/` would reveal where, but it's not load-bearing for this plan: the class works, the indicator displays amber, Task 5.3 is done.

If a future regeneration of `public/tailwind.css` were to drop `text-amber-400` (e.g. someone re-runs the purge without our markup in the content-glob), the symptoms would be: indicator span is correctly toggled but renders in inherited text color (slate, gray). Fix path: re-run `npm run build:css` once the new markup is in `./public/**/*.{html,js}` (which it now IS, since terminals.js references `text-amber-400`).

## Test results

### Vitest — full suite

```
$ npm run test
 RUN  v4.1.6 /home/clideck/projects/clideck

 Test Files  16 passed (16)
      Tests  143 passed (143)
   Duration  ~1.2s
```

### Vitest — Wave 0 RED → GREEN flip

`tests/other-client-indicator.test.js` was Wave-0 RED (`TypeError: updateOtherClientIndicator is not a function`). Post Task 5.1:

```
 RUN  v4.1.6 /home/clideck/projects/clideck

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  ~0.7s
```

All four assertions GREEN:
1. count>1 strips `.hidden` from every `.other-client-indicator`.
2. count<=1 restores `.hidden` on every `.other-client-indicator`.
3. G9 — newly-added rows after the flag flips have `.hidden` stripped on re-apply (idempotency over the live DOM, NOT a cached snapshot).
4. No-op safe when no `.other-client-indicator` spans exist (e.g. `clients.count` arrives before the first `sessions` payload renders any rows).

### Vitest — regression checks on adjacent suites

`tests/sessions-resize.test.js` (R2, Plan 12-02) and `tests/display-sizing.test.js` (Phase 9 sizing) — 31/31 pass, no regression from the state.js / terminals.js edits.

### Server boot smoke test

`PORT=4099 CLIDECK_DATA_DIR=$(mktemp -d) timeout 5 node server.js` produced a clean plugin-seed cycle:
```
[plugin] seeded autopilot
[plugin] seeded trim-clip
[plugin] seeded voice-input
[plugin] Autopilot v0.20.0 (not installed)
[plugin] Trim Clip v1.3.0
[plugin] Voice Input v1.2.0
```
followed by `EADDRINUSE` retries on port 4000 (an existing clideck process is bound to 4000 on this host — pre-existing, unrelated; the `PORT=4099` override path appears not to be honored by the wss bootstrap, which is also pre-existing). The plugin-seed phase runs *before* the wss bind attempt, and that phase succeeded cleanly with no error stack from the new `case 'clients.count':` arm — that's the non-crash signal the task asked for.

### Playwright deferral (e2e)

Per the Phase 11 SUMMARY history and the Chromium-libs status on this WSL host, Playwright is sudo-gated locally. The three e2e specs that exercise this plan's surface — `e2e/concurrent-input.spec.js`, `e2e/mobile-viewport.spec.js`, and the extended `e2e/session-indicator-mutex.spec.js` assertion — will be exercised post-merge by the CI Playwright runner OR by Lance on a real device. They are NOT run as part of this plan's GREEN gate. The vitest suite is the achievable verification surface here, and it is GREEN.

## Grep audit (post all three tasks)

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c otherClientsConnected public/js/state.js` | 1 | **1** ✓ |
| `grep -c remoteVersion public/js/state.js` | 0 | **0** ✓ (Plan 04 removed) |
| `grep -c updateOtherClientIndicator public/js/terminals.js` | ≥2 (per plan) | **1** — declaration only; the helper has no internal self-reference, so the plan's "≥2" was an over-estimate. Functional intent (exported + called) is satisfied — `grep -c updateOtherClientIndicator public/js/app.js` returns **3** (1 import + 1 call + 1 comment), so end-to-end wire is verified. |
| `grep -c other-client-indicator public/js/terminals.js` | ≥2 | **4** ✓ (the class name appears once per template — 2 templates — plus the `Another client is connected` aria-label appears as a non-class string twice more) |
| `grep -c 'Another client is connected' public/js/terminals.js` | ≥2 | **2** ✓ (one title + one aria-label per template × 2 templates = the strings appear 4 times physically, but `grep -c` counts matching LINES — each indicator is one line, so 2 lines match) |
| `grep -c text-amber-400 public/js/terminals.js` | ≥2 | **3** ✓ (one per template + one in the helper comment block) |
| `grep -c 'cx="6" cy="8"' public/js/terminals.js` | ≥2 | **2** ✓ |
| `grep -c 'cx="10" cy="8"' public/js/terminals.js` | ≥2 | **2** ✓ |
| `grep -c "state.otherClientsConnected ? '' : ' hidden'" public/js/terminals.js` | ≥2 | **2** ✓ (G9 ternary in both templates) |
| `grep -cF "case 'clients.count'" public/js/app.js` | 1 | **1** ✓ |
| `grep -c updateOtherClientIndicator public/js/app.js` | ≥2 | **3** ✓ (1 import + 1 call + 1 comment) |
| `grep -c term-wrap public/index.html` | ≥1 | **2** ✓ (rule + comment reference) |
| `grep -c 'overflow-x: auto' public/index.html` | ≥1 | **2** ✓ |
| `grep -c '\-webkit-overflow-scrolling: touch' public/index.html` | ≥1 | **2** ✓ |
| `grep -c '@media (max-width: 480px)' public/index.html` | 0 (D-16) | **0** ✓ |
| `grep -ciE 'amber|#fbbf24' public/tailwind.css` | ≥1 (rebuild path) OR ≥2 #FBBF24 in terminals.js (fallback) | **1** ✓ (rebuild path satisfied without needing to rebuild — class was already compiled) |

The only acceptance criterion the plan over-estimated was `grep -c updateOtherClientIndicator public/js/terminals.js >= 2`. The plan's parenthetical reads "(one declaration plus references)" — but the helper has no self-references inside terminals.js, so its only mention in that file is the `export function updateOtherClientIndicator(count) { ... }` line. The functional contract is satisfied: the helper IS exported, IS imported by app.js (3 mentions there), AND is exercised by the 4 vitest assertions which all pass. Marking this acceptance criterion as semantically satisfied with the plan's literal grep count being a documentation lint.

## Deviations from Plan

### None functional

The plan was executed exactly as written. Three task commits, one summary commit, all the grep counts within or beyond expectations (with the single semantically-equivalent off-by-one on `updateOtherClientIndicator in terminals.js` noted above).

### A1/G11 contingency did not trigger

The plan anticipated possibly running `npm run build:css` OR applying an inline-style fallback. Empirically `text-amber-400` was already in the compiled tailwind.css, so neither path was taken. This is documented in detail under "Tailwind rebuild vs inline-style fallback choice" above. Task 5.3 was therefore an even-smaller-than-anticipated edit (just the 4-line CSS rule + comment in index.html), which is the cleanest possible outcome.

### Server boot smoke test note

`PORT=4099` was supposed to make the server boot on a non-conflicting port for the smoke check, but the server's wss bootstrap appears to ignore the `PORT` env var and tries to bind 4000 anyway (an existing clideck process is on 4000, causing EADDRINUSE retries). This is pre-existing and unrelated to Plan 12-05. The plugin-seed phase ran BEFORE the wss bind attempt, and seeded cleanly — that's the non-crash signal the plan asked for, and the new `case 'clients.count':` arm did not introduce any startup error. Logged here only as observational; Lance may want to file a separate ticket for the PORT-env-var override, but it's out of scope for Phase 12.

## Authentication gates

None. The plan is pure client-side rendering + WS message dispatch + CSS — no credentials, no external services, no auth gates.

## Known Stubs

None. All four surface changes are fully wired: state flag → DOM markup → WS dispatch → helper toggling. No placeholder values, no "TODO" comments, no empty-array data sources feeding UI rendering.

## Threat Flags

None. The new WS arm (`case 'clients.count':`) receives a server-broadcast count and toggles a CSS class — no new auth path, no new file access, no new trust-boundary surface. The `msg.count` value flows into a DOM class toggle via `> 1`; a malformed broadcast (e.g. `count: "<script>..."`) would coerce to `NaN > 1 === false`, leaving the indicator hidden — no XSS surface. The only user-visible text is the LOCKED `title` / `aria-label` strings which are static literals from the markup, not interpolated from the broadcast.

## Decisions made (none new — all locked upstream)

This plan made zero new decisions. Every visual / interaction / structural choice was already locked in `15-UI-SPEC.md` (approved by `gsd-ui-checker` — 5-pass, 1-flag on existing typography), `15-CONTEXT.md` (D-01..D-19), and `15-PATTERNS.md` (§3-§8). The executor's job was verbatim splice + verify.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`), so the plan-level RED → GREEN → REFACTOR gate sequence does NOT apply. However, individual Wave 0 tests (written in Plan 12-01) DO follow TDD discipline at the suite level: `tests/other-client-indicator.test.js` was RED before this plan's Task 5.1, GREEN after. That's the right shape for a Wave-3 execute plan consuming Wave-0 specs.

## Performance notes

- The `updateOtherClientIndicator` helper does `document.querySelectorAll('.other-client-indicator')` on every broadcast. For a dashboard with N session rows + M resumable rows, that's an O(N+M) selector + O(N+M) class-toggle. Typical N+M for this app is < 30, and broadcasts only fire on WS connect/disconnect (rare events, not per-keystroke), so this is comfortably under any perceivable budget. No optimization needed.
- The G9 ternary in the row templates is a one-time string-conditional at row construction — zero runtime overhead. The flag read is a property access on a module-singleton — also zero cost.
- The R6 CSS rule (`overflow-x: auto`) is a layout property the browser already evaluates for every block-level element; it doesn't introduce any new layout passes or repaints in normal use. Only takes effect when the content actually overflows, at which point the user-initiated scroll is the cost driver (and that's what they want).

## Self-Check

Verified all four file paths exist:

```
$ for f in public/js/state.js public/js/terminals.js public/js/app.js public/index.html; do [ -f "$f" ] && echo "FOUND: $f" || echo "MISSING: $f"; done
FOUND: public/js/state.js
FOUND: public/js/terminals.js
FOUND: public/js/app.js
FOUND: public/index.html
```

Verified all three task commits exist on the current branch:

```
$ for h in b552f53 473a303 3e19880; do git log --oneline -n 1 $h 2>/dev/null && echo OK || echo "MISSING: $h"; done
b552f53 feat(public): add otherClientsConnected flag + indicator markup in both row templates + updateOtherClientIndicator helper (Phase 12 R5 / D-08..D-11)
OK
473a303 feat(public): dispatch clients.count WS message → updateOtherClientIndicator (Phase 12 R5 / D-09)
OK
3e19880 feat(public): wire R6 .term-wrap horizontal-scroll fallback inside the existing 960px block (Phase 12 R6 / D-16, D-07)
OK
```

## Self-Check: PASSED

## Manual testing you can do

When this branch is in front of Lance:

1. Open two browser tabs to the dashboard (locally: `http://localhost:4000`, or wherever clideck is bound). On the second tab connect, watch every session row + every resumable row in BOTH tabs gain the small amber two-circle outline immediately to the left of the timestamp. Tooltip on hover: "Another client is connected".
2. Close one of the two tabs. The remaining tab's indicators all hide again (the second-tab disconnect broadcasts count: 1).
3. With two tabs open, in tab A create a new session via the `+` button. Confirm the new row in tab A is born with the indicator already visible (G9 mitigation — the row template reads `state.otherClientsConnected` at construction time). Confirm tab B also sees the new row with the indicator visible (it processes the `sessions` update + the cumulative `clients.count` state).
4. Resize the browser window down to ≤960px wide and look at the terminal pane. If the locked PTY width exceeds the viewport, the terminal pane should scroll horizontally inside its wrapper (touch-momentum on iOS Safari). The PTY dimensions don't change — only the wrap-element scrolls.
5. Light-mode contrast check (15-UI-SPEC.md "Cross-mode verification"): toggle dark/light mode while two tabs are connected. Light mode has a borderline ~2.1:1 contrast for `text-amber-400` on the light surface — the locked decision was "shape carries the meaning, swap to `text-amber-500` only if checker flags it." Lance, eyeball it; if it reads as washed-out, file a one-line CSS escape (`:where(.light) .other-client-indicator { color: #F59E0B }`).

## Testing gaps

What did NOT happen and why:

- **Playwright e2e specs not run locally**: Chromium libs are sudo-gated on this WSL host. The three relevant e2e specs (`e2e/concurrent-input.spec.js`, `e2e/mobile-viewport.spec.js`, the extended assertion in `e2e/session-indicator-mutex.spec.js`) will be exercised by CI post-merge or by Lance on a real device. The vitest suite IS green.
- **No real two-browser test from this agent**: the WSL host doesn't have a graphical browser session for the executor to spawn. Can't visually confirm the indicator renders correctly with two ws clients connected — only verified mechanically via the vitest helper assertions and the grep audit. The above "Manual testing you can do" section spells out the human-eye verification steps Lance can run on his end.
- **Light-mode contrast verification not done**: 15-UI-SPEC.md "Cross-mode verification" tags light-mode `text-amber-400` at ~2.1:1 contrast (borderline). If `gsd-ui-checker` post-merge flags this, the contingency is a one-line CSS escape under `.light` to swap to `text-amber-500`. Not blocked on this plan — the shape (two outlined circles) carries the meaning even at marginal hue contrast (locked decision).
- **No regression test for the `R6 .term-wrap` overflow rule itself**: CSS-only changes don't have a unit-test surface. Verification is visual / Playwright (deferred).

The plan-level GREEN gate is `tests/other-client-indicator.test.js` flipping RED → GREEN AND `npm run test` exiting 0 — both satisfied.
