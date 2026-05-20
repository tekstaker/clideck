// @vitest-environment node
//
// Server-side session reorder — covers the persistence-side of the
// 2026-05-19 session-polish drag-to-reorder deliverable.
//
// The client sends `session.reorder` with the full id sequence after a
// drop. The server reorders both the in-memory `sessions` Map and the
// `resumable` array (so live and dormant rows reorder together), then
// broadcasts `sessions.reorder` so other connected clients sync. The
// existing save path serialises sessions in Map iteration order, so a
// reorder survives shutdown automatically.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-reorder-test-'));
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

const FAKE_CFG = {
  commands: [
    { id: 'claude', label: 'Claude', command: 'claude', canResume: true, resumeCommand: 'claude --resume {{sessionId}}' },
  ],
};

// Bare minimum shape the Map entries need to round-trip through
// saveSessions without throwing. Real entries hold a node-pty handle
// in `pty` and a queue function; neither is touched by reorder.
function fakeLive(id, name) {
  return {
    name, themeId: 'default', commandId: 'claude', presetId: 'claude-code',
    cwd: 'C:\\projects\\x', sessionToken: `tok-${id}`,
    projectId: null, muted: false, ephemeral: false,
    pty: { kill() {} },
    chunks: [], chunksSize: 0,
  };
}

function fakeResumable(id, name) {
  return {
    id, name, commandId: 'claude', presetId: 'claude-code', cwd: 'C:\\projects\\x',
    themeId: 'default', sessionToken: `tok-${id}`, projectId: null, muted: false,
    roleName: null, lastPreview: '', lastActivityAt: null,
    savedAt: '2026-05-19T10:00:00.000Z',
  };
}

describe('reorderSessions', () => {
  it('reorders the in-memory sessions Map to match the given id sequence', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('A', fakeLive('A', 'Alpha'));
    map.set('B', fakeLive('B', 'Bravo'));
    map.set('C', fakeLive('C', 'Charlie'));
    captureClient(sessions);

    sessions.reorderSessions(['C', 'A', 'B'], FAKE_CFG);

    expect([...sessions.getSessions().keys()]).toEqual(['C', 'A', 'B']);
  });

  it('reorders the resumable array for any ids present in the sequence', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([
      fakeResumable('R1', 'Old1'),
      fakeResumable('R2', 'Old2'),
      fakeResumable('R3', 'Old3'),
    ]);
    captureClient(sessions);

    sessions.reorderSessions(['R3', 'R1', 'R2'], FAKE_CFG);

    expect(sessions.__getResumableForTest().map(r => r.id)).toEqual(['R3', 'R1', 'R2']);
  });

  it('broadcasts a sessions.reorder frame with the new sequence', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('A', fakeLive('A', 'Alpha'));
    map.set('B', fakeLive('B', 'Bravo'));
    const { recorded } = captureClient(sessions);

    sessions.reorderSessions(['B', 'A'], FAKE_CFG);

    const frame = recorded.find(m => m.type === 'sessions.reorder');
    expect(frame).toBeTruthy();
    expect(frame.ids).toEqual(['B', 'A']);
  });

  it('appends entries not listed in the sequence at the end (defensive)', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('A', fakeLive('A', 'Alpha'));
    map.set('B', fakeLive('B', 'Bravo'));
    map.set('C', fakeLive('C', 'Charlie'));
    captureClient(sessions);

    // Caller only knows about B and C — A should NOT vanish.
    sessions.reorderSessions(['C', 'B'], FAKE_CFG);

    expect([...sessions.getSessions().keys()]).toEqual(['C', 'B', 'A']);
  });

  it('ignores unknown ids in the sequence without throwing', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('A', fakeLive('A', 'Alpha'));
    map.set('B', fakeLive('B', 'Bravo'));
    captureClient(sessions);

    expect(() => sessions.reorderSessions(['B', 'ghost', 'A'], FAKE_CFG)).not.toThrow();
    expect([...sessions.getSessions().keys()]).toEqual(['B', 'A']);
  });

  it('mixed live + resumable ids in one sequence reorders both stores', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('A', fakeLive('A', 'Alpha'));
    map.set('B', fakeLive('B', 'Bravo'));
    sessions.__setResumableForTest([
      fakeResumable('R1', 'Old1'),
      fakeResumable('R2', 'Old2'),
    ]);
    captureClient(sessions);

    // A, R1, B, R2 — interleaved live + dormant rows
    sessions.reorderSessions(['A', 'R1', 'B', 'R2'], FAKE_CFG);

    expect([...sessions.getSessions().keys()]).toEqual(['A', 'B']);
    expect(sessions.__getResumableForTest().map(r => r.id)).toEqual(['R1', 'R2']);
  });

  it('empty or non-array input is a no-op (no broadcast)', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('A', fakeLive('A', 'Alpha'));
    map.set('B', fakeLive('B', 'Bravo'));
    const { recorded } = captureClient(sessions);

    sessions.reorderSessions([], FAKE_CFG);
    sessions.reorderSessions(null, FAKE_CFG);
    sessions.reorderSessions(undefined, FAKE_CFG);

    expect(recorded.find(m => m.type === 'sessions.reorder')).toBeUndefined();
    expect([...sessions.getSessions().keys()]).toEqual(['A', 'B']);
  });
});
