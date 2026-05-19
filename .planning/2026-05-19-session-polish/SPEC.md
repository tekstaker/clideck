# SPEC — Session sidebar polish

**Status:** planned
**Owner:** Lance Keay
**Date:** 2026-05-19

## What this delivers

Two small but visible improvements to the left-hand session list, both
touching the session-row template and the sidebar drag/state code.

1. **Drag-to-reorder sessions within a group.** Sessions in the
   sidebar can be dragged today, but only to move them between
   project groups (or to ungroup them). They cannot be reordered
   within their own group. Projects, by contrast, can already be
   reordered via the same `drag.js` module. This phase adds the
   missing symmetry: sessions get the same drag-to-reorder
   affordance.
2. **Unread / working indicator mutex.** Sessions in the sidebar
   can currently show the "unread" dot (small blue dot on the
   right of the row, meaning "waiting for your attention") and the
   "working" indicator (bouncing dot + green pill-status on the
   left, meaning "currently busy") **at the same time**. These two
   states should be mutually exclusive — a session that's actively
   producing output is not waiting for attention. Fix the state
   machine so the unread dot only appears once work has ended.

## Why

- **Reorder asymmetry is a UX inconsistency.** Lance has multiple
  active sessions per project and wants to order them by his
  current attention priority. The drag affordance is already there
  for projects (the gesture is muscle-memorable); applying it to
  sessions costs little and removes a sharp edge.
- **Indicator collision is visually contradictory.** When both
  indicators light up, the row says "this session is busy" *and*
  "this session is waiting for you" simultaneously — Lance's
  reasonable read is "what does this row actually mean?" The
  unread dot was meant to flag idle sessions that produced output
  while you were elsewhere. Firing it during active work breaks
  that meaning.

## Scope

**In scope**

### Drag-to-reorder sessions

- Extend `updateDropTarget()` in `public/js/drag.js:106-126` to
  detect between-row gaps for session drags within the same project
  group (and within the ungrouped area). Mark the gap with an
  insertion line element analogous to the existing
  `.project-drop-line` (call it `.session-drop-line`).
- Extend `endDrag()` at `public/js/drag.js:186-193` with a new
  branch for `ds.mode === 'session' && ds.dropTarget.type === 'reorder'`
  that performs the reorder and persists it.
- **Persistence.** Sessions live in `state.terms`, a Map at
  `public/js/terminals.js:520` whose iteration order is insertion
  order. There is no explicit `order` field. Two persistence paths:
  - **Server-persisted order (preferred).** Add a numeric `order`
    field to each session record on the server side; client sends a
    new `session.reorder` message on drop. The server re-emits
    sessions in that order on reconnect / restart. This matches
    how project order is persisted (see existing `config.update`
    pattern around `drag.js:194-205`) and means reorder survives a
    clideck restart.
  - **Client-only Map reorder** (fallback only). Rebuild
    `state.terms` as a new Map in the desired sequence and call
    `regroupSessions()`. Works in-session, loses order on restart.
- Drop-line CSS analogous to `.project-drop-line`. Reuse styling.

### Unread / working indicator mutex

- Root cause is at `public/js/app.js:202-209`: the WebSocket
  `output` handler calls `markUnread(msg.id)` on every output
  chunk. `markUnread()` at `public/js/terminals.js:583-591` only
  short-circuits when the session is the active one or already
  unread — it does **not** check `entry.working`.
- **Preferred fix:** remove the `markUnread()` call from the
  `output` handler and fire it from inside `setStatus()` at
  `public/js/terminals.js:641-695` on the **working→idle**
  transition (near line 671 where the idle-capture is already
  scheduled):
  ```js
  if (wasWorking && !working) {
    entry.scheduleIdleCapture?.();
    if (id !== state.active) markUnread(id);
  }
  ```
  This matches the user mental model ("dot means it just finished
  doing something") and aligns with the existing notification
  audio/banner that fires on the same transition.
- **Edge case to handle:** sessions that emit output without ever
  entering a working state (e.g. a passive log tail). If this case
  exists in practice, keep a fallback `markUnread()` call in the
  `output` handler but gate it with `entry.working === false` so
  it only fires for genuinely passive output.

**Out of scope**

- Reorder across project groups via drag — already works today via
  the existing project-header drop target. Don't touch that path.
- A keyboard-driven reorder (alt+up/alt+down). Mouse drag only for
  v1; capture as a follow-up if needed.
- Reorder of the "Previous Sessions" / dormant list. Live sessions
  only.
- Reworking the bouncing dot or pill-status visuals themselves.
  This phase only fixes WHEN the unread dot appears, not HOW
  either indicator looks.

## Acceptance criteria

### Drag-to-reorder

1. Pressing and dragging a session row in the sidebar by more than
   the existing drag threshold initiates a session drag (no change
   to existing behavior).
2. While dragging a session within its own project group, an
   insertion line appears in the gap between rows where the
   session would land if released.
3. Releasing over a valid insertion gap reorders the session to
   that position in its group.
4. Releasing over a position that would result in a no-op (same
   slot or directly adjacent to the dragged session) does nothing,
   matching the project-reorder behavior at `drag.js:156`.
5. Releasing the drag over a different project header still moves
   the session to that group (preserves the existing behavior).
6. After reorder, the new order persists across a clideck restart.
   (Requires the server-side `order` persistence — fallback to
   client-only is acceptable for an early prototype only.)
7. Drop indicator visuals match the existing `.project-drop-line`
   styling for consistency.

### Indicator mutex

8. While a session is in "working" state (bouncing dot + green
   pill-status visible on the left), the unread dot on the right
   side of the row is hidden.
9. When the session transitions from working → idle, and the
   session is **not currently active** in the main pane, the
   unread dot appears.
10. When the session is active (selected), the unread dot stays
    hidden regardless of working/idle transitions (preserves the
    existing `id === state.active` guard).
11. Replay-on-reconnect output (handled at `app.js:204` via
    `reconnectReplaySkip`) does not trigger the unread dot.
12. Passive-output sessions (if they exist) still get the unread
    dot via the fallback path.

### Cross-cutting

13. All existing Vitest unit suites pass.
14. All existing Playwright smoke + paste E2E suites pass.

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub.
- Reuse `.project-drop-line` styling; don't introduce a parallel
  CSS design language for `.session-drop-line`.
- Don't refactor the surrounding sidebar render logic just because
  you're touching it. Keep edits localized to `drag.js`,
  `terminals.js`, `app.js`, and any required tiny CSS additions.
- The persistence path for session order must NOT diverge from the
  established project-order pattern. If you add a new
  `session.reorder` message type, mirror the shape and error
  handling of the existing `config.update` flow.

## Implementation pointers

- Drag work site: `public/js/drag.js:106-126` (drop-target detection),
  `public/js/drag.js:186-205` (end-drag dispatch).
- Session Map: `public/js/terminals.js:520`.
- Server-side persistence: cross-reference how project order is
  saved and re-emitted on reconnect; mirror that for sessions.
- Indicator root cause: `public/js/app.js:202-209` (output handler).
- Indicator fix site: `public/js/terminals.js:641-695`
  (`setStatus`), specifically the `wasWorking && !working` branch
  around line 671.
- Existing notification audio/banner that already fires on
  working→idle transition (terminals.js:649-667) is the right
  anchor for the new `markUnread()` call — it's already the
  semantic edge for "user-visible attention event."
