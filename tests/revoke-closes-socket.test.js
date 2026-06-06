// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for sessions.closeDevice() and the
// revoke-broadcast pipeline.
//
// AC mapping:
//   - AC5 (revoke closes live sockets within 1s)
//
// RED reason (expected today):
//   sessions.js does NOT yet export `closeDevice(deviceId)`. Wave 2 plan
//   16-05 adds the helper next to sessions.broadcast (per PATTERNS §2.3,
//   line 207-221 in 16-PATTERNS.md). The handlers.js device.revoke arm
//   (Wave 2 plan 16-05 / Wave 3 plan 16-07) does not exist either. Today
//   the test fails on `sessions.closeDevice is not a function`.
//
// Line-number drift note (CLAUDE.md §1):
//   - PATTERNS.md pin is b4a09fb. Re-grep against current HEAD shows
//     `function broadcast` on sessions.js:53 and `const clients = new
//     Set()` on sessions.js:21 — both unchanged from the planner's
//     references. Recorded in SUMMARY for 16-VERIFICATION.md.
//
// Patterns inherited:
//   - PATTERNS §4.4 — fakeWs() extended with `close: (code, reason)`
//     that records to `sent` AND flips readyState to 3 (CLOSED) so a
//     re-iteration doesn't re-close.
//   - tests/session-pause.test.js:49-57 — captureClient(sessions) idiom
//     that pushes fake wses onto sessions.clients. Adapted here to
//     attach .deviceId / .deviceTokenHash per Pattern A from RESEARCH §4.
//
// Per CLAUDE.md §13 — no real tokens. deviceTokenHash strings are
// 'sha256:' + 64 hex zeros (synthetic, non-cryptographic test fixture).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { EventEmitter } from 'events';

let TEST_DATA_DIR;

function freshSessions() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${sep}clideck${sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../sessions.js');
}

function fakeWs({ deviceId, deviceTokenHash, throwOnClose = false } = {}) {
  const ws = new EventEmitter();
  ws.readyState = 1; // OPEN
  ws.sent = [];
  ws.send = (raw) => { try { ws.sent.push(JSON.parse(raw)); } catch { ws.sent.push(raw); } };
  ws.ping = () => {};
  ws.terminate = () => {};
  // Phase 16 extension (PATTERNS §4.4): record close([code, reason]).
  ws.close = (code, reason) => {
    if (throwOnClose) throw new Error('close failed');
    ws.sent.push({ __close: [code, reason] });
    ws.readyState = 3; // CLOSED
  };
  if (deviceId) ws.deviceId = deviceId;
  if (deviceTokenHash) ws.deviceTokenHash = deviceTokenHash;
  return ws;
}

// Synthetic 'sha256:'-prefixed hash (non-cryptographic, test-only).
function synthHash(seed) {
  const padded = (seed + '0'.repeat(64)).slice(0, 64);
  return 'sha256:' + padded;
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-revoke-socket-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('sessions.closeDevice(deviceId) — closes matching clients only (AC5)', () => {
  it('with 3 clients (2 share dev_A, 1 is dev_B) closeDevice("dev_A") closes both dev_A clients with code 4401/reason "revoked" and leaves dev_B alone', () => {
    const sessions = freshSessions();
    const wsA1 = fakeWs({ deviceId: 'dev_A', deviceTokenHash: synthHash('a') });
    const wsA2 = fakeWs({ deviceId: 'dev_A', deviceTokenHash: synthHash('a') });
    const wsB  = fakeWs({ deviceId: 'dev_B', deviceTokenHash: synthHash('b') });
    sessions.clients.add(wsA1);
    sessions.clients.add(wsA2);
    sessions.clients.add(wsB);

    sessions.closeDevice('dev_A');

    expect(wsA1.sent.find(m => m && m.__close)).toEqual({ __close: [4401, 'revoked'] });
    expect(wsA2.sent.find(m => m && m.__close)).toEqual({ __close: [4401, 'revoked'] });
    expect(wsB.sent.find(m => m && m.__close)).toBeUndefined();
  });

  it('returns the count of clients closed (2 in the case above)', () => {
    const sessions = freshSessions();
    const wsA1 = fakeWs({ deviceId: 'dev_A', deviceTokenHash: synthHash('a') });
    const wsA2 = fakeWs({ deviceId: 'dev_A', deviceTokenHash: synthHash('a') });
    const wsB  = fakeWs({ deviceId: 'dev_B', deviceTokenHash: synthHash('b') });
    sessions.clients.add(wsA1);
    sessions.clients.add(wsA2);
    sessions.clients.add(wsB);

    const closed = sessions.closeDevice('dev_A');
    expect(closed).toBe(2);
  });

  it('tolerates a ws whose close() throws — other matching clients still close (try/catch per-client)', () => {
    const sessions = freshSessions();
    const wsBad = fakeWs({ deviceId: 'dev_X', deviceTokenHash: synthHash('x'), throwOnClose: true });
    const wsGood = fakeWs({ deviceId: 'dev_X', deviceTokenHash: synthHash('x') });
    sessions.clients.add(wsBad);
    sessions.clients.add(wsGood);

    expect(() => sessions.closeDevice('dev_X')).not.toThrow();
    // Good client still saw the close.
    expect(wsGood.sent.find(m => m && m.__close)).toEqual({ __close: [4401, 'revoked'] });
  });

  it('closed clients see the recorded __close as [4401, "revoked"]', () => {
    const sessions = freshSessions();
    const wsA = fakeWs({ deviceId: 'dev_A', deviceTokenHash: synthHash('a') });
    sessions.clients.add(wsA);
    sessions.closeDevice('dev_A');
    const closeRec = wsA.sent.find(m => m && m.__close);
    expect(closeRec).toBeTruthy();
    expect(closeRec.__close[0]).toBe(4401);
    expect(closeRec.__close[1]).toBe('revoked');
  });

  it('AC5 latency: 50 clients on dev_X close synchronously in < 1000ms', () => {
    const sessions = freshSessions();
    const wses = [];
    for (let i = 0; i < 50; i++) {
      const w = fakeWs({ deviceId: 'dev_X', deviceTokenHash: synthHash('x') });
      sessions.clients.add(w);
      wses.push(w);
    }
    const t0 = Date.now();
    const closed = sessions.closeDevice('dev_X');
    const elapsed = Date.now() - t0;
    expect(closed).toBe(50);
    expect(elapsed).toBeLessThan(1000); // AC5 latency budget
    for (const w of wses) {
      expect(w.sent.find(m => m && m.__close)).toEqual({ __close: [4401, 'revoked'] });
    }
  });

  it('closeDevice on an unknown deviceId returns 0 and closes nothing', () => {
    const sessions = freshSessions();
    const wsB = fakeWs({ deviceId: 'dev_B', deviceTokenHash: synthHash('b') });
    sessions.clients.add(wsB);
    expect(sessions.closeDevice('dev_doesnotexist')).toBe(0);
    expect(wsB.sent.find(m => m && m.__close)).toBeUndefined();
  });

  it('broadcast({ type: "device.revoked", deviceId: "dev_A" }) reaches surviving dev_B client', () => {
    const sessions = freshSessions();
    const wsA = fakeWs({ deviceId: 'dev_A', deviceTokenHash: synthHash('a') });
    const wsB = fakeWs({ deviceId: 'dev_B', deviceTokenHash: synthHash('b') });
    sessions.clients.add(wsA);
    sessions.clients.add(wsB);

    sessions.closeDevice('dev_A');
    // After close, the dev_A ws is readyState:3, so broadcast skips it.
    sessions.broadcast({ type: 'device.revoked', deviceId: 'dev_A' });

    const revokedMsg = wsB.sent.find(m => m && m.type === 'device.revoked');
    expect(revokedMsg).toEqual({ type: 'device.revoked', deviceId: 'dev_A' });
    // dev_A's ws was closed; the existing broadcast loop's readyState===1
    // gate (sessions.js:53-55) skips it, so it does NOT receive its own
    // revoke notification.
    expect(wsA.sent.find(m => m && m.type === 'device.revoked')).toBeUndefined();
  });
});
