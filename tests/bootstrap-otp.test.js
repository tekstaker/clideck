// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for the owner-bootstrap OTP path.
//
// AC mapping:
//   - AC7 (owner bootstrap path works — empty devices.json → server boot
//     OTP → /pair redeem succeeds for the first device)
//   - D-02 pin (boot OTP to stdout + .clideck/bootstrap.otp, deleted on
//     first successful redeem)
//
// RED reason (expected today):
//   `../pair-otp.js` and `../devices.js` do NOT exist. Wave 1 plan
//   16-03 ships pair-otp.js with bootstrapIfNeeded(); plan 16-02 ships
//   devices.js with isEmpty/clearBootstrap/BOOTSTRAP_PATH. freshBoot()
//   throws MODULE_NOT_FOUND on the first import.
//
// Patterns inherited:
//   - PATTERNS §4.1/§4.2/§4.3 (env, tempdir, cache-wipe)
//
// Per CLAUDE.md §13 — `console.log` IS the recovery path for the boot
// OTP. The OTP is deliberately printed once during bootstrap (D-02 / SPEC
// §"Owner bootstrap path"); this is the bounded exception to the
// no-secrets-in-logs rule called out in CONTEXT.md. The test captures
// the banner to assert the OTP is present, then asserts the
// bootstrap.otp file contains the same OTP — the recovery is verified
// without exfiltrating the value beyond the test process.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';

let TEST_DATA_DIR;

function freshBoot() {
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

function syntheticToken() {
  return 'test-token-NOT-real-' + Math.random().toString(36).slice(2)
    + '-' + Math.random().toString(36).slice(2);
}

// Extract the 6-char OTP from any of the captured console.log calls.
// Banner format per RESEARCH §10.3 is `[clideck] bootstrap pair code:
// XXX-XXX`. We tolerate any whitespace / surrounding ANSI / the
// hyphenated form by regex-scanning across all captured args.
function extractOtpFromCalls(calls) {
  for (const call of calls) {
    for (const arg of call) {
      const s = String(arg);
      const m = s.match(/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}[-]?[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}/);
      if (m) return m[0].replace('-', '');
    }
  }
  return null;
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-bootstrap-otp-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  vi.useRealTimers();
  vi.restoreAllMocks();
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('bootstrapIfNeeded() — empty devices.json path (AC7, D-02)', () => {
  it('on empty devices.json: writes 6-char OTP to ${DATA_DIR}/bootstrap.otp and logs the bootstrap pair code banner to stdout', () => {
    const { devices, pairOtp } = freshBoot();
    devices.load();
    expect(devices.isEmpty()).toBe(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    // Banner present
    const bannerCall = logSpy.mock.calls.find(call =>
      call.some(a => typeof a === 'string' && /bootstrap pair code/.test(a))
    );
    expect(bannerCall).toBeTruthy();
    // File present
    expect(existsSync(devices.BOOTSTRAP_PATH)).toBe(true);
    const fileOtp = readFileSync(devices.BOOTSTRAP_PATH, 'utf8').trim();
    expect(fileOtp).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('when devices has ≥1 device: no file written, no banner logged', () => {
    const { devices, pairOtp } = freshBoot();
    devices.load();
    devices.add({ label: 'Existing', uaFingerprint: 'ua', rawToken: syntheticToken() });
    expect(devices.isEmpty()).toBe(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    const bannerCall = logSpy.mock.calls.find(call =>
      call.some(a => typeof a === 'string' && /bootstrap pair code/.test(a))
    );
    expect(bannerCall).toBeUndefined();
    expect(existsSync(devices.BOOTSTRAP_PATH)).toBe(false);
  });

  it('the OTP in bootstrap.otp matches the OTP visible in the captured console.log banner (same value)', () => {
    const { devices, pairOtp } = freshBoot();
    devices.load();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    const fromBanner = extractOtpFromCalls(logSpy.mock.calls);
    const fromFile = readFileSync(devices.BOOTSTRAP_PATH, 'utf8').trim();
    expect(fromBanner).toBeTruthy();
    expect(fromFile).toBe(fromBanner);
  });

  it('bootstrap.otp file content is the 6-char OTP + trailing newline (no extra whitespace)', () => {
    const { devices, pairOtp } = freshBoot();
    devices.load();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    const raw = readFileSync(devices.BOOTSTRAP_PATH, 'utf8');
    expect(raw).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}\n$/);
  });

  it('after redeeming the bootstrap OTP + clearBootstrap(), existsSync(BOOTSTRAP_PATH) is false', () => {
    const { devices, pairOtp } = freshBoot();
    devices.load();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    const otp = readFileSync(devices.BOOTSTRAP_PATH, 'utf8').trim();
    const res = pairOtp.redeemOtp(otp);
    expect(res).toEqual(expect.objectContaining({ ok: true, isBootstrap: true }));
    devices.clearBootstrap();
    expect(existsSync(devices.BOOTSTRAP_PATH)).toBe(false);
  });

  it('bootstrap OTP has a long TTL (24h per RESEARCH §10.3): still redeemable after 6h fake-time advance', () => {
    vi.useFakeTimers();
    const { devices, pairOtp } = freshBoot();
    devices.load();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    const otp = readFileSync(devices.BOOTSTRAP_PATH, 'utf8').trim();
    vi.advanceTimersByTime(6 * 60 * 60 * 1000); // 6 hours
    const res = pairOtp.redeemOtp(otp);
    expect(res).toEqual(expect.objectContaining({ ok: true, isBootstrap: true }));
  });

  it('bootstrap OTP redeems with isBootstrap: true (distinguishable from a user-minted OTP)', () => {
    const { devices, pairOtp } = freshBoot();
    devices.load();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    pairOtp.bootstrapIfNeeded();
    const bootstrapOtp = readFileSync(devices.BOOTSTRAP_PATH, 'utf8').trim();
    const { otp: userOtp } = pairOtp.mintOtp();
    const bootstrapRes = pairOtp.redeemOtp(bootstrapOtp);
    const userRes = pairOtp.redeemOtp(userOtp);
    expect(bootstrapRes).toEqual(expect.objectContaining({ ok: true, isBootstrap: true }));
    expect(userRes).toEqual(expect.objectContaining({ ok: true, isBootstrap: false }));
  });
});
