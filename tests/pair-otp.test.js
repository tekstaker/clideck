// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for the OTP layer.
//
// AC mapping:
//   - AC9 (OTP single-use + TTL honored, distinct error codes)
//   - AC7 (owner-bootstrap path's OTP machinery)
//   - D-04 / Q-1 (31-char unambiguous alphabet locked by the planner)
//
// RED reason (expected today):
//   `../pair-otp.js` does NOT exist. Wave 1 plan 16-03 will create it
//   with the shape pinned in `.planning/2026-06-05-device-pairing-for-mobile-access/16-RESEARCH.md` §10.3.
//   `freshOtp()` will throw `MODULE_NOT_FOUND` until 16-03 lands.
//
// This file is the design contract. It must not be silenced or skipped.
// When 16-03 turns it green, the contract has been satisfied.
//
// Patterns inherited:
//   - PATTERNS §4.1 — `// @vitest-environment node` directive on line 1
//   - PATTERNS §4.2 — `CLIDECK_DATA_DIR=mkdtempSync(...)` per-test isolation
//   - PATTERNS §4.3 — fresh-require-cache wipe (clideck-only, never node_modules)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync } from 'fs';

let TEST_DATA_DIR;

function freshOtp() {
  // Wipe clideck-owned require-cache entries only — never wipe node_modules,
  // that would re-instantiate vitest and friends mid-test.
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${sep}clideck${sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  // This is the symbolic require path Wave 1 plan 16-03 must satisfy.
  return require('../pair-otp.js');
}

beforeEach(() => {
  // Even though the OTP store is in-memory, the require-cache wipe pulls
  // paths.js into the boot path. Set CLIDECK_DATA_DIR so paths.js mkdir's
  // into the tempdir instead of the real ~/.clideck/ (PATTERNS §4.2 defence).
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-pair-otp-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  vi.useRealTimers();
  vi.restoreAllMocks();
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('pair-otp — mintOtp + redeemOtp contract (AC9)', () => {
  it('mintOtp() returns { otp, expiresAt } with a 6-char string and ISO timestamp', () => {
    const pairOtp = freshOtp();
    const result = pairOtp.mintOtp();
    expect(result).toBeTruthy();
    expect(typeof result.otp).toBe('string');
    expect(result.otp).toHaveLength(6);
    expect(typeof result.expiresAt).toBe('string');
    expect(Number.isFinite(Date.parse(result.expiresAt))).toBe(true);
    // expiresAt is in the future
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now() - 1000);
  });

  it('generated OTP only uses chars from the 31-char unambiguous alphabet (Q-1 / D-04)', () => {
    const pairOtp = freshOtp();
    // Run many mints to amortise the alphabet check (single-shot could miss a bad char).
    for (let i = 0; i < 50; i++) {
      const { otp } = pairOtp.mintOtp();
      // 31-char alphabet: A-Z minus {I, L, O} (= 23 chars) + 2-9 (= 8 chars).
      // No 0/O/1/I/L, lowercase intentionally excluded — canonical form is uppercase.
      expect(otp).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('redeemOtp(otp) returns { ok: true, isBootstrap: false } on first call for a user-minted OTP (AC9)', () => {
    const pairOtp = freshOtp();
    const { otp } = pairOtp.mintOtp();
    const res = pairOtp.redeemOtp(otp);
    expect(res).toEqual(expect.objectContaining({ ok: true, isBootstrap: false }));
  });

  it('redeemOtp(otp) returns { ok: false, error: "used" } on second call with the same OTP (AC9 single-use)', () => {
    const pairOtp = freshOtp();
    const { otp } = pairOtp.mintOtp();
    const first = pairOtp.redeemOtp(otp);
    expect(first.ok).toBe(true);
    const second = pairOtp.redeemOtp(otp);
    expect(second).toEqual(expect.objectContaining({ ok: false }));
    // Per RESEARCH §10.3 the second-redeem error is 'used' (or 'invalid' once
    // it's been removed from the store). Both are valid post-consumption
    // signals; 16-03 must pick one and stick to it. The plan locks 'used'.
    expect(second.error).toBe('used');
  });

  it('redeemOtp(<unknown OTP>) returns { ok: false, error: "invalid" }', () => {
    const pairOtp = freshOtp();
    const res = pairOtp.redeemOtp('ZZZZZZ');
    expect(res).toEqual({ ok: false, error: 'invalid' });
  });

  it('redeemOtp(<expired OTP>) returns { ok: false, error: "expired" } after TTL passes (AC9)', () => {
    vi.useFakeTimers();
    const pairOtp = freshOtp();
    const { otp } = pairOtp.mintOtp({ ttlSeconds: 300 }); // 5-min default
    // Fast-forward 6 minutes — well past the 5-min TTL.
    vi.advanceTimersByTime(6 * 60 * 1000);
    const res = pairOtp.redeemOtp(otp);
    expect(res).toEqual({ ok: false, error: 'expired' });
  });

  it('redeemOtp is case-insensitive — accepts lowercase form (mirrors /pair/redeem body normalisation per RESEARCH §10.4)', () => {
    const pairOtp = freshOtp();
    const { otp } = pairOtp.mintOtp();
    const res = pairOtp.redeemOtp(otp.toLowerCase());
    expect(res.ok).toBe(true);
  });
});
