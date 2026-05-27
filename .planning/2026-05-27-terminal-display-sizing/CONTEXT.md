# Phase 9: Terminal display sizing - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

User-adjustable terminal sizing, shipped as one phase because both pieces share
the same post-change machinery (iterate `state.terms`, `fitAddon.fit()`, send a
PTY `resize`):

1. **Terminal font-size control** — change the xterm.js font size for all open
   terminals, persisted across reloads.
2. **Drag-resizable left sidebar** — a draggable gutter that resizes the sidebar;
   the terminal pane (`#main`, already `flex-1`) reflows to fill the rest.

Not in scope: per-session font size, font-family selection, collapsible panels,
cross-device sync of layout.
</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

Requirements, scope, and acceptance criteria are locked in `SPEC.md` (same
directory). Downstream agents MUST read `SPEC.md` before planning or implementing.
Requirements are not duplicated here.

**In scope (from SPEC.md):** font-size control (config field, settings UI,
optional Ctrl/Cmd +/- shortcuts, live apply to all terminals); resizable sidebar
(draggable gutter, width persisted, min/max bounds, reflow on resize, double-click
reset, mobile overlay preserved).
**Out of scope (from SPEC.md):** per-session font size; resizable right-side
panels; server-side/cross-device sync of layout prefs.
</spec_lock>

<decisions>
## Implementation Decisions

> Lance delegated these with "use design best practices." All four gray areas
> below are Claude's-discretion calls, grounded in modern-terminal conventions
> (VS Code, iTerm2, Windows Terminal) and the codebase scout. They are LOCKED for
> downstream agents — treat them as decided, not open.

### Font-size control
- **D-01: Both a settings control and keyboard shortcuts.** Provide a compact
  stepper in Settings (`−  [13px]  +` with a small "Reset" affordance) AND
  keyboard shortcuts active when a terminal is focused: `Ctrl/Cmd + =` increase,
  `Ctrl/Cmd + -` decrease, `Ctrl/Cmd + 0` reset to default. This matches every
  modern terminal's mental model — discoverable control + fast power-user path
  (Lance's primary path).
- **D-02: Range 8–32px, step 1px, default 13px** (13 is today's hardcoded value
  at `public/js/terminals.js:503`). Clamp at both ends.
- **D-03: Apply live to ALL open terminals, instantly.** On change, iterate
  `state.terms`, set `entry.term.options.fontSize` (xterm v6 supports live option
  set), call `entry.fit.fit()`, and send `{type:'resize', id, cols, rows}` per
  terminal. New terminals read the saved size at creation. Global, not
  per-session (per SPEC).
- **D-04: Guard against browser-zoom hijack.** `Ctrl/Cmd + =/-/0` collide with
  browser zoom — the keydown handler MUST `preventDefault()` only when a terminal
  is focused (and not when an input/contenteditable/search box is focused). This
  is the riskiest bit of the font-size work; planner should treat it as a named
  risk and the executor should verify zoom still works outside the terminal.

### Persistence model
- **D-05: config.json is the single source of truth for both prefs.** Add
  `terminalFontSize` (number, default 13) and `sidebarWidth` (number px, default
  354) to `config.js` DEFAULTS; save via the existing `{type:'config.update'}` WS
  path; read from the `config` broadcast into `state.cfg`. This keeps every user
  pref in one place (consistent with `confirmClose`, `defaultTheme`, `notify*`)
  and survives reloads. Overrides the SPEC's tentative "localStorage for width"
  note — we unify on config.
- **D-06: localStorage as a paint-hint for sidebar width ONLY.** The `config`
  broadcast arrives async over WS after first paint, so a config-only sidebar
  width would flash at the 354px default then snap — violating SPEC acceptance
  criterion #7 ("applies before first paint, no visible jump"). Mitigate by
  mirroring `sidebarWidth` to `localStorage` and applying it synchronously on
  `DOMContentLoaded`; when the `config` message arrives, config wins and
  re-syncs localStorage. config remains the source of truth; localStorage is a
  dumb cache. Font-size needs no paint-hint (terminals mount after config
  arrives), so don't add one there.

### Sidebar resize behavior
- **D-07: Live visual reflow during drag; PTY resize on release.** While
  dragging, update the sidebar width live (CSS/inline style) and call
  `fit.fit()` for each terminal throttled to one `requestAnimationFrame` per
  frame, so the terminal pane reflows smoothly. DEFER the PTY `{type:'resize'}`
  message to drag-end (pointerup) — firing SIGWINCH on every pointermove floods
  the shell. Brief xterm-vs-PTY cols/rows skew during the drag is acceptable; the
  release reconciles it.
- **D-08: Bounds — min 280px, max `min(640px, 50vw)`, default/reset 354px.**
  Sidebar content (search, session rows, project names) gets cramped below ~280px
  (raised from the SPEC's tentative 220px because the current default is 354px and
  the rows carry real content). Double-clicking the gutter resets to 354px.
- **D-09: Gutter affordance.** A ~5px-wide drag handle on the sidebar's right
  edge, `cursor: col-resize`, transparent by default with a subtle highlight on
  hover/active and a slightly larger invisible hit zone for ergonomics. Custom
  CSS lives in `src/input.css` (then `npm run build:css`), alongside the existing
  `.drop-overlay` styles.
- **D-10: Desktop-only.** The gutter is inert below the **960px** breakpoint
  (defined as a raw `@media (max-width: 960px)` query in `index.html`), where the
  sidebar is a full-width slide-in overlay. Don't interfere with the existing
  `body.mobile-nav-open` overlay logic.

### Settings placement
- **D-11: Font-size control goes in the existing Appearance tab**
  (`#settings-appearance`), next to theme — it's an appearance setting. The
  sidebar resize has no settings control (drag + double-click-reset only), so it
  needs no placement decision.

### Claude's Discretion
All of D-01…D-11 were Claude's-discretion best-practice calls (Lance delegated).
They are nonetheless locked — downstream agents should implement them as written,
not re-open them. If a decision proves wrong during implementation, flag it as a
deviation rather than silently changing course.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase
- `.planning/2026-05-27-terminal-display-sizing/SPEC.md` — locked requirements,
  scope, and acceptance criteria. Read first.

### Sibling todos (source material, fuller solution sketches + file/line pointers)
- `.planning/todos/completed/2026-05-21-terminal-font-size-control.md`
- `.planning/todos/completed/2026-05-21-resizable-sidebar-width.md`

No external ADRs/specs — this is a self-contained UI phase. Requirements are in
SPEC.md; implementation decisions are in `<decisions>` above.
</canonical_refs>

<code_context>
## Existing Code Insights

(From the 2026-05-27 codebase scout — all file:line current as of v1.31.9.)

### Reusable Assets
- **`state.terms` Map** (`public/js/terminals.js:711`) — each entry holds
  `{ term, fit, el, ... }`. Iterating it to apply font-size and re-fit is
  straightforward; no refactor needed.
- **`fit.fit()` + resize send** — `doFit()` around `public/js/terminals.js:674`
  already pairs `fit.fit()` with `send({type:'resize', id, cols, rows})`. Reuse
  this exact pairing for font-size changes and drag-end.
- **Config plumbing** — `config.js` DEFAULTS (lines ~75-93) is trivially
  extensible; client save path is `saveConfig()` → `{type:'config.update'}`
  (`public/js/settings.js:~587`); client read is the `config` case in
  `public/js/app.js` (`state.cfg = msg.config`).
- **Settings control patterns** — checkbox (`cfg-confirm-close`) and debounced
  text input (`cfg-default-path`) in `public/index.html` + `settings.js` show the
  render/extract/listener wiring to copy for the font-size stepper.
- **Appearance tab** — `#settings-appearance` panel already exists.

### Established Patterns
- **xterm fontSize is hardcoded** at `public/js/terminals.js:503` (`fontSize: 13`)
  — replace with `state.cfg.terminalFontSize ?? 13` at creation.
- **Sidebar is a single fixed-width element** — `#sidebar` `w-[354px]
  min-w-[354px]` at `public/index.html:167`; `#main` is `flex-1`, so changing the
  sidebar width auto-reflows the terminal area. No width baked elsewhere.
- **Custom CSS** for non-Tailwind bits lives in `src/input.css` → built to
  `public/tailwind.css` via `npm run build:css`. Drag-gutter style goes here.
- **Mobile**: raw `@media (max-width: 960px)` in `index.html`; `body.mobile-nav-open`
  drives the slide-in overlay (`#sidebar-shell`).

### Integration Points
- Font-size: terminals.js (creation + a new `applyFontSize` iterating state.terms),
  settings.js (Appearance control), config.js (new field), a keydown handler
  (app.js or terminals.js) for the shortcuts.
- Sidebar: a new gutter element in index.html between `#sidebar-shell` and
  `#main`, pointer handlers (app.js or a small new module mirroring the existing
  `drag.js` pattern), config.js (new field), localStorage paint-hint on load.

### Watch-outs (from scout)
- No blockers. Main risk is the **Ctrl/Cmd +/- browser-zoom collision** (D-04).
- Reflow during drag must throttle the PTY resize (D-07) or it spams SIGWINCH.
</code_context>

<specifics>
## Specific Ideas

Lance's only directive this round was "use design best practices" — he delegated
the specifics. The decisions above follow modern-terminal conventions (VS Code /
iTerm2 / Windows Terminal: stepper + `Ctrl/Cmd +/-/0`, live apply, unobtrusive
drag gutter). No "make it like X" references were given.
</specifics>

<deferred>
## Deferred Ideas

- **Per-session font size** — out of scope per SPEC; start global. Future phase if
  wanted.
- **Font-family / font-weight selection** — not in scope; only size this phase.
- **localStorage paint-hint for font-size** — unnecessary (terminals mount after
  config arrives); only sidebar width needs it (D-06).
- **Cross-device sync of layout prefs** — config.json is local to the host; no
  multi-device story needed for a single-user local tool.

None of these are blockers; discussion stayed within phase scope.
</deferred>

---

*Phase: 9-terminal-display-sizing*
*Context gathered: 2026-05-27*
