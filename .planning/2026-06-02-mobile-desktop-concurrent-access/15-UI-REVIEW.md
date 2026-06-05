---
phase: 12
slug: mobile-desktop-concurrent-access
artifact: ui-review
status: complete
audited_at: 2026-06-02
auditor: gsd-ui-reviewer (claude-opus-4-7)
baseline: 15-UI-SPEC.md (locked contracts)
screenshots: not_captured # no dev server running at audit time — code/contract audit only
overall_score: 22/24
verdict: ship_with_two_flags
pillar_scores:
  visual_hierarchy: 4
  information_architecture: 4
  interaction_design: 3 # pointer-events:none on parent may suppress native title tooltip
  visual_consistency: 4
  responsive_design: 4
  accessibility_and_polish: 3 # light-mode contingency deferred (documented in UI-SPEC, not implemented)
locked_contract_compliance: 7_PASS_1_FLAG_native_tooltip_under_pointer_events_none
---

# Phase 12 — UI Review

## TL;DR

Phase 12's visible UI surface (one new indicator + one CSS rule + a chunky deletion sweep) was implemented faithfully against the locked contracts in `15-UI-SPEC.md`. The indicator markup is verbatim per spec (DOM, class list, `title`/`aria-label`, viewBox, both `cx` values, stroke width), appears in BOTH the `addTerminal` and `buildResumableRow` templates with the G9 ternary so rows created after the second client connects render visible immediately, and the `clients.count` WS handler walks the live DOM idempotently. The phone-viewport contract is the single `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }` rule inside the existing 960px block — no new breakpoint tier. The deletion sweep is verifiable: zero `clideck-remote`/`btn-remote`/`remote-modal`/`version-remote` matches in `public/` outside the whitelisted gate test in `e2e/`.

**Two flags, both minor:**

1. The indicator's parent (`<div class="flex-1 min-w-0 pointer-events-none">` at `terminals.js:513`) sets `pointer-events:none`, which suppresses the browser's native `title=` tooltip on hover. Screen-reader users still get `aria-label`; pointer/mouse users may NOT see "Another client is connected" on hover. Per CONTEXT.md the indicator is "display-only" so this may be intentional, but it weakens the affordance.
2. The UI-SPEC documents a light-mode contrast contingency (swap `text-amber-400` → `text-amber-500` if dark-mode-only verification feels marginal) and the executor did NOT implement that escape hatch. Dark mode contrast is ~9.8:1 (excellent). Light mode contrast is the documented borderline ~2.1:1. This is a deferred decision, not a bug — but it should be re-checked the moment a user runs the app in light mode at 375×667.

**Honest gap:** no running dev server, so this audit is structural — DOM template + CSS rule + UI-SPEC contract reading, not screenshots. The pillar scores below are scored against contract compliance and code review evidence, not against rendered pixels.

---

## Locked-contract compliance (the 8 bullets from the scope)

| # | Contract | Status | Evidence |
|---|----------|--------|----------|
| 1 | Indicator DOM verbatim (class list, attrs, SVG dims, cx/cy/r) | PASS | `terminals.js:516` and `:1351` — `class="other-client-indicator${...} flex-shrink-0 text-amber-400"`, `title="Another client is connected"`, `aria-label="Another client is connected"`, `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">`, two `<circle cx="6"|"10" cy="8" r="3.5"/>` |
| 2 | Indicator in BOTH `addTerminal` AND `buildResumableRow` with G9 ternary `state.otherClientsConnected ? '' : ' hidden'` | PASS | `addTerminal` at `terminals.js:516`; `buildResumableRow` at `terminals.js:1351`. Both use the same ternary so a row injected AFTER the second client connected renders the indicator already visible without waiting for the next `clients.count` broadcast |
| 3 | Indicator slot independence — sibling of `.session-time`, NOT colliding with `.unread-dot` or `.session-status` | PASS | Indicator lives on the TOP row (`<div class="flex items-baseline gap-2">` line 514) between `.name` (line 515, `flex-1`) and `.session-time` (line 517). `.unread-dot` and `.session-status` live on the BOTTOM row (line 519–522). Different row, different visual column — no collision possible |
| 4 | Phone-viewport responsive contract — single `@media (max-width:960px)` extension with `.term-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch }`, no new ≤480 tier | PASS | `public/index.html:138–141` inside the existing block at `:60`. PTY visually scrolls; does not reshape. No second `@media` block introduced |
| 5 | Deletion contract — `#btn-remote`, `#remote-modal`, `#version-remote` gone; rail bottom = theme + settings only | PASS | `git grep -nE "remote-modal\|clideck-remote\|btn-remote\|version-remote"` against `public/` returns 0 hits. Rail bottom at `index.html:168–175` is `<div class="flex-1"></div>` + `#btn-theme-toggle` + `#rail-settings` — exactly 2 icons as contracted |
| 6 | Cross-mode (dark/light) — `text-amber-400` compiled and present in `tailwind.css`; A1/G11 inline-style fallback documented | PASS (compiled) / FLAG (light-mode contingency deferred) | Compiled rule: `.text-amber-400{--tw-text-opacity:1;color:rgb(251 191 36/var(--tw-text-opacity,1))}` confirmed in `public/tailwind.css`. Dark-mode contrast (#FBBF24 on slate-900 #0f172a) ≈ 9.8:1, PASS. Light-mode contingency (swap to `text-amber-500`) NOT implemented — see Flag #2 below |
| 7 | Copywriting Contract — exact strings "Another client is connected"; removed copy fully purged | PASS | Indicator `title` and `aria-label` match verbatim in both row templates. `Mobile Remote`, `clideck-remote`, `Add to CliDeck`, `Installing clideck-remote`, `Connecting to relay` all return zero hits in `public/` |
| 8 | Accessibility — `aria-label` on wrapper, `aria-hidden="true"` on inner SVG, `title` present, shape (two circles) carries meaning independent of color | PASS (structural) / FLAG (native tooltip may not fire — see Pillar 6) | Both `aria-label` and `title` set on `<span>`; `aria-hidden="true"` on inner `<svg>`; shape is two outlined circles vs. unread-dot's single filled circle — meaning conveyed via shape, not color alone |

**Net: 7 PASS, 1 PASS-with-flag (#6 light mode), and one cross-cutting flag on #8 that's better expressed as Pillar 6 evidence below.**

---

## 6-pillar scoring

| Pillar | Score | One-line finding |
|--------|-------|------------------|
| 1. Visual Hierarchy | 4/4 | Indicator reads as a peer signal to `.session-time`; doesn't steal focus from `.name`; amber vs. blue unread-dot is unambiguous and the row layout absorbs the new slot without reflow |
| 2. Information Architecture | 4/4 | Indicator slot is on a different row from `.unread-dot` and `.session-status`; rail post-deletion is coherent (3 panel buttons → spacer → theme + settings); version-footer survives the loss of `version-remote` row cleanly |
| 3. Interaction Design | 3/4 | State machine correct (count > 1 shows, ≤ 1 hides; idempotent over live DOM via G9 mitigation); BUT the parent `pointer-events:none` on `terminals.js:513` likely suppresses the native `title` tooltip — see Flag #1 |
| 4. Visual Consistency | 4/4 | SVG `stroke-width=1.5` matches the rail icon convention; viewBox=`16 16` for a 10×10 render fits the indicator's "small badge" size class; `text-amber-400` is the only new hue and matches the UI-SPEC reservation (the only warm hue not already claimed) |
| 5. Responsive Design | 4/4 | Single rule extension inside the existing 960px block; xterm's PTY-locked grid will horizontal-scroll instead of reshape; touch momentum opt-in via `-webkit-overflow-scrolling:touch`; indicator stays in the row's top-line flex layout at 375×667 (still `flex-shrink-0` so it never gets eaten by truncation) |
| 6. Accessibility & Polish | 3/4 | `aria-label` + `aria-hidden` both correct; dark-mode contrast 9.8:1 (excellent); BUT (a) light-mode contingency `text-amber-500` swap deferred — see Flag #2, (b) parent `pointer-events:none` likely suppresses the native `title` tooltip — see Flag #1 |

**Overall: 22 / 24** — ship-with-two-flags. Neither flag is a BLOCKER for Phase 12 acceptance; both are bounded follow-ups.

---

## Findings

### FLAG-1 — `pointer-events:none` on parent likely suppresses the native `title` tooltip

**Where:** `public/js/terminals.js:513` (the `<div class="flex-1 min-w-0 pointer-events-none">` that wraps the indicator) — symmetrical issue at `:1348` for the resumable row template.

**What:** the parent container has `pointer-events:none`, which prevents pointer events (hover, click) from reaching the indicator `<span>`. Modern browsers attach the native `title` tooltip via the pointer-event hover pipeline — when the underlying element has `pointer-events:none`, the title tooltip does not fire. (The `.name` span inside re-enables them with `pointer-events:auto` so rename-on-double-click still works; the indicator does NOT.)

**Impact:** sighted mouse/touch users may not see the "Another client is connected" tooltip when hovering the amber double-circle. Screen-reader users still get `aria-label`. The shape difference (two-circles outline vs. one-circle filled) carries the semantic meaning regardless, so this is degradation of an affordance, not a loss of the signal.

**Severity:** WARNING. The UI-SPEC describes the indicator as "display-only, not interactive" (§Position on the session row, §Hover/focus) — following the `.unread-dot` precedent which is also non-interactive. So the missing tooltip is **arguably consistent with the design intent**, but it's worth confirming the intent is "shape + amber color are enough at a glance and nobody needs the tooltip" rather than "we forgot the tooltip would be eaten by the pointer-events trap."

**Recommendations (pick one):**

- **Accept as-designed.** The indicator is non-interactive by spec; document in code comment that the title is for assistive tech only.
- **Re-enable pointer events on the indicator alone:** add `pointer-events-auto` to the indicator's class list so the native browser tooltip fires on hover but no click handler runs (because no click handler is attached). One-class change, zero risk.
- **Drop the `title` attribute** entirely and keep only `aria-label` — clarifies that the tooltip is intentionally screen-reader-only.

### FLAG-2 — Light-mode contrast contingency documented but not implemented

**Where:** `public/js/terminals.js:516` and `:1351` — both indicator markup blocks use `text-amber-400` unconditionally.

**What:** the UI-SPEC §Cross-mode (dark / light) verification contract documents the contingency: if light-mode contrast verification at gsd-ui-checker dimension 3 fails, swap to `text-amber-500` (~3.2:1 on light surface vs. ~2.1:1 for amber-400). The executor did NOT add the swap. Per UI-SPEC the contingency is conditional ("if light-mode contrast verification fails at the visual check"), so this is a **deferred decision**, not a defect — but it's untested at audit time because no dev server is running and the auditor hasn't manually toggled light mode at 375×667.

**Impact:** in light mode the amber double-circle may be barely-visible on the light `--color-surface` (~`#f6f5f5`). The shape carries meaning, but the warning hue is the primary visual hook and a 2.1:1 contrast against pale grey is below WCAG AA non-text 3:1.

**Severity:** WARNING / deferred verification. Has no impact on dark-mode users (most likely the dominant case for a terminal dashboard).

**Recommendation:** add the documented escape hatch as a one-line CSS override in `public/index.html`'s `<style>` block:

```css
.light .other-client-indicator { color: #f59e0b; } /* text-amber-500 equivalent */
```

…and tick the UI-SPEC's checker-sign-off Dimension 3 box.

### PASS — Indicator DOM contract (markup verbatim)

`terminals.js:516` (active session row) and `:1351` (resumable row) carry the exact markup from UI-SPEC §DOM contract: class list `other-client-indicator{ hidden} flex-shrink-0 text-amber-400`, `title="Another client is connected"`, `aria-label="Another client is connected"`, inner `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">`, two `<circle cx="6"|"10" cy="8" r="3.5"/>`. No paraphrasing, no abbreviation, no decoration.

### PASS — G9 ternary present in BOTH row templates

Both templates read `state.otherClientsConnected` at row-construction time via `${state.otherClientsConnected ? '' : ' hidden'}` (lines 516 and 1351). A row added AFTER the second client connected already renders the indicator visible without waiting for the next `clients.count` broadcast. The companion helper `updateOtherClientIndicator` (`terminals.js:861–866`) keeps existing DOM in sync via a fresh `querySelectorAll` walk on every broadcast — no stale snapshots. This is the G9 mitigation called out in `15-RESEARCH.md §10`.

### PASS — Slot independence on the session row

UI-SPEC contract: indicator must sit on the TOP row to the LEFT of `.session-time`, distinct from `.unread-dot` (bottom row) and `.session-status` (bottom row).

Verified:
- Top row (`terminals.js:514` `<div class="flex items-baseline gap-2">`): `<span class="name flex-1 ...">` → `<span class="other-client-indicator ...">` → `<span class="session-time recent ...">`.
- Bottom row (`terminals.js:519` `<div class="flex items-center gap-1 mt-0.5">`): `<span class="session-status ...">` → `<span class="session-preview ...">` → `<span class="unread-dot ... bg-blue-500">` → `<button class="menu-btn ...">`.

Different row, different visual column, zero possibility of collision.

### PASS — Phone viewport contract (single CSS rule, existing block)

`public/index.html:138–141` adds exactly one block inside the existing `@media (max-width: 960px)`:

```css
.term-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

`.term-wrap` is the xterm wrapper created by `terminals.js:539` (`el.className = 'term-wrap'`) — confirmed as the right selector. The rule lets xterm's locked-PTY-width DOM area scroll horizontally on small viewports without reshaping the PTY (which Phase 12 R2 forbids). No `@media (max-width: 480px)` tier was added; the SPEC's ≤480 target is a *verification viewport*, not a *breakpoint*, and that distinction was respected.

### PASS — Deletion sweep (full removal of clideck-remote surface)

`git grep -nE "remote-modal|clideck-remote|remote\.(update|error|installing|status|pair|unpair)|btn-remote|version-remote" -- 'public/' ':!CHANGELOG.md' ':!.planning/'` returns zero matches. The rail bottom (`public/index.html:168–175`) is the contracted 2-icon stack: spacer → `#btn-theme-toggle` → `#rail-settings`. The version footer (`public/index.html:257–262`) survives the loss of the `version-remote` row — only `version-clideck` remains, no orphaned border or layout glitch.

### PASS — Copywriting contract

Only new copy in the phase:
- `title="Another client is connected"` — matches UI-SPEC §Copywriting Contract verbatim.
- `aria-label="Another client is connected"` — matches.
- No "N other clients" phrasing (D-08 server-wide count gives only "≥2" knowledge — the singular phrasing is appropriate).
- Removed copy ("Mobile Remote", "CliDeck Mobile Remote", "Control your AI agents from your phone…", "Add to CliDeck", "Installing clideck-remote…", "Connecting to relay…") fully purged from `public/`.

### PASS — Visual consistency (stroke weight, palette)

- SVG `stroke-width="1.5"` matches the rail icon convention (`stroke-width="1.5"` on `#btn-theme-toggle` and `#rail-settings` at index.html:170, 174).
- viewBox `0 0 16 16` is non-standard relative to the 24×24 viewBox used on rail icons, but appropriate for a 10×10 inline badge — the smaller viewBox gives the two circles room to overlap without becoming sub-pixel.
- `text-amber-400` (`#FBBF24`) is the only warm hue introduced; reserved by UI-SPEC §Color tokens specifically because it's NOT already claimed by accent (blue), destructive (red), or unread (blue).
- Compiled rule present: `.text-amber-400{--tw-text-opacity:1;color:rgb(251 191 36/var(--tw-text-opacity,1))}` confirmed in `public/tailwind.css`.
- No A1/G11 inline-style fallback needed — Tailwind rebuild already included the utility.

---

## Honest gaps (what this audit could NOT verify)

Per CLAUDE.md §1 — don't fabricate visual judgments.

1. **No running dev server at audit time.** Ports 3000/5173/8080/8123 all unreachable. This is a code/contract audit, not a rendered-pixel audit. Findings are based on (a) DOM template reads, (b) CSS rule reads, (c) compiled Tailwind utility verification, (d) `git grep` deletion checks, (e) cross-reference against `15-UI-SPEC.md` locked contracts. No screenshots were captured.
2. **Light-mode contrast not verified at 375×667.** The UI-SPEC's documented light-mode contingency (swap to `text-amber-500`) hinges on a visual check that this auditor did not perform. See Flag #2.
3. **Tooltip behavior under parent `pointer-events:none` not verified empirically.** The flag is based on documented browser behavior (title tooltips ride the pointer-event hover pipeline); not on a screenshot of a hover state. See Flag #1.
4. **Concurrent-client behavior not verified live.** The handler is wired (`app.js:206–214` dispatches `clients.count`, `terminals.js:861–866` toggles), but actual two-WebSocket-context interaction is covered by `15-VERIFICATION.md` and the deferred Playwright spec (D-14/D-18/D-19), not this audit.
5. **Cross-row visual hierarchy at 375×667 with all badges visible** (indicator + unread-dot + session-status dormant pill + menu-btn hovered) not verified. Geometric reasoning says no collision (different rows), but a stacked-up "busy row" screenshot would settle it.

These gaps are documented honestly so the orchestrator and Lance know exactly what to verify manually before final phase sign-off.

---

## Top 3 priority fixes

1. **Decide on the `title` tooltip under `pointer-events:none`** (Flag #1) — pick one of: accept as designed (add code comment), add `pointer-events-auto` to the indicator class list to re-enable the native browser tooltip, or drop `title` and keep only `aria-label`. Trivial change once the intent is settled. Files: `public/js/terminals.js:516`, `:1351`.
2. **Implement the light-mode amber contingency** (Flag #2) — add `.light .other-client-indicator { color: #f59e0b; }` to the `<style>` block in `public/index.html`, OR document in `15-VERIFICATION.md` that light-mode visual contrast was checked manually and found acceptable. Files: `public/index.html` (style block, lines 9–143).
3. **Run a real two-WebSocket-context smoke at 375×667 before merging to main** — open Chromium mobile emulation, attach a second WS client, confirm the amber double-circle appears on every visible session row and resumable row in both modes. This closes the audit gaps above without requiring a dedicated test infrastructure run. The functional WS dispatch path is wired correctly; this is a "is the artist's eye satisfied?" pass, not a regression test.

---

## Files audited

| File | Lines read | What for |
|------|-----------|----------|
| `.planning/2026-06-02-mobile-desktop-concurrent-access/15-UI-SPEC.md` | full | Locked contracts (DOM, slot, breakpoint, copy, deletion) |
| `public/index.html` | 1–143 (style), 156–176 (rail), 250–264 (version footer) | Responsive @media block extension, rail reflow, version footer post-deletion |
| `public/js/terminals.js` | 500–530 (addTerminal row), 835–866 (updateOtherClientIndicator), 1330–1365 (buildResumableRow) | Indicator markup in both row templates, helper export, G9 ternary |
| `public/js/state.js` | full (40 lines) | `otherClientsConnected` flag with phase-12 commentary |
| `public/js/app.js` | 200–225 | `clients.count` WS dispatch wiring + import of `updateOtherClientIndicator` |
| `public/tailwind.css` | grep-targeted | Compiled `.text-amber-400` utility verification (rgb(251 191 36)) |
| `e2e/clideck-remote-deletion.spec.js` | grep-targeted | Confirmed deletion-gate test is the only remaining mention of removed identifiers (whitelisted) |

**Screenshots:** none captured (no dev server running at audit time).
