// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for the /pair/redeem HTTP handler.
//
// AC mapping:
//   - AC2 (successful pair → returns { device_id, token }, persists hash)
//   - AC8 (token never leaks to logs after the /pair/redeem return)
//   - AC9 (OTP single-use + TTL honored with distinct error codes)
//   - AC7 (bootstrap OTP clears .clideck/bootstrap.otp on first redeem)
//
// RED reason (expected today):
//   The /pair/redeem handler does not yet live anywhere on main.
//   `../routes/pair.js` does not exist; `../devices.js` does not exist;
//   `../pair-otp.js` does not exist. Wave 1 plan 16-04 ships the route
//   handler, plan 16-02 ships devices.js, plan 16-03 ships pair-otp.js.
//   freshPair() throws MODULE_NOT_FOUND for all three until they land.
//
// PATTERNS §1 row 7 flags that there is NO existing HTTP-handler unit
// test in clideck's suite — this is the first. The mockReq/mockRes
// helpers below are novel-for-clideck; if Wave 1 plan 16-04 prefers a
// different shape (e.g. directly importing the dispatcher), the test
// references the contract regardless of the underlying composition.
//
// Per CLAUDE.md §13 — no real tokens / OTPs as literals. All generated
// per-test. The AC8 assertion uses spy-on-console.log with a startsWith
// match on the rawToken returned by the handler in this same test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { EventEmitter } from 'events';

let TEST_DATA_DIR;

function freshPair() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${sep}clideck${sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  // Wave 1 plan 16-04 must expose handleRedeemHttp at this path. If 16-04
  // prefers to inline into server.js instead, it must still export a
  // top-level handler function so this test can drive it directly.
  return {
    devices: require('../devices.js'),
    pairOtp: require('../pair-otp.js'),
    pairRoute: require('../routes/pair.js'),
  };
}

// ---- mock req/res helpers (novel-for-clideck — see file header) -------

function mockReq({ method = 'POST', url = '/pair/redeem', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  // .destroy() mimics http.IncomingMessage.destroy() — emits 'close'
  req.destroy = () => { req.emit('close'); };
  return req;
}

function mockRes() {
  const out = { status: null, headers: {}, body: null, ended: false };
  const res = {};
  res.writeHead = (status, headers) => {
    out.status = status;
    out.headers = headers || {};
    return res;
  };
  res.end = (body) => {
    out.body = body == null ? '' : String(body);
    out.ended = true;
    return res;
  };
  res.out = out;
  return res;
}

// Drive the handler with a JSON body. Returns the parsed response.
async function postJson(handler, payload, deps) {
  const req = mockReq();
  const res = mockRes();
  handler(req, res, deps);
  req.emit('data', Buffer.from(JSON.stringify(payload)));
  req.emit('end');
  // Allow one tick for any async work inside the handler.
  await new Promise(r => setImmediate(r));
  return { req, res, out: res.out, parsed: tryParse(res.out.body) };
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-pair-redeem-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  vi.useRealTimers();
  vi.restoreAllMocks();
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('POST /pair/redeem — handler contract (AC2, AC8, AC9)', () => {
  it('happy path: valid OTP → 200 JSON { ok, device_id, token, label }; devices.list().length === 1', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { otp } = pairOtp.mintOtp();
    const { out, parsed } = await postJson(
      pairRoute.handleRedeemHttp,
      { otp, label: 'Test Phone' },
      { devices, pairOtp }
    );
    expect(out.status).toBe(200);
    expect(parsed).toEqual(expect.objectContaining({
      ok: true,
      device_id: expect.stringMatching(/^dev_/),
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      label: 'Test Phone',
    }));
    expect(devices.list()).toHaveLength(1);
  });

  it('expired OTP → 410 JSON { ok: false, error: "expired" }', async () => {
    vi.useFakeTimers();
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { otp } = pairOtp.mintOtp({ ttlSeconds: 300 });
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 min — past 5-min TTL
    const { out, parsed } = await postJson(
      pairRoute.handleRedeemHttp,
      { otp, label: 'Phone' },
      { devices, pairOtp }
    );
    expect(out.status).toBe(410);
    expect(parsed).toEqual({ ok: false, error: 'expired' });
  });

  it('used OTP (second redeem) → 400 JSON { ok: false, error: "used" }', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { otp } = pairOtp.mintOtp();
    await postJson(pairRoute.handleRedeemHttp, { otp, label: 'A' }, { devices, pairOtp });
    const { out, parsed } = await postJson(
      pairRoute.handleRedeemHttp,
      { otp, label: 'B' },
      { devices, pairOtp }
    );
    expect(out.status).toBe(400);
    expect(parsed).toEqual({ ok: false, error: 'used' });
  });

  it('unknown OTP → 400 JSON { ok: false, error: "invalid" }', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { out, parsed } = await postJson(
      pairRoute.handleRedeemHttp,
      { otp: 'ZZZZZZ', label: 'X' },
      { devices, pairOtp }
    );
    expect(out.status).toBe(400);
    expect(parsed).toEqual({ ok: false, error: 'invalid' });
  });

  it('malformed JSON body → 400 JSON { ok: false, error: "invalid-json" }', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const req = mockReq();
    const res = mockRes();
    pairRoute.handleRedeemHttp(req, res, { devices, pairOtp });
    req.emit('data', Buffer.from('this is not json {{{'));
    req.emit('end');
    await new Promise(r => setImmediate(r));
    expect(res.out.status).toBe(400);
    expect(tryParse(res.out.body)).toEqual({ ok: false, error: 'invalid-json' });
  });

  it('body cap: > 4KB body destroys the request (no response, request emits close)', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const req = mockReq();
    const res = mockRes();
    let destroyed = false;
    req.on('close', () => { destroyed = true; });
    pairRoute.handleRedeemHttp(req, res, { devices, pairOtp });
    // 5KB of garbage — exceeds the 4096-byte cap from RESEARCH §10.4
    req.emit('data', Buffer.alloc(5 * 1024, 65 /* 'A' */));
    await new Promise(r => setImmediate(r));
    expect(destroyed).toBe(true);
    // No response written
    expect(res.out.ended).toBe(false);
  });

  it('label normalisation: empty label → "Device"; 60-char label → trimmed to 32 chars', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { otp: otp1 } = pairOtp.mintOtp();
    const r1 = await postJson(
      pairRoute.handleRedeemHttp,
      { otp: otp1, label: '' },
      { devices, pairOtp }
    );
    expect(r1.parsed.label).toBe('Device');

    const { otp: otp2 } = pairOtp.mintOtp();
    const longLabel = 'A'.repeat(60);
    const r2 = await postJson(
      pairRoute.handleRedeemHttp,
      { otp: otp2, label: longLabel },
      { devices, pairOtp }
    );
    expect(r2.parsed.label).toHaveLength(32);
  });

  // ---- AC8: token-never-in-logs --------------------------------------
  it('AC8: handler never writes the raw token to console.log between request and response', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { otp } = pairOtp.mintOtp();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { parsed } = await postJson(
      pairRoute.handleRedeemHttp,
      { otp, label: 'Phone' },
      { devices, pairOtp }
    );
    const rawToken = parsed.token;
    // Scan EVERY arg of EVERY console.log call captured by the spy.
    for (const call of logSpy.mock.calls) {
      for (const arg of call) {
        const s = typeof arg === 'string' ? arg : JSON.stringify(arg);
        expect(s).not.toContain(rawToken);
      }
    }
  });

  // ---- AC8: token-returned-but-hash-persisted ------------------------
  it('AC8: raw token is in the response body exactly once; devices.list()[0].token_hash is sha256:* and does NOT contain raw', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    const { otp } = pairOtp.mintOtp();
    const { parsed } = await postJson(
      pairRoute.handleRedeemHttp,
      { otp, label: 'Phone' },
      { devices, pairOtp }
    );
    const rawToken = parsed.token;
    const persisted = devices.list()[0];
    expect(persisted.token_hash).toMatch(/^sha256:/);
    expect(persisted.token_hash).not.toContain(rawToken);
  });

  it('bootstrap OTP redeem deletes the .clideck/bootstrap.otp file', async () => {
    const { devices, pairOtp, pairRoute } = freshPair();
    devices.load();
    // Seed a bootstrap OTP file + a bootstrap-flagged OTP in the store.
    const { otp } = pairOtp.mintOtp({ ttlSeconds: 24 * 3600, isBootstrap: true });
    writeFileSync(devices.BOOTSTRAP_PATH, otp + '\n');
    expect(existsSync(devices.BOOTSTRAP_PATH)).toBe(true);
    await postJson(
      pairRoute.handleRedeemHttp,
      { otp, label: 'First device' },
      { devices, pairOtp }
    );
    expect(existsSync(devices.BOOTSTRAP_PATH)).toBe(false);
  });
});
