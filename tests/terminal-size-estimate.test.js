// @vitest-environment happy-dom
//
// Spawn-size accuracy for new sessions (2026-05-28 terminal-cursor-offset fix).
//
// The PTY is spawned at estimateSize() BEFORE the real xterm mounts and
// fits, so estimateSize() is the width an agent's TUI first paints against.
// The old heuristic (floor((#terminals.clientWidth - 8) / 7.8), ignoring the
// scrollbar gutter) over-estimated by 1-2 columns at every realistic window
// width. A raw-mode editor (Claude Code's input box) painted at that inflated
// width and stayed one column off; the later corrective resize fixed the PTY
// but not the agent's stale layout.
//
// The fix: when a terminal is already live, a new one fits the SAME
// #terminals area, so estimateSize() returns the live terminal's exact
// cols/rows — no guessing. These tests pin that behaviour.

import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../public/js/state.js';
import { estimateSize } from '../public/js/terminals.js';

function fakeTerm(id, cols, rows, { active = false } = {}) {
  const el = document.createElement('div');
  el.className = 'term-wrap' + (active ? ' active' : '');
  return { term: { cols, rows }, el };
}

beforeEach(() => {
  state.terms.clear();
  document.body.innerHTML = '<div id="terminals"></div>';
});

describe('estimateSize', () => {
  it('returns a live terminal\'s exact cols/rows instead of a guess', () => {
    state.terms.set('a', fakeTerm('a', 137, 42, { active: true }));
    expect(estimateSize()).toEqual({ cols: 137, rows: 42 });
  });

  it('prefers the active terminal when several are open', () => {
    state.terms.set('a', fakeTerm('a', 100, 30));
    state.terms.set('b', fakeTerm('b', 137, 42, { active: true }));
    expect(estimateSize()).toEqual({ cols: 137, rows: 42 });
  });

  it('falls back to any fitted terminal when none is marked active', () => {
    state.terms.set('a', fakeTerm('a', 120, 40));
    expect(estimateSize()).toEqual({ cols: 120, rows: 40 });
  });

  it('ignores terminals that have not fitted yet (cols/rows still 0)', () => {
    state.terms.set('a', fakeTerm('a', 0, 0));
    // No usable live terminal -> heuristic fallback, which still clamps to the
    // documented minimum of 80x24 in a zero-size (unlaid-out) test DOM.
    const { cols, rows } = estimateSize();
    expect(cols).toBeGreaterThanOrEqual(80);
    expect(rows).toBeGreaterThanOrEqual(24);
  });

  it('cold start (no terminals) returns at least the documented minimum', () => {
    const { cols, rows } = estimateSize();
    expect(cols).toBeGreaterThanOrEqual(80);
    expect(rows).toBeGreaterThanOrEqual(24);
  });
});
