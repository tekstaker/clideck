# Phase 12: clipboard-image-paste - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 12-clipboard-image-paste
**Areas discussed:** Diagnostic strategy

---

## Pre-discussion finding

Code inspection during `scout_codebase` revealed that **SPEC.md's H2
hypothesis is wrong**: the server already synthesizes filenames when
X-Filename is absent (`paste-blobs.js:119-134`, `synthesizeFilename(mime)`
producing ISO-timestamp + 4-byte-hex + canonical extension from a 40+-entry
MIME table). The actual silent failure for SnagIt is most likely H1
(Windows clipboard payloads expose no `image/*` MIME) or a new H5
(`clipboard.read()` throws on permission/lock issues, caught and swallowed
at `terminals.js:288`). This reframing was the foundation for the gray-area
selection below; CONTEXT.md flags it inline so the planner doesn't chase H2.

---

## Gray areas presented (4 — multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnostic strategy | Diagnose-first vs fix-all vs toast-only — drives plan shape. | ✓ |
| Filename ownership | Client vs server vs both — moot once code review showed server already owns this. | |
| Diagnostic logging gate | `window.__debugClipboard` matching `__logHotkeys` precedent vs no gate. | |
| Unreadable-clipboard toast trigger | Narrow vs broad vs none — needs settling once strategy is set. | |

**User's choice:** Diagnostic strategy only. Other three folded into the strategy follow-up since the strategy choice determined the rest.
**Notes:** Selecting only the one critical decision was the right call — the other three collapse cleanly once strategy is chosen.

---

## Diagnostic strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnose first, then targeted fix | Throwaway :4099 + temporary console.log instrumentation, run all three sources, observe, then patch the actual failure mode. | |
| Fix all plausible angles speculatively + add diagnostic logging | One planning pass patches every plausible failure mode (H1 toast, H4 try/catch, H5 visible toast, diagnostic gate) defensively. | ✓ |
| Diagnostic + toast only, no behaviour change to binary branch | Treat binary branch as innocent until proven guilty — only add toast + log gate. | |

**User's choice:** Fix all plausible angles speculatively + add diagnostic logging.
**Notes:** Matches the stated autonomy preference — single planning pass, single execute pass, defensive coverage. The patches are small and additive (no contract changes, no signature changes), so over-fixing has a low cost; under-fixing means another bounce.

---

## Patch list (confirmation)

| Option | Description | Selected |
|--------|-------------|----------|
| Sign off as listed | Six items: getType try/catch (H4), clipboard.read rejection toast (H5), unreadable-clipboard toast (H1), `__debugClipboard` log gate, client sends no X-Filename (server owns naming), Vitest covering clipboard-image upload + H5 rejection. | ✓ |
| Sign off with adjustments | Redirect any item before locking. | |
| Drop diagnostic logging gate | Same as 'sign off as listed' but skip the `__debugClipboard` gate. | |

**User's choice:** Sign off as listed.
**Notes:** All six items locked into CONTEXT.md as D-02 through D-07. Implementation surface is `public/js/terminals.js` only — server is byte-identical after this phase.

---

## Claude's Discretion

- Exact wording for the unreadable-clipboard toast (D-04) — short, actionable, "save it as a file and drag it in" is a starting point.
- Exact name for the diagnostic gate (`window.__debugClipboard` vs `__logClipboard`) — pick to harmonise with `__logHotkeys`.
- Whether the per-item `getType()` try/catch logs unconditionally vs only behind the gate — gate is fine.

## Deferred Ideas

- Routing image bytes to a multi-modal model directly (future phase).
- Honouring source-app filename hints (no source provides them today).
- Ctrl+V from File-Explorer-COPIED files — out of scope here per SPEC, deferred from source todo.
- Image-paste preview thumbnail toast — UX nicety, not required.
