// @vitest-environment node
//
// Server-side session pause — the user-triggered counterpart of the
// natural-exit "move to resumable" transition.
//
// These tests exercise the pause() handler directly. We can't easily
// spawn a real PTY in test, so we seed the sessions Map with a fake
// session (and a stub `pty.kill()` we can spy on), call pause(), and
// assert on the resulting state + broadcast frames.
//
// The key behaviours pinned here:
//   - pause WITH a captured token: kills PTY, moves to resumable,
//     broadcasts `closed` (reason: 'paused') and an updated
//     `sessions.resumable`.
//   - pause WITHOUT a captured token: returns an error frame to the
//     originating client, leaves the session alive, broadcasts
//     NOTHING (no closed, no resumable update).
//   - pause WITHOUT a canResume command: same refusal as no-token.
//   - the resumable record matches the natural-exit shape (verified
//     by saveSessions's on-disk JSON containing the same fields).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, readFileSync } from 'fs';

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
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-pause-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

function captureClient(sessions) {
  const recorded = [];
  const fake = {
    readyState: 1,
    send: (raw) => recorded.push(JSON.parse(raw)),
  };
  sessions.clients.add(fake);
  return { fake, recorded };
}

const CFG_WITH_RESUME = {
  commands: [
    {
      id: 'claude',
      label: 'Claude',
      command: 'claude',
      canResume: true,
      resumeCommand: 'claude --resume {{sessionId}}',
    },
  ],
};

const CFG_NO_RESUME = {
  commands: [
    { id: 'shell', label: 'Shell', command: 'cmd.exe', canResume: false },
  ],
};

function fakeLiveSession({ id = 'sess-X', name = 'Alpha', commandId = 'claude', token = 'tok-aaa' } = {}) {
  return {
    name, themeId: 'default', commandId, presetId: 'claude-code',
    cwd: 'C:\\projects\\x', sessionToken: token,
    projectId: null, muted: false, ephemeral: false,
    pty: { kill: vi.fn() },
    chunks: [], chunksSize: 0,
    lastPreview: 'last output line', lastActivityAt: '2026-05-20T11:00:00.000Z',
    roleName: null,
  };
}

describe('pause — with captured token', () => {
  it('kills the PTY, moves to resumable, broadcasts closed + resumable update', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    const s = fakeLiveSession({ id: 'sess-A' });
    map.set('sess-A', s);
    const { fake, recorded } = captureClient(sessions);

    sessions.pause({ id: 'sess-A' }, fake, CFG_WITH_RESUME);

    expect(s.pty.kill).toHaveBeenCalledTimes(1);
    expect(map.has('sess-A')).toBe(false);

    const closed = recorded.find(m => m.type === 'closed');
    expect(closed).toEqual(expect.objectContaining({ id: 'sess-A', reason: 'paused' }));

    const resumableBcast = recorded.find(m => m.type === 'sessions.resumable');
    expect(resumableBcast).toBeTruthy();
    expect(resumableBcast.list).toHaveLength(1);
    expect(resumableBcast.list[0]).toEqual(expect.objectContaining({
      id: 'sess-A',
      name: 'Alpha',
      commandId: 'claude',
      sessionToken: 'tok-aaa',
      cwd: 'C:\\projects\\x',
    }));
  });

  it('persists the resumable record to sessions.json', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('sess-A', fakeLiveSession({ id: 'sess-A' }));
    const { fake } = captureClient(sessions);

    sessions.pause({ id: 'sess-A' }, fake, CFG_WITH_RESUME);

    // saveSessions is called by the caller in production (handlers.js
    // wraps pause + save). The test invokes the side effect directly.
    sessions.shutdown?.(CFG_WITH_RESUME); // ensure final flush
    // Re-load: confirm the on-disk record contains the paused session.
    const saved = JSON.parse(readFileSync(join(TEST_DATA_DIR, 'sessions.json'), 'utf8'));
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sess-A', name: 'Alpha', sessionToken: 'tok-aaa' }),
    ]));
  });
});

describe('pause — refused', () => {
  it('refuses (no broadcast, no kill) when the session has no token', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    const noToken = fakeLiveSession({ id: 'sess-A', token: null });
    map.set('sess-A', noToken);
    const { fake, recorded } = captureClient(sessions);

    sessions.pause({ id: 'sess-A' }, fake, CFG_WITH_RESUME);

    expect(noToken.pty.kill).not.toHaveBeenCalled();
    expect(map.has('sess-A')).toBe(true);
    expect(recorded.find(m => m.type === 'closed')).toBeUndefined();
    expect(recorded.find(m => m.type === 'sessions.resumable')).toBeUndefined();

    // An error frame was sent back to the originating ws (NOT broadcast,
    // hence we expect it on the client-side capture path).
    expect(recorded.find(m => m.type === 'error')).toBeTruthy();
  });

  it('refuses when the command does not support resume', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    const shellSession = fakeLiveSession({ id: 'sess-A', commandId: 'shell', token: 'tok-aaa' });
    map.set('sess-A', shellSession);
    const { fake, recorded } = captureClient(sessions);

    sessions.pause({ id: 'sess-A' }, fake, CFG_NO_RESUME);

    expect(shellSession.pty.kill).not.toHaveBeenCalled();
    expect(map.has('sess-A')).toBe(true);
    expect(recorded.find(m => m.type === 'error')).toBeTruthy();
  });

  it('refuses on unknown session id (no throw, no broadcast)', () => {
    const sessions = freshSessionsModule();
    const { fake, recorded } = captureClient(sessions);

    expect(() => sessions.pause({ id: 'ghost' }, fake, CFG_WITH_RESUME)).not.toThrow();
    expect(recorded.find(m => m.type === 'closed')).toBeUndefined();
  });
});

describe('list() exposes hasToken', () => {
  it('reports hasToken=true for a session with a captured token', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('sess-A', fakeLiveSession({ id: 'sess-A', token: 'tok-aaa' }));

    const listed = sessions.list();
    expect(listed.find(s => s.id === 'sess-A').hasToken).toBe(true);
  });

  it('reports hasToken=false for a session without a captured token', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('sess-B', fakeLiveSession({ id: 'sess-B', token: null }));

    const listed = sessions.list();
    expect(listed.find(s => s.id === 'sess-B').hasToken).toBe(false);
  });
});
