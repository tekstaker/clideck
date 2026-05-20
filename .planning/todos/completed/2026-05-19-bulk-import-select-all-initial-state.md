---
created: 2026-05-19T11:34:00Z
title: Sync select-all checkbox with row state in bulk-import modal
area: ui
phase_hint: 2026-05-17-session-ux
ingested_into: .planning/2026-05-17-session-ux/SPEC.md (acceptance criterion 7)
ingested_at: 2026-05-19
files:
  - public/js/app.js:1126
  - public/js/app.js:1175-1178
---

## Problem

When the bulk-import (multi-project loading) modal opens, every discovered
project row starts pre-selected — but the "Select all" master checkbox at the
top of the modal is rendered **unticked**. The displayed state contradicts the
actual selection state, which is confusing: a user glancing at the modal might
think nothing is selected when in fact everything is.

The same desync goes the other way: clicking individual row checkboxes does
not update the master checkbox. If a user manually selects every row, the
master remains unticked; if they uncheck the last row, the master doesn't
clear.

Current code (`public/js/app.js`):
- Line 1126 — checkbox is rendered without a `checked` attribute; only gets
  `disabled` when there are no entries.
- Lines 1175–1178 — there's only a one-way listener: master change → rows.
  Nothing initializes the master from row state, and nothing listens to row
  changes to update the master.

## Solution

Two fixes in `public/js/app.js`:

1. **Initialize the master checkbox on modal open.** When the modal is
   rendered with rows pre-selected (the default behavior), the master should
   reflect `every(.bi-row, checked)`. Either set the `checked` attribute
   inline at line 1126 based on the initial selection, or set
   `selectAll.checked` right after the listener is wired (around line 1176).

2. **Keep master in sync with row toggles.** Add a `change` listener on each
   `.bi-row` (or delegate from the modal container) that recomputes
   `selectAll.checked = allRowsChecked` and ideally
   `selectAll.indeterminate = someButNotAllRowsChecked` so the UI also
   handles the partial-selection state cleanly.

Watch for: if the row list is re-rendered (e.g. parent path change at
line 1104), make sure the master state is re-derived after the re-render,
not just on first mount.
