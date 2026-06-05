// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for the WS upgrade auth gate
// (verifyClient + Sec-WebSocket-Protocol token extraction).
//
// AC mapping:
//   - AC4 (unknown token = reject — WS close 4401, never in sessions.clients)
//
// RED reason (expected today):
//   `../auth-gate.js` does not exist. server.js:368 still has the 1-arg
//   verifyClient form `({ req }) => isAllowedWsOrigin(...)`. Wave 2 plan
//   16-05 must extract a `makeVerifyClient({ devices, isAllowedWsOrigin })`
//   factory + a `readDeviceToken(req)` helper to a module the tests can
//   drive directly. If 16-05 prefers to inline both into server.js, they
//   STILL must be exported from a top-level require so this spec can
//   drive them in isolation — that requirement is the locked contract
//   here.
//   freshGate() throws MODULE_NOT_FOUND on every it-block today.
//
// Line-number drift note: PATTERNS.md was pinned to commit b4a09fb.
// Re-grep against current HEAD (feat/device-pairing-for-mobile-access
// at a38d0b0) confirms verifyClient is on server.js:368 (one-line
// drift from the plan's "366"). The test references behaviour, not
// line numbers, so the drift is harmless here.
//
// Per CLAUDE.md §13 — the synthetic rawToken used in the happy-path is
// generated per-test via Math.random; no real high-entropy token literal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync } from 'fs';

let TEST_DATA_DIR;

function freshGate() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${sep}clideck${sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  // Wave 2 plan 16-05 must export { makeVerifyClient, readDeviceToken }
  // from this single module so tests can drive them without booting the
  // full server. Inlining into server.js is allowed only if the two
  // helpers are still top-level requires.
  return {
    devices: require('../devices.js'),
    authGate: require('../auth-gate.js'),
  };
}

function syntheticToken() {
  return 'test-token-NOT-real-' + Math.random().toString(36).slice(2)
    + '-' + Math.random().toString(36).slice(2);
}

function fakeReq({ origin = 'http://localhost:4099', host = 'localhost:4099', subprotocol = undefined } = {}) {
  const headers = { origin, host };
  if (subprotocol !== undefined) headers['sec-websocket-protocol'] = subprotocol;
  return { headers };
}

// In-test isAllowedWsOrigin stub — accepts everything by default. Override
// per-test when we want to assert the origin check runs before the token
// check.
function makeAllowOrigin(allowed = true) {
  return () => allowed;
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-ws-auth-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('verifyClient — rejection paths (AC4)', () => {
  it('missing Sec-WebSocket-Protocol header → callback(false, 401, "unpaired")', () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({});
    let cb;
    const result = new Promise((resolve) => { cb = (verified, code, reason) => resolve({ verified, code, reason }); });
    verify({ req }, cb);
    return result.then(({ verified, code, reason }) => {
      expect(verified).toBe(false);
      expect(code).toBe(401);
      expect(reason).toBe('unpaired');
    });
  });

  it('Sec-WebSocket-Protocol contains only the sentinel (no token) → callback(false, 401, "unpaired")', () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ subprotocol: 'clideck-device-token' });
    let cb;
    const result = new Promise((resolve) => { cb = (verified, code, reason) => resolve({ verified, code, reason }); });
    verify({ req }, cb);
    return result.then(({ verified, code, reason }) => {
      expect(verified).toBe(false);
      expect(code).toBe(401);
      expect(reason).toBe('unpaired');
    });
  });

  it('Sec-WebSocket-Protocol carries an unknown token → callback(false, 401, "unpaired")', () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ subprotocol: 'clideck-device-token, totally-not-a-known-token' });
    let cb;
    const result = new Promise((resolve) => { cb = (verified, code, reason) => resolve({ verified, code, reason }); });
    verify({ req }, cb);
    return result.then(({ verified, code, reason }) => {
      expect(verified).toBe(false);
      expect(code).toBe(401);
      expect(reason).toBe('unpaired');
    });
  });

  it('origin disallowed → callback(false, 403, "origin not allowed") — runs BEFORE the token check', () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(false) });
    const rawToken = syntheticToken();
    // A KNOWN token — proves origin runs first regardless of token validity.
    devices.add({ label: 'X', uaFingerprint: 'ua', rawToken });
    const req = fakeReq({ subprotocol: 'clideck-device-token, ' + rawToken });
    let cb;
    const result = new Promise((resolve) => { cb = (verified, code, reason) => resolve({ verified, code, reason }); });
    verify({ req }, cb);
    return result.then(({ verified, code, reason }) => {
      expect(verified).toBe(false);
      expect(code).toBe(403);
      expect(reason).toBe('origin not allowed');
    });
  });
});

describe('verifyClient — happy path + req stash', () => {
  it('valid token in subprotocol → callback(true); req.clideckDevice.id matches added device', () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const rawToken = syntheticToken();
    const rec = devices.add({ label: 'Phone', uaFingerprint: 'ua-x', rawToken });
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ subprotocol: 'clideck-device-token, ' + rawToken });
    let cb;
    const result = new Promise((resolve) => { cb = (verified, code, reason) => resolve({ verified, code, reason }); });
    verify({ req }, cb);
    return result.then(({ verified }) => {
      expect(verified).toBe(true);
      expect(req.clideckDevice).toBeTruthy();
      expect(req.clideckDevice.id).toBe(rec.id);
    });
  });

  it('successful verify stashes req.clideckDevice.token_hash for the onConnection wrapper', () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const rawToken = syntheticToken();
    const rec = devices.add({ label: 'Phone', uaFingerprint: 'ua-x', rawToken });
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ subprotocol: 'clideck-device-token, ' + rawToken });
    let cb;
    const result = new Promise((resolve) => { cb = (verified) => resolve(verified); });
    verify({ req }, cb);
    return result.then((verified) => {
      expect(verified).toBe(true);
      expect(req.clideckDevice.token_hash).toBe(rec.token_hash);
      // Sanity: the stashed device matches by reference identity for the
      // onConnection wrapper to attach ws.deviceId / ws.deviceTokenHash.
      expect(req.clideckDevice.token_hash).toMatch(/^sha256:/);
    });
  });
});

describe('readDeviceToken — header tolerance', () => {
  it('handles whitespace and ordering tolerance: returns the non-sentinel entry regardless of position/spacing', () => {
    const { authGate } = freshGate();
    const cases = [
      { header: 'clideck-device-token, abc', expected: 'abc' },
      { header: 'abc , clideck-device-token', expected: 'abc' },
      { header: 'clideck-device-token,abc',  expected: 'abc' },
      { header: '  clideck-device-token  ,  abc  ', expected: 'abc' },
    ];
    for (const { header, expected } of cases) {
      const req = { headers: { 'sec-websocket-protocol': header } };
      expect(authGate.readDeviceToken(req)).toBe(expected);
    }
  });

  it('malformed subprotocol headers (e.g. ",,,") return null without throwing', () => {
    const { authGate } = freshGate();
    const req = { headers: { 'sec-websocket-protocol': ',,,' } };
    expect(() => authGate.readDeviceToken(req)).not.toThrow();
    expect(authGate.readDeviceToken(req)).toBeNull();
    // Empty header / missing sentinel:
    expect(authGate.readDeviceToken({ headers: {} })).toBeNull();
    expect(authGate.readDeviceToken({ headers: { 'sec-websocket-protocol': '' } })).toBeNull();
  });
});
