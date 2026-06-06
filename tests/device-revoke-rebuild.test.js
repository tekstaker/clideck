// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for the re-pair-after-revoke cycle.
//
// AC mapping:
//   - AC6 (revoked device can re-pair — pairing is per-token, not
//     per-browser-fingerprint; a fresh OTP succeeds for the same
//     browser / UA fingerprint after revoke)
//
// RED reason (expected today):
//   The full mint → add → remove → mint → add cycle requires
//   ../devices.js + ../pair-otp.js. Both are NEW (Wave 1 plans 16-02 /
//   16-03). The HTTP-handler driven version of this cycle is the
//   pair-redeem.test.js spec; THIS spec drives the devices + otp APIs
//   directly to keep the scope tight on the AC6 semantic invariant
//   (per-token NOT per-fingerprint).
//
// Patterns inherited:
//   - PATTERNS §4.1/§4.2/§4.3 (vitest env node, CLIDECK_DATA_DIR
//     tempdir, fresh-require-cache wipe).
//
// Per CLAUDE.md §13 — `syntheticToken()` synthesised per-test; no real
// token / fingerprint literals.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync } from 'fs';

let TEST_DATA_DIR;

function freshAll() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${sep}clideck${sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return {
    devices: require('../devices.js'),
    pairOtp: require('../pair-otp.js'),
  };
}

// Mimic the /pair/redeem flow at the unit-API level: mint OTP, redeem,
// generate the raw token, devices.add().
function pairOnce({ devices, pairOtp, label = 'Phone', uaFingerprint = 'ua-fixed' }) {
  const { otp } = pairOtp.mintOtp();
  const redeem = pairOtp.redeemOtp(otp);
  if (!redeem.ok) throw new Error('redeem failed: ' + redeem.error);
  const rawToken = devices.mintToken();
  const rec = devices.add({ label, uaFingerprint, rawToken });
  return { rec, rawToken };
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-revoke-rebuild-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  vi.useRealTimers();
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('AC6 — re-pair after revoke (per-token, not per-fingerprint)', () => {
  it('full cycle: pair → revoke → pair again → devices.list().length === 1 with a NEW dev_* id', () => {
    const { devices, pairOtp } = freshAll();
    devices.load();
    const first = pairOnce({ devices, pairOtp });
    expect(devices.list()).toHaveLength(1);
    expect(devices.remove(first.rec.id)).toBe(1);
    expect(devices.list()).toHaveLength(0);
    const second = pairOnce({ devices, pairOtp });
    expect(devices.list()).toHaveLength(1);
    expect(second.rec.id).not.toBe(first.rec.id);
  });

  it('the new record has a DIFFERENT token_hash than the revoked one (each pair mints a fresh token)', () => {
    const { devices, pairOtp } = freshAll();
    devices.load();
    const first = pairOnce({ devices, pairOtp });
    devices.remove(first.rec.id);
    const second = pairOnce({ devices, pairOtp });
    expect(second.rec.token_hash).not.toBe(first.rec.token_hash);
    expect(first.rawToken).not.toBe(second.rawToken);
  });

  it('the new record paired_at is >= the revoked-and-removed paired_at (with fake timers + advance)', () => {
    vi.useFakeTimers();
    const { devices, pairOtp } = freshAll();
    devices.load();
    const first = pairOnce({ devices, pairOtp });
    devices.remove(first.rec.id);
    vi.advanceTimersByTime(1000);
    const second = pairOnce({ devices, pairOtp });
    expect(Date.parse(second.rec.paired_at)).toBeGreaterThanOrEqual(Date.parse(first.rec.paired_at));
  });

  it('same UA fingerprint can re-pair — proves "per-token, not per-fingerprint" (AC6 explicit)', () => {
    const { devices, pairOtp } = freshAll();
    devices.load();
    const FIXED_UA = 'ua-fixed-fingerprint-shared-across-pairs';
    const first = pairOnce({ devices, pairOtp, uaFingerprint: FIXED_UA });
    devices.remove(first.rec.id);
    const second = pairOnce({ devices, pairOtp, uaFingerprint: FIXED_UA });
    expect(second.rec.fingerprint).toBe(FIXED_UA);
    expect(first.rec.fingerprint).toBe(FIXED_UA);
    // Both records had the same fingerprint, but the cycle succeeded —
    // no per-fingerprint block.
    expect(devices.list()).toHaveLength(1);
  });

  it('after the second pair, findByToken(oldRawToken) is null (revoked token is dead); findByToken(newRawToken) returns the new record', () => {
    const { devices, pairOtp } = freshAll();
    devices.load();
    const first = pairOnce({ devices, pairOtp });
    devices.remove(first.rec.id);
    const second = pairOnce({ devices, pairOtp });
    expect(devices.findByToken(first.rawToken)).toBeNull();
    const found = devices.findByToken(second.rawToken);
    expect(found).toEqual(expect.objectContaining({ id: second.rec.id }));
  });
});
