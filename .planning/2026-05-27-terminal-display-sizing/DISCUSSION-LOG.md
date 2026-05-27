# Phase 9: Terminal display sizing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 9-terminal-display-sizing
**Areas discussed:** Font-size control, Persistence model, Sidebar resize behavior, Settings placement (all delegated to Claude)

---

## How this discussion went

Four gray areas were presented for selection (multi-select). Lance declined to
pick individual areas and answered, via free text: **"use design best practices."**
That delegated all four decisions to Claude with the instruction to apply
modern-terminal conventions. No areas were interrogated question-by-question; all
were resolved as Claude's-discretion calls and locked in CONTEXT.md (D-01…D-11).

The gray areas and the options that had been offered:

## Font-size control
| Option | Description | Selected |
|--------|-------------|----------|
| Settings stepper / slider / +- | affordance choice | (delegated) |
| Ctrl/Cmd +/- shortcuts | add keyboard zoom or not | (delegated) |
| Range / default | min/max px | (delegated) |

**Resolved (D-01..D-04):** stepper in Settings + `Ctrl/Cmd +/-/0` shortcuts;
8–32px range, default 13, live apply to all terminals; guard against browser-zoom
hijack when a terminal is focused.

## Persistence model
| Option | Description | Selected |
|--------|-------------|----------|
| config.json (server) | consistent with other prefs | ✓ (D-05) |
| localStorage (per-device) | no round-trip | partial (D-06, paint-hint only) |

**Resolved (D-05..D-06):** config.json is the source of truth for both
`terminalFontSize` and `sidebarWidth`; localStorage mirrors sidebar width as a
synchronous paint-hint to satisfy the no-flash acceptance criterion.

## Sidebar resize behavior
| Option | Description | Selected |
|--------|-------------|----------|
| Reflow live during drag | smooth, but throttle | ✓ visual (D-07) |
| Reflow on release only | cheaper | ✓ for PTY resize (D-07) |

**Resolved (D-07..D-10):** live rAF-throttled visual fit during drag, single PTY
resize on release; min 280px / max min(640px,50vw) / default+reset 354px; ~5px
col-resize gutter; desktop-only (inert below 960px).

## Settings placement
| Option | Description | Selected |
|--------|-------------|----------|
| Appearance tab | next to theme | ✓ (D-11) |
| General tab | — | |

**Resolved (D-11):** Appearance tab (`#settings-appearance`).

## Claude's Discretion

All four areas — Lance explicitly delegated with "use design best practices."
Decisions grounded in VS Code / iTerm2 / Windows Terminal conventions and the
2026-05-27 codebase scout.

## Deferred Ideas

- Per-session font size (out of scope per SPEC)
- Font-family / weight selection
- localStorage paint-hint for font-size (unnecessary)
- Cross-device sync of layout prefs
