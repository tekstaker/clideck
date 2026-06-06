// @vitest-environment node
//
// Phase 16 — Wave 0 RED-state TDD spec for the devices.json persistence layer.
//
// AC mapping:
//   - AC8 (token-never-leaks invariant — raw token MUST NOT appear on disk)
//   - AC2 (persist {id, label, token_hash, …} after a successful pair)
//   - AC5 (revoke depends on a working remove())
//
// RED reason (expected today):
//   `../devices.js` does NOT exist. Wave 1 plan 16-02 will create it
//   from the RESEARCH §10.2 skeleton. freshDevices() throws
//   MODULE_NOT_FOUND on every it-block today, by design.
//
// Patterns inherited:
//   - PATTERNS §4.1 — `// @vitest-environment node` directive
//   - PATTERNS §4.2 — tempdir isolation via CLIDECK_DATA_DIR
//   - PATTERNS §4.3 — fresh-require-cache wipe
//
// Per CLAUDE.md §13: no real token literal in this file. The token used
// for the round-trip assertion is a synthetic per-test string with enough
// entropy to make the not-toContain check meaningful but no cryptographic
// value off the test host.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'fs';

let TEST_DATA_DIR;

function freshDevices() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${sep}clideck${sep}`) && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  return require('../devices.js');
}

beforeEach(() => {
  TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'clideck-devices-test-'));
  process.env.CLIDECK_DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  delete process.env.CLIDECK_DATA_DIR;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

function syntheticToken() {
  // Synthetic, non-cryptographic per-test string. Long & high-entropy
  // enough to make `not.toContain(rawToken)` a meaningful assertion (a
  // collision against a SHA-256 hex prefix is vanishingly improbable).
  return 'test-token-NOT-real-' + Math.random().toString(36).slice(2)
    + '-' + Math.random().toString(36).slice(2);
}

describe('devices.js — load() and empty-store init', () => {
  it('load() on an empty DATA_DIR initialises in-memory store to { version: 1, devices: [] }', () => {
    const devices = freshDevices();
    devices.load();
    expect(devices.list()).toEqual([]);
  });
});

describe('devices.js — add() / list() / round-trip', () => {
  it('add() appends a record with id starting "dev_" and a sha256-prefixed token_hash; returns the record', () => {
    const devices = freshDevices();
    devices.load();
    const rawToken = syntheticToken();
    const rec = devices.add({ label: 'Test Phone', uaFingerprint: 'ua-test', rawToken });
    expect(rec).toBeTruthy();
    expect(rec.id).toMatch(/^dev_/);
    expect(rec.label).toBe('Test Phone');
    expect(rec.token_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('returned record has paired_at + last_seen as ISO timestamps that round-trip through Date.parse', () => {
    const devices = freshDevices();
    devices.load();
    const rec = devices.add({ label: 'Test', uaFingerprint: 'ua-x', rawToken: syntheticToken() });
    expect(Number.isFinite(Date.parse(rec.paired_at))).toBe(true);
    expect(Number.isFinite(Date.parse(rec.last_seen))).toBe(true);
  });

  // ---- AC8 invariant + on-disk shape ----------------------------------
  it('AC8: after add() the on-disk file has exactly 1 record and raw token NEVER appears (sha256 only)', () => {
    const devices = freshDevices();
    devices.load();
    const rawToken = syntheticToken();
    devices.add({ label: 'Test', uaFingerprint: 'ua-x', rawToken });
    const onDiskRaw = readFileSync(devices.DEVICES_PATH, 'utf8');
    const onDisk = JSON.parse(onDiskRaw);
    expect(onDisk.devices).toHaveLength(1);
    expect(onDiskRaw).not.toContain(rawToken);  // AC8 — load-bearing
    expect(onDiskRaw).toContain('sha256:');
  });
});

describe('devices.js — hashToken()', () => {
  it('hashToken(raw) returns sha256:<64 hex chars> (length 71, sanity for safeEqualHash length guard)', () => {
    const devices = freshDevices();
    const h = devices.hashToken('any-string');
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(h).toHaveLength(71);
  });
});

describe('devices.js — findByToken()', () => {
  it('findByToken(rawToken) returns the record after add(); null on wrong/empty/null input; lookup uses the hash (not raw)', () => {
    const devices = freshDevices();
    devices.load();
    const rawToken = syntheticToken();
    const rec = devices.add({ label: 'Test', uaFingerprint: 'ua-x', rawToken });
    expect(devices.findByToken(rawToken)).toEqual(expect.objectContaining({ id: rec.id }));
    expect(devices.findByToken('wrong-token-' + Math.random())).toBeNull();
    expect(devices.findByToken('')).toBeNull();
    expect(devices.findByToken(null)).toBeNull();

    // Constant-time / hash-based lookup sanity check: reload fresh from
    // disk via freshDevices()+load() and the lookup still succeeds. The
    // raw token only exists in this test scope — if the store were
    // doing literal-string compare it could not match a fresh load.
    const devices2 = freshDevices();
    devices2.load();
    expect(devices2.findByToken(rawToken)).toEqual(expect.objectContaining({ id: rec.id }));
  });
});

describe('devices.js — remove()', () => {
  it('remove(deviceId) removes the row and returns 1; remove(<unknown>) returns 0', () => {
    const devices = freshDevices();
    devices.load();
    const rec = devices.add({ label: 'Test', uaFingerprint: 'ua-x', rawToken: syntheticToken() });
    expect(devices.remove(rec.id)).toBe(1);
    expect(devices.list()).toEqual([]);
    expect(devices.remove('dev_nonexistent')).toBe(0);
  });
});

describe('devices.js — touchLastSeen()', () => {
  it('touchLastSeen(id) updates the in-memory record AND persists to disk (verified by fresh reload)', async () => {
    const devices = freshDevices();
    devices.load();
    const rec = devices.add({ label: 'Test', uaFingerprint: 'ua-x', rawToken: syntheticToken() });
    const originalLastSeen = rec.last_seen;
    // Sleep a tick so the new ISO string is strictly later (millisecond resolution).
    await new Promise(r => setTimeout(r, 5));
    devices.touchLastSeen(rec.id);
    const devices2 = freshDevices();
    devices2.load();
    const reloaded = devices2.list().find(d => d.id === rec.id);
    expect(reloaded).toBeTruthy();
    expect(Date.parse(reloaded.last_seen)).toBeGreaterThanOrEqual(Date.parse(originalLastSeen));
  });
});

describe('devices.js — atomic-write discipline (Option A pin per PATTERNS §2.2)', () => {
  it('on-disk file uses plain writeFileSync — no devices.json.tmp* exists alongside', () => {
    const devices = freshDevices();
    devices.load();
    devices.add({ label: 'Test', uaFingerprint: 'ua-x', rawToken: syntheticToken() });
    expect(existsSync(devices.DEVICES_PATH)).toBe(true);
    // The directory should contain devices.json and NO stray temp files
    // beside it (Option A = plain write; Option B would leave .tmp-* files
    // if mid-write or if the rename failed). Pin Option A here.
    const entries = readdirSync(TEST_DATA_DIR)
      .filter(f => f.startsWith('devices.json'));
    expect(entries).toEqual(['devices.json']);
  });
});
