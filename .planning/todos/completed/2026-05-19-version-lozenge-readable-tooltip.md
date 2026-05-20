---
created: 2026-05-19T11:41:00Z
title: Add readable tooltip on lower-left version lozenge
area: ui
phase_hint: 2026-05-18-restart-architecture
ingested_into: .planning/2026-05-18-restart-architecture/SPEC.md (deliverable 5)
ingested_at: 2026-05-19
files:
  - public/index.html:135
  - public/js/app.js:53-76
---

## Problem

The connection lozenge in the lower-left corner (added in 61e4334)
displays `connected · 12m 3s · v1.31.5` in `text-[10px] font-mono` —
this is too small to read comfortably at Lance's screen scale, and the
version segment specifically is the part that's hard to make out
("what version am I actually running?").

The badge needs a hover-revealed tooltip that shows the version (and
ideally the full status string) in a larger, comfortably-readable font.

## Solution

Add a CSS-driven custom tooltip on hover of `#app-status-badge`. Not
the native `title` attribute — that renders at the OS default size and
defeats the point.

**Approach:**
1. In `public/index.html:135`, wrap the lozenge's content (or the
   whole `#app-status-badge`) so it can host a tooltip pseudo-element
   or sibling `<span>` positioned just above the badge.
2. Tooltip styling: `text-sm` or `text-base` (12–14px), same monospace
   font, dark slate background, slight border, rounded, with a small
   bottom-pointing arrow. Position absolute above the lozenge, hidden
   by default, visible on `:hover` / `:focus-within`.
3. Tooltip content: prominent version line (e.g. `Version 1.31.5` in
   `text-base font-semibold`) followed by a secondary line with the
   connection state + uptime in a slightly smaller font. Update from
   `renderStatusBadge()` in `public/js/app.js:53-76` whenever the
   badge text is rebuilt.

## Pitfall to handle

`#app-status-badge` is currently `pointer-events-none` (see the inline
comment at `public/index.html:134-135`: "pointer-events-none so it
doesn't block clicks on the nav rail it sits over"). This means
`:hover` will not fire as-is.

Two options:
- **Make just the badge's hit area receive pointer events.** Apply
  `pointer-events-auto` only on the badge element itself, accepting
  that hover/click inside the badge area no longer falls through to
  the nav rail. The badge is small (a few px tall, ~150px wide), so
  the loss of click-through is minor and may even be desirable for
  the future "click-to-copy version" affordance below.
- **Keep pointer-events-none and trigger the tooltip from a parent
  region.** More fragile; not recommended.

Go with the first option unless something in the nav-rail layout
specifically depends on clicks falling through.

## Nice-to-have (don't block on this)

While we're touching this: making the version text inside the
tooltip click-to-copy (writes `clideck@1.31.5` to clipboard) would be
useful for filing issues. Out-of-scope for the core fix; capture as a
follow-up if not done in the same PR.
