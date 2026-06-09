// @vitest-environment node
//
// Localhost-trust layer (2026-06-09) — the owner sitting at the machine
// should never be forced through the device-pairing gate. Phase 16 gated
// EVERY WebSocket upgrade on a paired device token, which regressed Lance's
// daily local browser use (the pair screen popped up demanding an OTP).
//
// This spec locks the new auth-gate contract:
//
//   verifyClient ladder (token-first, loopback-fallback):
//     1. Origin check          → 403 if disallowed (UNCHANGED, runs first)
//     2. Valid device token?   → accept as the REAL device (so revoke still
//                                targets it by id — loopback must NOT mask a
//                                paired token's identity)
//     3. No/!valid token + loopback + trustLoopback → accept as the synthetic
//                                LOOPBACK_DEVICE (owner-at-the-machine trust)
//     4. else                  → 401 'unpaired'
//
// The ordering matters: a loopback browser that DID pair (e.g. the e2e
// revoke-flow) carries a token and must be attributed to its real device,
// not to the catch-all loopback pseudo-device.
//
// Per CLAUDE.md §13 — synthetic tokens only; no real high-entropy literal.

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
  return {
    devices: require('../devices.js'),
    authGate: require('../auth-gate.js'),
  };
}

function syntheticToken() {
  return 'test-token-NOT-real-' + Math.random().toString(36).slice(2)
    + '-' + Math.random().toString(36).slice(2);
}

// fakeReq now models the peer address via req.socket.remoteAddress — the
// signal the default isLoopback predicate reads.
function fakeReq({ origin = 'http://localhost:4099', host = 'localhost:4099', subprotocol = undefined, remoteAddress = undefined } = {}) {
  const headers = { origin, host };
  if (subprotocol !== undefined) headers['sec-websocket-protocol'] = subprotocol;
  const req = { headers };
  if (remoteAddress !== undefined) req.socket = { remoteAddress };
  return req;
}

function makeAllowOrigin(allowed = true) {
  return () => allowed;
}

// Drive verifyClient and resolve with the callback args.
function run(verify, req) {
  return new Promise((resolve) => {
    verify({ req }, (verified, code, reason) => resolve({ verified, code, reason }));
  });
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-loopback-trust-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('isLoopbackAddress — peer-address classification', () => {
  it('classifies loopback v4/v6 + IPv4-mapped as loopback', () => {
    const { authGate } = freshGate();
    for (const a of ['127.0.0.1', '127.0.0.5', '::1', '::ffff:127.0.0.1']) {
      expect(authGate.isLoopbackAddress(a)).toBe(true);
    }
  });
  it('classifies LAN / public / empty as NOT loopback', () => {
    const { authGate } = freshGate();
    for (const a of ['10.0.0.5', '192.168.1.20', '203.0.113.7', '', null, undefined, 'example.com']) {
      expect(authGate.isLoopbackAddress(a)).toBe(false);
    }
  });
});

describe('verifyClient — loopback trust (owner-at-the-machine)', () => {
  it('loopback + NO token → accept as the synthetic LOOPBACK_DEVICE', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ remoteAddress: '127.0.0.1' }); // no subprotocol → no token
    const { verified } = await run(verify, req);
    expect(verified).toBe(true);
    expect(req.clideckDevice).toBeTruthy();
    expect(req.clideckDevice.loopback).toBe(true);
    expect(req.clideckDevice.id).toBeTruthy();
  });

  it('loopback (::1) + only the sentinel subprotocol (no token) → accept (loopback fallback)', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ remoteAddress: '::1', subprotocol: 'clideck-device-token' });
    const { verified } = await run(verify, req);
    expect(verified).toBe(true);
    expect(req.clideckDevice.loopback).toBe(true);
  });

  it('loopback + VALID token → attributed to the REAL device, NOT the loopback pseudo-device (revoke must still target it)', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const rawToken = syntheticToken();
    const rec = devices.add({ label: 'Desktop', uaFingerprint: 'ua', rawToken });
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ remoteAddress: '127.0.0.1', subprotocol: 'clideck-device-token, ' + rawToken });
    const { verified } = await run(verify, req);
    expect(verified).toBe(true);
    expect(req.clideckDevice.id).toBe(rec.id);
    expect(req.clideckDevice.loopback).toBeFalsy();
  });

  it('NON-loopback + NO token → still rejected 401 (remote devices must pair)', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ remoteAddress: '192.168.1.50' });
    const { verified, code, reason } = await run(verify, req);
    expect(verified).toBe(false);
    expect(code).toBe(401);
    expect(reason).toBe('unpaired');
  });

  it('NON-loopback + VALID token → accepted as the real device', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const rawToken = syntheticToken();
    const rec = devices.add({ label: 'Phone', uaFingerprint: 'ua', rawToken });
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true) });
    const req = fakeReq({ remoteAddress: '192.168.1.50', subprotocol: 'clideck-device-token, ' + rawToken });
    const { verified } = await run(verify, req);
    expect(verified).toBe(true);
    expect(req.clideckDevice.id).toBe(rec.id);
  });

  it('trustLoopback:false + loopback + no token → rejected 401 (enforce-pairing escape hatch)', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(true), trustLoopback: false });
    const req = fakeReq({ remoteAddress: '127.0.0.1' });
    const { verified, code } = await run(verify, req);
    expect(verified).toBe(false);
    expect(code).toBe(401);
  });

  it('disallowed origin + loopback → 403 (origin check still runs FIRST)', async () => {
    const { devices, authGate } = freshGate();
    devices.load();
    const verify = authGate.makeVerifyClient({ devices, isAllowedWsOrigin: makeAllowOrigin(false) });
    const req = fakeReq({ remoteAddress: '127.0.0.1' });
    const { verified, code, reason } = await run(verify, req);
    expect(verified).toBe(false);
    expect(code).toBe(403);
    expect(reason).toBe('origin not allowed');
  });
});
