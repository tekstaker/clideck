// @vitest-environment node
//
// Server-side resumable session handlers — rename + close.
//
// These tests cover the cases that motivated the 2026-05-17 session UX
// phase: stale resumable entries the user could not rename or delete.
// They exercise sessions.js directly (without spawning real PTYs) and
// assert on the broadcast payloads via a fake WebSocket client.
//
// happy-dom isn't useful here — we want the CommonJS server module,
// not the browser bundle — so each test resets modules and re-requires
// to get a clean `resumable` array.
//
// CLIDECK_DATA_DIR points paths.js at a per-suite tmpdir so we don't
// touch the user's real `~/.clideck/sessions.json` when the persistence
// path fires.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';

let TEST_DATA_DIR;

function freshSessionsModule() {
  // Wipe require cache so module-scope `resumable` resets between tests.
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require('path').sep}clideck${require('path').sep}`) &&
        !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../sessions.js');
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-resumable-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

function captureClient(sessions) {
  const recorded = [];
  const fake = {
    readyState: 1, // OPEN — matches WebSocket.OPEN in the broadcast loop
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

const SAMPLE_ENTRY = {
  id: 'sess-A',
  name: 'Old name',
  commandId: 'claude',
  presetId: 'claude-code',
  cwd: 'C:\\projects\\foo',
  themeId: 'default',
  sessionToken: 'stale-token-aaaaaaa',
  projectId: null,
  muted: false,
  roleName: null,
  lastPreview: '',
  lastActivityAt: null,
  savedAt: '2026-05-17T10:00:00.000Z',
};

describe('renameResumable', () => {
  it('mutates a resumable entry by id and broadcasts sessions.resumable', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    const { recorded } = captureClient(sessions);

    sessions.renameResumable({ id: 'sess-A', name: 'Renamed' }, FAKE_CFG);

    const broadcastList = recorded.find(m => m.type === 'sessions.resumable');
    expect(broadcastList).toBeTruthy();
    expect(broadcastList.list).toHaveLength(1);
    expect(broadcastList.list[0].name).toBe('Renamed');
    expect(broadcastList.list[0].id).toBe('sess-A');
  });

  it('unknown id: no-op, no broadcast, no throw', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    const { recorded } = captureClient(sessions);

    expect(() => sessions.renameResumable({ id: 'does-not-exist', name: 'X' }, FAKE_CFG)).not.toThrow();
    expect(recorded.find(m => m.type === 'sessions.resumable')).toBeUndefined();
  });

  it('persists the renamed entry to disk', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    captureClient(sessions);

    sessions.renameResumable({ id: 'sess-A', name: 'Persisted' }, FAKE_CFG);

    const saved = join(TEST_DATA_DIR, 'sessions.json');
    expect(existsSync(saved)).toBe(true);
    const onDisk = JSON.parse(readFileSync(saved, 'utf8'));
    expect(onDisk).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sess-A', name: 'Persisted' }),
    ]));
  });

  it('empty / whitespace-only name is rejected — entry unchanged', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    const { recorded } = captureClient(sessions);

    sessions.renameResumable({ id: 'sess-A', name: '   ' }, FAKE_CFG);
    expect(recorded.find(m => m.type === 'sessions.resumable')).toBeUndefined();
    expect(sessions.__getResumableForTest()[0].name).toBe('Old name');
  });

  it('overlong name is trimmed to a sane length', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    captureClient(sessions);

    const huge = 'x'.repeat(500);
    sessions.renameResumable({ id: 'sess-A', name: huge }, FAKE_CFG);
    const entry = sessions.__getResumableForTest()[0];
    expect(entry.name.length).toBeLessThanOrEqual(200);
    expect(entry.name.startsWith('xxxx')).toBe(true);
  });
});

describe('close removes a resumable entry', () => {
  it('removes the entry by id and broadcasts the new list', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([
      { ...SAMPLE_ENTRY },
      { ...SAMPLE_ENTRY, id: 'sess-B', name: 'Keep me' },
    ]);
    const { recorded } = captureClient(sessions);

    sessions.close({ id: 'sess-A' }, FAKE_CFG);

    const after = recorded.find(m => m.type === 'sessions.resumable');
    expect(after).toBeTruthy();
    expect(after.list.map(s => s.id)).toEqual(['sess-B']);
  });

  it('close on an id that exists in neither live nor resumable: no broadcast', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    const { recorded } = captureClient(sessions);

    sessions.close({ id: 'unknown' }, FAKE_CFG);
    expect(recorded.find(m => m.type === 'sessions.resumable')).toBeUndefined();
  });
});

// --- Phase 14: replayable persistence track ---
//
// Agent sessions (canResume:true) use the existing resumable path with
// --resume + session token. Plain shells (canResume:false, canReplay:true)
// had no persistence, so a `docker compose restart` lost every shell tab.
// The replayable track persists the same metadata (id, name, cwd, commandId,
// presetId, themeId, projectId, muted, savedAt) with a `replayable:true`
// discriminator and rehydrates them as fresh PTYs in their saved cwd on
// boot. No token, no chat replay, no resume() codepath.
//
// CRITICAL (CONTEXT D-01): partitioning is driven by the EXPLICIT
// `canReplay` capability, NOT an `else`-fallthrough on !canResume. The
// shell cmd in SHELL_CFG therefore carries canReplay:true so saveSessions's
// explicit replay branch fires; a cmd with NEITHER capability is persisted
// to NEITHER bucket.

const SHELL_CFG = {
  commands: [
    { id: 'shell', label: 'Shell', command: process.platform === 'win32' ? 'cmd' : '/bin/sh', canResume: false, canReplay: true, resumeCommand: null },
    { id: 'claude', label: 'Claude', command: 'claude', canResume: true, canReplay: false, resumeCommand: 'claude --resume {{sessionId}}' },
  ],
};

const REPLAYABLE_ENTRY = {
  id: 'sess-R-1',
  name: 'My shell tab',
  commandId: 'shell',
  presetId: 'shell',
  // The rehydrate tests populate cwd with a real existsSync-positive path
  // per-test; the load-partition + save tests don't actually spawn so any
  // path works there.
  cwd: 'will-be-overwritten-per-test',
  themeId: 'default',
  projectId: null,
  muted: false,
  roleName: null,
  lastPreview: '',
  lastActivityAt: null,
  savedAt: '2026-06-03T20:00:00.000Z',
  replayable: true,
};

describe('saveSessions persists replayable shells alongside resumables', () => {
  it('a saved file with no live sessions round-trips both arrays', () => {
    const sessions = freshSessionsModule();
    sessions.__setResumableForTest([{ ...SAMPLE_ENTRY }]);
    sessions.__setReplayableForTest([{ ...REPLAYABLE_ENTRY, cwd: TEST_DATA_DIR }]);

    // No live sessions in the Map — only the pending arrays. saveSessions
    // still must round-trip both into the on-disk file.
    sessions.shutdown(SHELL_CFG); // shutdown -> saveSessions + kill PTYs (none)

    const saved = join(TEST_DATA_DIR, 'sessions.json');
    expect(existsSync(saved)).toBe(true);
    const onDisk = JSON.parse(readFileSync(saved, 'utf8'));

    const replayables = onDisk.filter(e => e.replayable === true);
    const resumables  = onDisk.filter(e => !e.replayable);

    expect(resumables).toHaveLength(1);
    expect(resumables[0].id).toBe('sess-A');
    expect(resumables[0].replayable).toBeUndefined();

    expect(replayables).toHaveLength(1);
    expect(replayables[0].id).toBe('sess-R-1');
    expect(replayables[0].commandId).toBe('shell');
    expect(replayables[0].cwd).toBe(TEST_DATA_DIR);
    expect(replayables[0].sessionToken).toBeUndefined(); // no token on replayable shape
  });
});

describe('loadSessions partitions resumable vs replayable', () => {
  it('routes entries based on the replayable discriminator', () => {
    // Hand-craft a sessions.json with both shapes.
    const SAVED_FILE = join(TEST_DATA_DIR, 'sessions.json');
    const fixture = [
      { ...SAMPLE_ENTRY, id: 'sess-A' },
      { ...REPLAYABLE_ENTRY, id: 'sess-R-1', cwd: TEST_DATA_DIR },
      { ...REPLAYABLE_ENTRY, id: 'sess-R-2', name: 'Other shell', cwd: TEST_DATA_DIR },
    ];
    require('fs').writeFileSync(SAVED_FILE, JSON.stringify(fixture, null, 2));

    const sessions = freshSessionsModule();
    sessions.loadSessions();

    expect(sessions.__getResumableForTest().map(s => s.id)).toEqual(['sess-A']);
    expect(sessions.__getReplayableForTest().map(s => s.id)).toEqual(['sess-R-1', 'sess-R-2']);
  });

  it('pre-fix sessions.json with no replayable key loads as resumable-only (zero-downtime upgrade)', () => {
    // The pre-fix format: a flat array with no `replayable` field on any
    // entry. Every entry must land in the resumable array — the
    // pre-existing user data must not silently change tracks (AC 4).
    const SAVED_FILE = join(TEST_DATA_DIR, 'sessions.json');
    const fixture = [
      { ...SAMPLE_ENTRY, id: 'sess-A' },
      { ...SAMPLE_ENTRY, id: 'sess-B', name: 'Another agent' },
    ];
    require('fs').writeFileSync(SAVED_FILE, JSON.stringify(fixture, null, 2));

    const sessions = freshSessionsModule();
    sessions.loadSessions();

    expect(sessions.__getResumableForTest().map(s => s.id)).toEqual(['sess-A', 'sess-B']);
    expect(sessions.__getReplayableForTest()).toHaveLength(0);
  });
});

describe('rehydrateReplayable spawns plain shells in their saved cwd', () => {
  it('spawns each replayable via createProgrammatic and drains the array', () => {
    const sessions = freshSessionsModule();
    // The cwd must exist for the existsSync check inside rehydrateReplayable
    // to keep the saved path (rather than falling back to $HOME).
    sessions.__setReplayableForTest([
      { ...REPLAYABLE_ENTRY, id: 'sess-R-1', cwd: TEST_DATA_DIR, name: 'Shell tab' },
    ]);

    expect(sessions.__getReplayableForTest()).toHaveLength(1);

    const spawned = sessions.rehydrateReplayable(SHELL_CFG);

    // Replayable array drained — the live sessions Map is now the source
    // of truth for these entries.
    expect(sessions.__getReplayableForTest()).toHaveLength(0);

    // One PTY spawned. The spawnSession path uses real node-pty, so the
    // shell command must exist on the test host (/bin/sh on POSIX,
    // cmd.exe on Windows — both ship with the OS).
    expect(spawned).toBe(1);

    // Cleanup: shutdown closes the spawned PTY so the runner doesn't leave
    // a stray process.
    sessions.shutdown(SHELL_CFG);
  });

  it('falls back to $HOME when the saved cwd no longer exists (AC 5 / T-14-cwd)', () => {
    const sessions = freshSessionsModule();
    sessions.__setReplayableForTest([
      { ...REPLAYABLE_ENTRY, id: 'sess-R-bad', cwd: '/this/path/does/not/exist/at/all/clideck-test' },
    ]);

    const home = process.env.HOME || process.env.USERPROFILE;
    expect(home).toBeTruthy(); // sanity: the test host has a home dir

    const spawned = sessions.rehydrateReplayable(SHELL_CFG);
    expect(spawned).toBe(1); // still spawned, but in $HOME instead of the missing cwd

    sessions.shutdown(SHELL_CFG);
  });

  it('skips entries whose commandId is no longer in the config', () => {
    const sessions = freshSessionsModule();
    sessions.__setReplayableForTest([
      { ...REPLAYABLE_ENTRY, id: 'sess-R-orphan', cwd: TEST_DATA_DIR, commandId: 'no-such-command' },
    ]);

    const spawned = sessions.rehydrateReplayable(SHELL_CFG);
    expect(spawned).toBe(0);
    // Array still drained even on skip — the user can re-spawn via the UI
    // if they want, but the entry doesn't persistently rehydrate-fail.
    expect(sessions.__getReplayableForTest()).toHaveLength(0);
  });

  it('caps rehydrate at 50 entries and WARN-logs the dropped count (D-03 / T-14-DoS)', async () => {
    const { vi } = await import('vitest');
    const sessions = freshSessionsModule();
    // 60 valid replayable entries — 10 over the cap.
    const many = [];
    for (let i = 0; i < 60; i++) {
      many.push({ ...REPLAYABLE_ENTRY, id: `sess-R-${i}`, cwd: TEST_DATA_DIR });
    }
    sessions.__setReplayableForTest(many);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const spawned = sessions.rehydrateReplayable(SHELL_CFG);
      // At most 50 spawned; array drained regardless.
      expect(spawned).toBeLessThanOrEqual(50);
      expect(sessions.__getReplayableForTest()).toHaveLength(0);
      // A warn fired naming the dropped count (60 - 50 = 10).
      const droppedWarn = warnSpy.mock.calls.find(args =>
        args.some(a => typeof a === 'string' && /10/.test(a)));
      expect(droppedWarn).toBeTruthy();
    } finally {
      warnSpy.mockRestore();
      sessions.shutdown(SHELL_CFG);
    }
  });
});
