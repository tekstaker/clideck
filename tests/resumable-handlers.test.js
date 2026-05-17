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
