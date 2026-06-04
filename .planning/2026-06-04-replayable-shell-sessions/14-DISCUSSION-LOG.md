# Phase 14: replayable-shell-sessions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 14-replayable-shell-sessions
**Areas discussed:** Route (3-way decision), Spawn-storm cap, On-disk schema shape

---

## Route — what to do with the inherited candidate branch (`28d5683`)

| Option | Description | Selected |
|--------|-------------|----------|
| Merge-as-is (rebase + smoke) | Candidate is clean and fully tested. Rebase onto main (v1.31.14), resolve version, npm test, manual :4099 smoke per AC 1-5, open PR. Smallest scope. | |
| Modify-then-merge | Keep the candidate's structure but apply tweaks before merging. Small diff on top of the candidate. | |
| Replace (redesign) | Scrap the branch; add a real `replay`/`canReplay` field to the preset schema (parallel to `canResume`) instead of a per-entry discriminator-by-fallthrough. Candidate tests remain a reference. | ✓ |

**User's choice:** Replace (redesign)
**Notes:** Reviewer (pre-question) flagged that the candidate's clean diff was
mergeable, but Lance chose the more elegant redesign. The decisive weakness of
the candidate: it infers replayability from the **absence** of resumability (an
`else` branch in `saveSessions`), which is implicit and over-broad — any future
non-resumable preset would silently start being persisted-and-respawned. The
redesign makes replay an explicit, opt-in preset capability (`canReplay`,
parallel to `canResume`). The candidate branch is NOT merged; it serves as a
reference implementation for the `rehydrateReplayable` shape, the `replayable[]`
array, the server.js wire-up position, and the 6 tests. See CONTEXT.md D-01.

---

## Spawn-storm cap — boot-time DoS mitigation

| Option | Description | Selected |
|--------|-------------|----------|
| Add slice(0,50) cap + WARN log | Cheap one-line insurance: rehydrate at most 50 replayable entries, WARN if more were dropped. Defends against a tampered/runaway sessions.json. | ✓ |
| No cap | Single-user, container-internal; you'd have to manually open 50+ shell tabs to hit it. Accept the risk per the threat model. | |

**User's choice:** Add slice(0,50) cap + WARN log
**Notes:** SPEC threat model listed this as "mitigate (optional) — reviewer's
call". Resolved = add it. The candidate branch has no cap, so this is a net-new
behaviour the redesign must include, plus a 7th test. 50 is a default sketch;
planner may make it a named constant. See CONTEXT.md D-03.

---

## On-disk schema shape

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Shape 1 (discriminator in sessions.json) | One flat array; replay entries carry `replayable: true`; zero-downtime upgrade already proven by a pre-fix-file test; smallest diff. AC 2's jq inspection assumes this shape. | ✓ |
| Switch to Shape 2 (separate replayable.json) | File-level separation of the two tracks — two writeFileSync calls, a second load path, AC 2's inspection command changes. More surgery. | |

**User's choice:** Keep Shape 1 (discriminator)
**Notes:** Note the resulting naming split (intentional): the preset capability
is `canReplay` (from the Replace route, D-01); the on-disk per-entry
discriminator stays `replayable: true` (this decision, D-02). Capability vs.
row-marker — parallel to `canResume` (capability) vs. the partitioned arrays
(state). See CONTEXT.md D-02.

---

## Claude's Discretion

- Exact `canReplay` field name (capability verb; `canReplay` preferred for
  symmetry with `canResume`).
- The spawn-cap constant value/name (50 is the default sketch).
- Whether `canReplay` surfaces in the Settings agent-editor UI — leaning **no**
  (UI scope creep; shell preset is built-in and not user-edited).
- Whether rehydrate logs harmonise with the Phase-13 shutdown-feedback logging
  tone (cosmetic).

## Deferred Ideas

- `canReplay` toggle in the Settings agent-editor UI (custom non-agent presets).
- "Rehydrated shell" UI affordance (badge/tooltip).
- Persisting plain-shell scrollback / output history (much larger separate phase).
- Per-preset rate-limiting on rehydrate spawns beyond the count cap.
