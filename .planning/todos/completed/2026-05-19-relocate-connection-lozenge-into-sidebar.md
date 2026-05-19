---
created: 2026-05-19T15:20:00+01:00
title: Relocate connection lozenge from lower-left corner into sidebar header
area: ui
phase_hint: 2026-05-18-restart-architecture
ingested_into: .planning/2026-05-18-restart-architecture/SPEC.md (deliverable 6)
ingested_at: 2026-05-19
files:
  - public/index.html:134-138
  - public/index.html:172-204
  - public/js/app.js:53-76
---

## Problem

The always-visible connection lozenge (added in `61e4334`, styled at
`public/index.html:135`) is `position: fixed; bottom-1.5; left-1.5; z-50`
and hovers over **everything**, including the version display below and
part of the gear/settings icon on the nav rail. Even with
`pointer-events-none` the visual occlusion is the problem — it sits
*on top of* the UI it's supposed to coexist with and obscures
nearby elements at certain viewport sizes.

It's also currently competing with the in-flight tooltip work
(see archived todo `2026-05-19-version-lozenge-readable-tooltip`,
ingested into the `restart-architecture` phase as deliverable 5).

## Solution

Move the lozenge **into the sessions panel header**, just above the
search input. The strip between the clideck title row
(`public/index.html:175-190`) and the search row
(`public/index.html:192-195`) is wide (354 px sidebar), uninhabited,
and the natural place to highlight "is this thing connected?" status
where the eye lands first.

**Implementation:**
1. Delete the `<div id="app-status-badge">` block at
   `public/index.html:134-138`.
2. Insert it inside `#panel-chats` at the top of the
   `.px-2.5 pb-2.5 flex flex-col gap-2` container
   (`public/index.html:191`), **before** the search input. Either:
   - As a sibling above the search wrapper (`<div class="relative">…`),
     OR
   - As a single row spanning the full panel width with the lozenge
     pill centred or left-aligned.
3. Drop `fixed`, `bottom-1.5`, `left-1.5`, `z-50`, `pointer-events-none`,
   and `backdrop-blur-sm` — none are needed in-flow. Keep the pill
   styling: `rounded-full`, `text-[10px]`/`text-xs` mono, dot + text,
   green/red colour transitions.
4. `renderStatusBadge()` in `public/js/app.js:53-76` updates the same
   `#app-status-badge` / `#app-status-dot` / `#app-status-text` IDs —
   no JS changes needed beyond confirming the element is still found.
5. Confirm the tooltip work (when it lands as part of the
   restart-architecture phase) still fits the new location — a
   tooltip *below* the lozenge may be more natural in-sidebar than
   the previously-planned tooltip *above* a corner-pinned badge.

## Knock-on cleanups (do at the same time)

- The inline HTML comment at `public/index.html:134` ("…so it doesn't
  block clicks on the nav rail it sits over") is no longer relevant
  once the badge is in-flow. Delete it.
- If the old fixed-corner CSS leaves dead Tailwind classes (`fixed`,
  `bottom-1.5`, `left-1.5`, `z-50`, `backdrop-blur-sm`,
  `pointer-events-none`) anywhere else, remove them so nothing keeps
  the lozenge pinned by accident.

## Pitfall

The `#panel-chats` container is `flex flex-col flex-1 min-h-0` with a
scrollable `#session-list` taking the remaining height. Adding a row
above the search will eat ~24-28 px of sidebar real estate, slightly
shortening the visible session list. Acceptable trade — the corner
overlap is the worse cost. If it feels cramped, consider folding the
lozenge into the existing title row (line 175) next to
`#save-indicator` instead, as a more compact dot+label.
