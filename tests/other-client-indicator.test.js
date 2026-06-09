// @vitest-environment happy-dom
//
// Phase 15 R5 — `updateOtherClientIndicator` DOM toggle (TDD RED-state contract).
//
// SPEC R5 (.planning/2026-06-02-mobile-desktop-concurrent-access/SPEC.md):
//   "Soft 'other client connected' indicator on session rows. When ≥2 WS
//   clients are present on the server, every session row in every connected
//   client shows a small visual indicator." Updates within 5s on appear,
//   10s on disappear (per acceptance).
//
// CONTEXT D-10 / D-11 / UI-SPEC "Other-client indicator — exact contract":
//   - Single shared state flag: `state.otherClientsConnected = count > 1`.
//   - Every `.other-client-indicator` span in the DOM gets its `.hidden`
//     Tailwind class removed when count > 1, re-added when count <= 1.
//   - No per-session bookkeeping — server-wide count drives all rows.
//
// G9 risk (15-VALIDATION.md): when a NEW session row is added to the DOM
// after the indicator has already been turned ON globally, the new row's
// indicator (rendered default `.hidden`) must inherit the current global
// state. The contract is "calling `updateOtherClientIndicator(count)` is
// idempotent and brings every indicator span — including ones added after
// the last call — into the correct state."
//
// This test is authored RED per CLAUDE.md §2 (TDD-first). It will FAIL at
// IMPORT time today because `public/js/terminals.js` does not yet export
// `updateOtherClientIndicator`. Plan 15-05 adds the export and the body,
// and these tests turn GREEN.
//
// Analog: tests/font-size-clamp.test.js + tests/terminal-size-estimate.test.js
// — same happy-dom env, same `import { state } from '../public/js/state.js'`
// + `import { ... } from '../public/js/terminals.js'` shape, same
// per-test DOM/state reset in beforeEach.

import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../public/js/state.js';
import { updateOtherClientIndicator } from '../public/js/terminals.js';

beforeEach(() => {
  // state.js is a module-singleton across tests, same as the
  // terminal-size-estimate.test.js precedent (`state.terms.clear()`).
  // Reset the flag and the DOM so each test starts clean.
  state.otherClientsConnected = false;
  document.body.innerHTML = '';
});

describe('updateOtherClientIndicator (Phase 15 R5)', () => {
  it('removes .hidden from every .other-client-indicator when count > 1', () => {
    // Two session rows each carry the indicator span, both default-hidden.
    document.body.innerHTML = `
      <span class="other-client-indicator hidden"></span>
      <span class="other-client-indicator hidden"></span>
    `;

    updateOtherClientIndicator(2);

    expect(state.otherClientsConnected).toBe(true);
    for (const el of document.querySelectorAll('.other-client-indicator')) {
      expect(el.classList.contains('hidden')).toBe(false);
    }
  });

  it('re-adds .hidden on every .other-client-indicator when count <= 1', () => {
    // Simulate the "already on" state: two indicators currently visible,
    // flag already true. A drop to count=1 (the other client closed) must
    // hide them all and clear the flag.
    document.body.innerHTML = `
      <span class="other-client-indicator"></span>
      <span class="other-client-indicator"></span>
    `;
    state.otherClientsConnected = true;

    updateOtherClientIndicator(1);

    expect(state.otherClientsConnected).toBe(false);
    for (const el of document.querySelectorAll('.other-client-indicator')) {
      expect(el.classList.contains('hidden')).toBe(true);
    }
  });

  it('G9 — newly-added rows after the global flag is on inherit the visible state', () => {
    // Phase 15 risk G9: a session is created AFTER another client has
    // already connected. The new row's `.other-client-indicator` span is
    // rendered with the default `.hidden` class (per UI-SPEC DOM contract);
    // calling `updateOtherClientIndicator` again — which the addTerminal
    // path does at render time, or a re-broadcast triggers — must lift
    // `.hidden` from the new span too, not just the old ones.
    document.body.innerHTML = `
      <span class="other-client-indicator" data-row="first"></span>
    `;
    state.otherClientsConnected = true;
    updateOtherClientIndicator(2);

    // Now a new session row arrives — its indicator is default-hidden.
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span class="other-client-indicator hidden" data-row="new"></span>',
    );

    // Re-call the updater (analogous to addTerminal re-syncing on render).
    updateOtherClientIndicator(2);

    const newSpan = document.querySelector('[data-row="new"]');
    expect(newSpan.classList.contains('hidden')).toBe(false);
    // First span stays visible too.
    const firstSpan = document.querySelector('[data-row="first"]');
    expect(firstSpan.classList.contains('hidden')).toBe(false);
  });

  it('is a no-op when no indicator spans exist in the DOM', () => {
    // Empty-body case — no rows yet (fresh boot, before any session
    // renders). The flag still updates; the DOM walk just finds nothing.
    expect(() => updateOtherClientIndicator(2)).not.toThrow();
    expect(state.otherClientsConnected).toBe(true);

    expect(() => updateOtherClientIndicator(1)).not.toThrow();
    expect(state.otherClientsConnected).toBe(false);
  });
});
