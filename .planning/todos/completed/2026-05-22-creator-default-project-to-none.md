---
created: 2026-05-22
title: Default the new-session project dropdown to "None" instead of requiring a choice
area: ui
files:
  - public/js/creator.js
promoted: true
promoted_to: .planning/2026-05-27-creator-ergonomics/SPEC.md
promoted_at: 2026-05-27
---

## Problem

In the new-session creator card, the project dropdown starts with no selection —
the trigger shows "Select project" and the hidden input is empty. Submitting in
that state surfaces a toast: *"Choose a project or select `None (outside project
hierarchy)`."* (`creator.js:340`)

For Lance's flow this is a friction toll on every single session create: type the
name, type/pick a folder, then *also* explicitly select "None" from the dropdown
before hitting submit. The "None" option exists precisely for the
not-in-a-project case, but it's not the default.

## Solution

Pre-seed `projHidden.value = NO_PROJECT_VALUE` and set the trigger label to
"None (outside project hierarchy)" at creator-card open. Specifically in the
"Project picker dropdown" block around `creator.js:252-274`:

- After `projHidden = card.querySelector('#creator-project')` (line 235), set
  `projHidden.value = NO_PROJECT_VALUE` if it's empty.
- In the initial render path, set `projLabel.textContent = 'None (outside project
  hierarchy)'` to match.
- Make sure `cwdWrap.classList.remove('hidden')` runs for the initial render so
  the cwd input is visible immediately (since "None" implies user-typed cwd, not
  project-inherited).
- Side effect to verify: the guard at line 339 `if (projTrigger && !projHidden.value)`
  becomes effectively dead code now that the value is never empty on open.
  Either leave it as defence-in-depth or remove it — small choice, prefer
  removal for clarity.
- If the user explicitly picks a real project and *then* changes their mind,
  re-clicking the dropdown and choosing "None" should still work (it already
  does — the `setProjectSelection(NO_PROJECT_VALUE)` branch handles it).
- If `state.cfg.projects` is non-empty, the dropdown still surfaces them — just
  no longer forces a pick.

Trivial fix — small enough to bundle with another adjacent UI tweak (e.g. the
non-existent-path warning in
[[2026-05-22-creator-warn-on-nonexistent-path]]) when this lands.

## Edge cases

- A user who explicitly *prefers* picking a project first (mental-model
  difference, not Lance's) loses the "you must pick" nudge. Defensible: "None"
  is a real choice, and the dropdown is right there.
- Project-grouping in the sidebar still works fine — sessions created with
  `projectId: undefined` already land in the ungrouped area today.
