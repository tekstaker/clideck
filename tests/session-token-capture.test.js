// @vitest-environment node
//
// Token capture broadcast — regression net for the bug Lance hit during
// session-pause UAT: the Pause menu item stayed grayed out for real
// Claude Code sessions because token capture happens via OTEL
// telemetry (not via the output regex), and the original code only
// broadcast `session.token` from one of the five capture sites.
//
// The fix funnels every capture path through `captureToken(id, token)`
// which sets the token AND broadcasts on the first-set edge.
//
// These tests pin the helper's behaviour directly. The cross-module
// wiring (telemetry-receiver, opencode-bridge, hook handlers) is
// verified by code review — they all now call captureToken via the
// injected captureTokenFn ref.

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
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-token-test-'));
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

describe('captureToken', () => {
  it('sets the session token on first call and broadcasts session.token', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    const s = { name: 'A', sessionToken: null };
    map.set('sess-A', s);
    const { recorded } = captureClient(sessions);

    const result = sessions.captureToken('sess-A', 'tok-xyz');

    expect(result).toBe(true);
    expect(s.sessionToken).toBe('tok-xyz');
    const broadcast = recorded.find(m => m.type === 'session.token');
    expect(broadcast).toEqual({ type: 'session.token', id: 'sess-A', hasToken: true });
  });

  it('does NOT re-broadcast on subsequent calls (token already set)', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('sess-A', { name: 'A', sessionToken: 'tok-first' });
    const { recorded } = captureClient(sessions);

    // Second capture with a different value (mimicking the
    // telemetry-receiver "dominated" overwrite path).
    const result = sessions.captureToken('sess-A', 'tok-second');

    expect(result).toBe(false);
    expect(map.get('sess-A').sessionToken).toBe('tok-second');
    expect(recorded.find(m => m.type === 'session.token')).toBeUndefined();
  });

  it('is a no-op when the session does not exist', () => {
    const sessions = freshSessionsModule();
    const { recorded } = captureClient(sessions);

    const result = sessions.captureToken('ghost', 'tok-xyz');

    expect(result).toBe(false);
    expect(recorded.find(m => m.type === 'session.token')).toBeUndefined();
  });

  it('is a no-op when the token value is falsy', () => {
    const sessions = freshSessionsModule();
    const map = sessions.getSessions();
    map.set('sess-A', { name: 'A', sessionToken: null });
    const { recorded } = captureClient(sessions);

    sessions.captureToken('sess-A', null);
    sessions.captureToken('sess-A', '');
    sessions.captureToken('sess-A', undefined);

    expect(map.get('sess-A').sessionToken).toBeNull();
    expect(recorded.find(m => m.type === 'session.token')).toBeUndefined();
  });
});
