# PLAN — Session-management UX cleanup

Implementation plan for [SPEC.md](SPEC.md). Atomic commits in this order.

## Phase A — server primitives + tests

1. **`tests/resumable-handlers.test.js`** (Vitest, happy-dom not required).
   Import `sessions.js` directly. Seed the internal `resumable` array via
   a small helper (export a `__setResumableForTest` symbol behind a guard,
   or just exercise via `addResumableForTest` if simpler — final shape
   decided in implementation). Cover:
   - `rename({ id, name })` updates the matching entry and broadcasts
     `sessions.resumable` once with the new name.
   - `rename` with an unknown id does not throw and does not broadcast.
   - `close({ id })` removes the resumable entry and broadcasts.
   Stub `clients` with a fake `readyState=1` WebSocket so broadcast
   payloads land in an array we assert against.

2. **`sessions.js`: new exports.**
   - `function renameResumable(msg)` — mutate the entry by id, persist
     via the same write path used today on exit, broadcast
     `sessions.resumable`.
   - Wire `case 'resumable.rename'` in `handlers.js` to call it.
   - Persist resumables on rename. (Today the resumable list is persisted
     opportunistically; ensure rename triggers a save.) If the project has
     a single `saveSessions()` helper, call it; otherwise inline the
     `writeFileSync(SAVED_PATH, …)` consistent with existing usage.

3. **Failed-resume auto-recovery in `sessions.js`.**
   - In `resume()`, after `spawnSession`, set on the session:
     `s.resumedAt = Date.now()` and `s.originalResumeToken = saved.sessionToken`.
   - In the `term.onExit` handler, before the existing "move to resumable"
     branch, check:
     ```js
     const failedResume =
       s.resumedAt &&
       (Date.now() - s.resumedAt < 5000) &&
       s.sessionToken === s.originalResumeToken;
     ```
     When true, skip re-queue; do `transcript.clear(id)`; `sessions.delete(id)`;
     synthesize a fresh-session spawn with the same `cwd`, `commandId`,
     `themeId`, `projectId`, fresh UUID; broadcast a `created` event for
     the new session plus a `session.recovered` event:
     ```js
     { type: 'session.recovered', originalId, newId, cwd, name: saved.name }
     ```

## Phase B — client wiring

4. **`public/js/terminals.js`: per-row resumable menu.**
   - Augment `buildResumableRow(s)` so the row container has a
     `.resumable-menu-btn` mirroring the active row's `.menu-btn` (same
     hover/group classes, three-dot icon, fixed position).
   - Export `openResumableMenu(resumableId, anchorEl)` from `terminals.js`
     (or build it inside `app.js` next to `openPrevSessionsMenu` — final
     placement depends on whether we want the menu logic close to
     `openMenu`'s existing code in `terminals.js`).
   - In-place rename helper `startResumableRename(id)`:
     reuse the same pattern as `startRename` but addressing
     `[data-resumable-id="${id}"] .resumable-name` and emitting
     `{ type: 'resumable.rename', id, name }` on commit.

5. **`public/js/app.js`: wire clicks.**
   - In the existing sidebar `click` handler, branch on
     `.resumable-menu-btn` *before* the row-level "resume" click handler
     so the menu doesn't trigger a resume.
   - Add a top-level handler for the new `session.recovered` message that
     shows the toast `Couldn't resume previous session — started a fresh
     one in <shortPath(cwd)>` and auto-`select(newId)` on receipt.

## Phase C — bulk project import

6. **Server: `case 'dirs.listSubdirs'`** in `handlers.js`. Use
   `listDirs(path)` to enumerate immediate folders. Return
   `{ type: 'dirs.subdirs', path, entries }` where each entry is
   `{ name, full, isProject }`. `isProject` = `true` when any
   `cfg.projects[].path` matches `full` (case-insensitive on Windows).

7. **Client modal** (`public/js/app.js`).
   - Add a small "Add many…" button next to the existing "New project"
     trigger. Wire `openBulkImport()`:
     - Step 1: open the existing folder picker (`openFolderPicker`) to
       pick a parent.
     - Step 2: on callback, send `{ type: 'dirs.listSubdirs', path }`.
     - Step 3: render a modal listing each subfolder with a checkbox.
       Default-checked = not already a project. Already-imported rows
       are dimmed and disabled. Include a "Select all" toggle at the top.
     - Step 4: on OK, push N entries into `state.cfg.projects` (name =
       folder name, path = `entry.full`, color rotated through
       `PROJECT_COLORS`), call `regroupSessions()`, and send
       `{ type: 'config.update', config: state.cfg }`. Close the modal.

## Phase D — verification + commit

8. **Tests + manual reload.**
   - `npm test` — all suites green.
   - `npm run e2e -- --headed` (or whatever the configured headed runner
     is). Smoke + Ctrl+V paste E2Es pass unchanged.
   - `npm install -g .` to refresh the global install at
     `C:\Users\Lance\AppData\Roaming\npm\node_modules\clideck\`.
   - Hard-reload `localhost:4000`. Walk through:
     a. Right-click a dormant session — confirm new menu appears with
        Rename / Delete.
     b. Rename one, refresh, confirm name persists.
     c. Click a known-broken resumable; confirm the toast and the fresh
        session that lands in active sessions.
     d. "Add many…" against the user's project parent folder; tick a
        couple, OK; confirm the new project rows.

9. **Atomic commits**, each with a rich message in Lance's verbose style:
   - feat: per-row context menu on Previous Sessions (rename/delete)
   - fix: graceful recovery from failed resume (no more orphan dormant rows)
   - feat: bulk project import from a parent folder's subdirectories
   - test: cover resumable handlers + listSubdirs

   No push.

## Deviation policy

- If `sessions.js`'s `resumable` array isn't easily testable without a
  test-only export, prefer adding a tiny `__setResumableForTest` (gated
  by `process.env.NODE_ENV === 'test'`) over restructuring the module.
- If `spawnSession` from inside `onExit` introduces re-entrancy issues
  (sessions.set during a delete window), defer the fresh spawn to
  `queueMicrotask` / `setImmediate`.
- If the bulk import server-side dedupe collides with the existing
  `cfg.projects[].path` shape (some entries lack `path`), guard via
  `(p.path && samePath(p.path, full))`.
