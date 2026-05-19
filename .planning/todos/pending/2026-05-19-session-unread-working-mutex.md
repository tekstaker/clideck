---
created: 2026-05-19T11:49:00Z
title: Don't show "unread" dot while session is still working
area: ui
files:
  - public/js/app.js:202-209
  - public/js/terminals.js:583-591
  - public/js/terminals.js:641-695
---

## Problem

A session row in the sidebar has two independent visual states that
shouldn't coexist:

- **Left side — "working" indicator**: bouncing dot + green
  `pill-status` text, driven by `entry.working = true` (see
  `terminals.js:641-695`). Visible while the agent is actively
  emitting output.
- **Right side — "unread / waiting for you" dot**: small blue
  `.unread-dot` (see `terminals.js:357` for the element,
  `terminals.js:583-591` for the toggle). Meant to mean "this session
  has produced output you haven't looked at yet."

The bug Lance is seeing: a session that is **actively working** (text
streaming, bouncing dot visible on the left) also shows the **unread
dot on the right**. Both indicators on at once is contradictory — the
right-side dot says "waiting for your attention," the left-side
indicators say "currently busy." It should be one or the other.

## Root cause

`public/js/app.js:202-208` — the WebSocket `output` message handler:

```js
case 'output': {
  const entry = state.terms.get(msg.id);
  if (msg.replay && reconnectReplaySkip?.has(msg.id) && entry) break;
  if (entry && !entry.queue(msg.data)) entry.term.write(msg.data);
  updatePreview(msg.id);
  markUnread(msg.id);          // ← fires on EVERY chunk
  break;
}
```

`markUnread` at `terminals.js:583-591` only short-circuits when the
session is currently active or already unread:

```js
if (!entry || id === state.active || entry.unread) return;
```

It does **not** consult `entry.working`. So any non-active session
that's currently working sets `unread = true` the moment its first
output chunk lands — and stays that way until you click in.

## Solution

Two equally valid fixes; recommend the second because it's
semantically cleaner.

### Option A — gate the existing call

In `terminals.js:585`, extend the early-return:

```js
if (!entry || id === state.active || entry.unread || entry.working) return;
```

Smallest change. But behavior is "unread is suppressed while working
right now, then flips on when the next output chunk arrives after
working ends" — which depends on output continuing post-idle. If the
agent stops producing output the moment it goes idle, the unread dot
never lights up.

### Option B — fire `markUnread` on the working→idle edge (recommended)

Remove the `markUnread(msg.id)` call at `app.js:207`. Instead, fire it
inside `setStatus` (terminals.js:641-695) on the working→idle
transition, around line 671 where the idle-capture is scheduled:

```js
if (wasWorking && !working) {
  entry.scheduleIdleCapture?.();
  if (id !== state.active) markUnread(id);   // ← new
}
```

This matches the user's mental model: the unread dot means "this
session **just** went idle and is waiting for your attention."
While working, no unread dot. The moment work ends, the dot appears
(unless you're already looking at the session).

Notification audio/banner at `terminals.js:649-667` already keys off
this same transition, so the unread dot would now align with the
existing notification semantics — they all fire together on idle.

### Edge cases to handle for option B

- **Pure-output sessions with no working/idle cycle.** If a session
  emits output without ever entering "working" state (e.g. a passive
  log tail), it would never get the unread dot under option B. Check
  whether this case exists — `setStatus` is called from where?
  Probably driven by the pill heuristic in `setStatus` and the
  preview-line marker detection in `readLastAgentLine`. If passive
  output is a real category and should still trigger "unread", add
  a fallback: in the `output` handler, only call `markUnread` when
  `entry.working === false` (i.e. only for passive output).
- **Initial replay buffer on reconnect.** The `msg.replay` short-circuit
  at `app.js:204` already prevents replay from triggering anything for
  sessions in `reconnectReplaySkip`. Make sure neither option triggers
  unread during replay.
- **Active session.** Both options correctly leave the active session
  alone (`id === state.active` guard already in `markUnread`).

## Repro hint for testing

1. Have a non-active session in the sidebar.
2. Send it a long-running command so the bouncing dot + green
   `pill-status` appear.
3. Observe: the small blue `.unread-dot` on the right also lights up
   even though the session is clearly still working.

Expected after fix (option B): blue dot stays hidden until the agent
stops working, then appears.
