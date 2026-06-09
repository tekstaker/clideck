// @vitest-environment node
//
// Phase 15 R2 — server-side resize lock (TDD RED-state contract).
//
// SPEC R2 (.planning/2026-06-02-mobile-desktop-concurrent-access/SPEC.md):
//   "PTY size is locked at session creation; later `resize` messages are
//   ignored." — the server's `sessions.resize(msg)` handler must be a
//   no-op so that two clients at different viewport sizes can attach to
//   the same session without fighting over the PTY's cols/rows.
//
// CONTEXT D-04 (15-CONTEXT.md): "Server-side only no-op. The change is in
// sessions.js:368 (`function resize(msg) { sessions.get(msg.id)?.pty.resize(...) }`)
// — replace the body with a no-op." (Today on main this lives at sessions.js:417 —
// line drifted due to Phase 16's device-pairing additions; the contract is
// unchanged.)
//
// This test is authored RED per CLAUDE.md §2 (TDD-first). It will FAIL today
// because the current implementation IS a passthrough that calls
// `pty.resize(msg.cols, msg.rows)`. Plan 15-02 replaces the body with a
// no-op and this test turns GREEN.
//
// Analog: tests/session-pause.test.js — same env, same freshSessionsModule,
// same fake-PTY-with-vi.fn() spy idiom. The only differences: spy target is
// `pty.resize` instead of `pty.kill`, and the fake session is minimal
// (we don't need the full pause-flow fields).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

let TEST_DATA_DIR;

function freshSessionsModule() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require('path').sep}clideck${require('path').sep}`) &&
        !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../sessions.js');
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-resize-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

function fakeLiveSession({ id = 'sess-X' } = {}) {
  return {
    name: 'A',
    sessionToken: null,
    pty: { resize: vi.fn() },
  };
}

describe('sessions.resize — locked at session creation (Phase 15 R2)', () => {
  it('does NOT call pty.resize when a resize message arrives for a known session', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    const s = fakeLiveSession({ id: 'sess-A' });
    map.set('sess-A', s);

    sessions.resize({ id: 'sess-A', cols: 40, rows: 10 });

    // The contract: cols/rows passed at create-time are the ONLY value the
    // PTY ever sees. Later client resize messages MUST NOT reshape the PTY,
    // otherwise a small-viewport client (phone) joining a session would
    // shrink the desktop user's terminal under them.
    expect(s.pty.resize).not.toHaveBeenCalled();
  });

  it('does not throw for an unknown session id', () => {
    const sessions = freshSessionsModule();

    // Ghost-id resize messages can arrive in two ways: a session that just
    // closed but the client hasn't unmounted its fit listener yet, or a
    // forged WS frame. Either way: silent no-op, not an exception.
    expect(() => sessions.resize({ id: 'ghost', cols: 80, rows: 24 })).not.toThrow();
  });

  it('does not throw when the message has no id at all', () => {
    const sessions = freshSessionsModule();

    // Defence-in-depth — the server already coexists with the existing
    // client which sends well-formed `{type:'resize', id, cols, rows}`,
    // but a malformed frame must not crash the handler.
    expect(() => sessions.resize({})).not.toThrow();
  });
});
