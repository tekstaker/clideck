---
created: 2026-05-19T11:38:00Z
title: Allow drag-to-reorder of sessions in the left sidebar
area: ui
phase_hint: 2026-05-19-session-polish
files:
  - public/js/drag.js:38-50
  - public/js/drag.js:106-126
  - public/js/drag.js:186-193
  - public/js/terminals.js
---

## Problem

The left-hand session list supports dragging sessions, but only for
**moving sessions between project groups** (or ungrouping by dragging
above the first project). There is no way to reorder sessions within
their current group, or reorder ungrouped sessions among themselves.

By contrast, the same `drag.js` module already supports reorder for
**projects** (see `mode === 'project'` branch at lines 130–170 for the
drop-target insertion line, and 194–205 for the persistence: splice the
project in `state.cfg.projects` and broadcast a `config.update`).

The asymmetry is the bug: sessions get drag-to-move-between-groups,
projects get drag-to-reorder, but sessions don't get drag-to-reorder.

## Solution

Mirror the project-reorder pattern for sessions inside `drag.js`:

1. **Drop-target detection (`updateDropTarget`, lines 106–126):** when
   dragging a session, in addition to checking project-header overlap
   and "above first group" ungrouping, also check the gaps between
   adjacent `.group[data-id]` rows within the same project (and within
   the ungrouped area). Mark the gap with an insertion line element
   analogous to `.project-drop-line` — call it `.session-drop-line`
   and style it the same way.

2. **Drop handler (`endDrag`, lines 186–193):** add a new branch
   `ds.mode === 'session' && ds.dropTarget.type === 'reorder'` that
   reorders the session within its group (or within ungrouped) and
   persists the new order.

3. **Persistence — this is the open question.** `state.terms` is a Map
   (terminals.js:520, `state.terms.set(id, …)`). Map iteration order
   equals insertion order, but there's no explicit order field on
   sessions, and the server side currently controls insertion order
   based on connect/restore sequence. Two viable approaches:

   - **Client-only Map reorder** — rebuild `state.terms` as a new Map
     in the desired sequence, then call the same render path
     `regroupSessions()` uses. Simple, but won't survive a restart
     unless the server also persists the order.
   - **Server-persisted order** — add a numeric `order` field to each
     session record on the server, and have the client send a
     `session.reorder` message (or extend an existing config update)
     when drop happens. The server then re-emits sessions in that
     order on reconnect/restart.

   Pick option 2 if you want reorder to survive `clideck` restart
   (likely yes — projects already survive restart). Option 1 is fine
   for an MVP-only-while-running version.

4. **UI affordance.** The existing `pointerdown` handler at
   `drag.js:38-50` already wires up session drag — no change to the
   start path needed. But the new insertion lines should appear only
   when dragging a session, and only within the dragged session's
   current group (cross-group drags should still go through the
   existing move-between-projects path).

## Notes

- The drag threshold (5px) and ghost rendering at `drag.js:82-102`
  already handle session drags — same code, no changes there.
- Watch out for: drag-to-self (no-op) and drag-immediately-next
  (no-op) — see the `i === dragIdx || i === dragIdx + 1` skip at
  `drag.js:156` for the project equivalent.
- If the server side gets a new `session.reorder` message, the matching
  handler in `server.js` should treat order as advisory and validate
  ids exist before reordering.
