# SPEC — New-session creator ergonomics

**Status:** planned (not yet discussed/planned — seeded from two pending todos 2026-05-27)
**Owner:** Lance Keay
**Date:** 2026-05-27

## What this delivers

Two friction-removing tweaks to the new-session creator card. Both touch
`public/js/creator.js` and the create flow, and the smaller of the two is
explicitly "bundle me with the other creator fix", so they ship as one phase.

1. **Warn before opening a session in a non-existent path (offer to create it).**
   Today a typed cwd that doesn't exist silently falls back to `os.homedir()`
   with no warning. Add a pre-flight check that surfaces a modal: cancel, or
   create-and-open.
2. **Default the project dropdown to "None".** The dropdown starts unselected and
   forces an explicit pick (or a "choose a project" toast) on every create.
   Pre-seed it to "None (outside project hierarchy)" so the common case is
   zero-friction.

## Why

Both are per-create friction tolls Lance hits constantly:

- **Silent wrong-directory landing.** `creator.js` sends `{ type: 'create', cwd }`
  → `sessions.js:215` calls `resolveValidDir(msg.cwd)` → `utils.js:40-45` returns
  the dir if it `statSync().isDirectory()`, else silently falls back to
  `os.homedir()` with no broadcast. Two failure modes: (a) a typo lands the
  session in `~` and the agent runs against the wrong dir before Lance notices;
  (b) Lance meant to create the folder and expected clideck to mkdir it, but has
  to alt-tab out and do it manually.
- **Forced project pick.** The "None" option exists for the not-in-a-project
  case but isn't the default; submitting without a pick surfaces a toast
  (`creator.js:340`). Lance's flow is overwhelmingly "None", so every create
  pays a needless selection step.

## Scope

**In scope**

### Non-existent path warning

- Client (`creator.js`): before sending `create`, ask the server whether the cwd
  exists. Exists → proceed. Doesn't exist → modal with **Cancel** (return focus to
  the cwd input, offending path selected) and **Create and open** (ask server to
  `mkdir -p`, await ack, then proceed). Reuse the `confirm.js` modal pattern
  already used at `creator.js:111` for the in-cwd collision warning; check whether
  confirm.js needs a 3-button variant.
- Server (`server.js` + `sessions.js`):
  - `{ type: 'check-cwd', path }` → `{ type: 'check-cwd-result', path, exists,
    isDirectory, error }`. Pure stat, no side effects.
  - `{ type: 'mkdir-cwd', path }` → `mkdirSync(path, { recursive: true })` in
    try/catch → `{ type: 'mkdir-cwd-result', path, ok, error }`. Validate the path
    is absolute, reject relative / `..`-containing paths, surface
    EACCES/EPERM/EEXIST cleanly.
  - `resolveValidDir` in `utils.js:40-45` keeps its silent-fallback for
    backwards-compat (resumed sessions whose cwd later vanished still need a soft
    landing). The new client check just stops the *creator* path relying on it.
- Distinct (no "Create" affordance) warnings for: path exists but is a file;
  `EACCES` on stat. Broken symlink → reports not-exists (correct).

### Default project to "None"

- Pre-seed `projHidden.value = NO_PROJECT_VALUE` and set the trigger label to
  "None (outside project hierarchy)" at creator-card open (around
  `creator.js:235` / the picker block `creator.js:252-274`).
- Ensure `cwdWrap.classList.remove('hidden')` runs on initial render so the cwd
  input is visible immediately (None implies user-typed cwd).
- The guard at `creator.js:339` `if (projTrigger && !projHidden.value)` becomes
  effectively dead code — prefer removing it for clarity.
- Explicitly picking a real project then switching back to "None" must still work
  (it already does via `setProjectSelection(NO_PROJECT_VALUE)`).

**Out of scope**

- Folder-picker / drag-folder entries skip the existence check (those paths exist
  by definition).
- Empty/whitespace cwd keeps the existing "default → home dir" behaviour, no warning.
- A "remember my last project" preference — out of scope; default is just "None".

## Acceptance criteria

### Non-existent path warning

1. Submitting the creator with a typed cwd that doesn't exist shows a modal
   instead of silently opening in `~`.
2. **Create and open** mkdir's the path (recursive), then opens the session in it.
3. **Cancel** opens nothing and returns focus to the cwd input with the offending
   path selected.
4. A cwd that exists but is a file shows a distinct "that's a file, not a folder"
   warning with no Create affordance.
5. A cwd that stat's with `EACCES` shows a distinct permission-denied warning with
   no Create affordance.
6. Folder-picker / drag-folder selections (existing paths) do NOT trigger the
   warning.
7. Empty/whitespace cwd does NOT trigger the warning (existing home-dir fallback).
8. `mkdir-cwd` rejects relative paths and paths containing `..`.

### Default project to "None"

9. Opening the creator card shows the project trigger labelled "None (outside
   project hierarchy)" with the hidden input pre-seeded, and the cwd input visible.
10. Submitting immediately (without touching the dropdown) creates an ungrouped
    session with no "choose a project" toast.
11. Real projects still appear in the dropdown and can be selected; switching from
    a real project back to "None" still works.

### Cross-cutting

12. All existing Vitest unit suites pass.
13. All existing Playwright smoke + paste E2E suites pass.

## Non-goals / explicit constraints

- Do **not** push to `origin`. `origin` is GitHub.
- Per the project version-bump rule, bump `package.json` patch on the
  code-changing commit so the connection lozenge reflects the new build.

## Source todos

Seeded from (and supersedes for tracking purposes):

- `.planning/todos/completed/2026-05-22-creator-warn-on-nonexistent-path.md`
- `.planning/todos/completed/2026-05-22-creator-default-project-to-none.md`

Both carry fuller solution sketches, file/line pointers, and edge-case lists. This
SPEC has not yet been through `/gsd-discuss-phase` or `/gsd-plan-phase` — refine
before executing.
