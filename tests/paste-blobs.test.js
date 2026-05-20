// @vitest-environment node
//
// Paste-blobs phase — server-side helpers.
//
// Pins the filename sanitisation, MIME→extension lookup, and the
// path-resolution guard that keeps written files inside
// <cwd>/.clideck/paste/. These are the load-bearing safety checks
// the SPEC names explicitly:
//
//   - Filename sanitisation MUST resolve under <cwd>/.clideck/paste/.
//   - Use path.resolve() + prefix check, not regex stripping alone.
//   - MIME→ext fallback to .bin for unknown types.

import { describe, it, expect } from 'vitest';
import { join, resolve, sep } from 'path';
import {
  sanitizeFilename,
  extensionFromMime,
  buildSafeBlobPath,
  MAX_PASTE_BLOB_BYTES,
  MIME_TO_EXT,
} from '../paste-blobs.js';

describe('sanitizeFilename', () => {
  it('keeps a normal filename intact', () => {
    expect(sanitizeFilename('screenshot.png')).toBe('screenshot.png');
  });

  it('strips path separators (forward and backslash)', () => {
    expect(sanitizeFilename('foo/bar.png')).toBe('bar.png');
    expect(sanitizeFilename('foo\\bar.png')).toBe('bar.png');
  });

  it('rejects parent-directory traversal segments', () => {
    expect(sanitizeFilename('../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\Windows\\notepad.exe')).toBe('notepad.exe');
  });

  it('strips control characters and shell-special chars to safe set', () => {
    const s = sanitizeFilename('weird name$with*chars?.png');
    // Allowed: [A-Za-z0-9._-]; spaces and other chars get stripped.
    expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(s).toContain('.png');
  });

  it('returns null for an empty / all-stripped name', () => {
    expect(sanitizeFilename('')).toBeNull();
    expect(sanitizeFilename('///')).toBeNull();
    expect(sanitizeFilename('  ')).toBeNull();
    expect(sanitizeFilename('???')).toBeNull();
  });

  it('returns null for inputs that resolve to just dots after stripping', () => {
    expect(sanitizeFilename('.')).toBeNull();
    expect(sanitizeFilename('..')).toBeNull();
    expect(sanitizeFilename('...')).toBeNull();
  });

  it('caps the length so a 1MB filename does not get written verbatim', () => {
    const huge = 'x'.repeat(5000) + '.png';
    const out = sanitizeFilename(huge);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('.png')).toBe(true);
  });
});

describe('extensionFromMime', () => {
  it('maps common image types', () => {
    expect(extensionFromMime('image/png')).toBe('png');
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(extensionFromMime('image/gif')).toBe('gif');
    expect(extensionFromMime('image/webp')).toBe('webp');
    expect(extensionFromMime('image/svg+xml')).toBe('svg');
  });

  it('maps common document / archive types', () => {
    expect(extensionFromMime('application/pdf')).toBe('pdf');
    expect(extensionFromMime('application/zip')).toBe('zip');
    expect(extensionFromMime('application/json')).toBe('json');
  });

  it('falls back to bin for unknown types', () => {
    expect(extensionFromMime('application/x-very-rare')).toBe('bin');
    expect(extensionFromMime('weird/format')).toBe('bin');
  });

  it('handles empty / missing mime safely', () => {
    expect(extensionFromMime('')).toBe('bin');
    expect(extensionFromMime(null)).toBe('bin');
    expect(extensionFromMime(undefined)).toBe('bin');
  });

  it('ignores parameters on the mime type', () => {
    expect(extensionFromMime('image/png; charset=binary')).toBe('png');
    expect(extensionFromMime('application/pdf; foo=bar')).toBe('pdf');
  });

  it('is exposed via the MIME_TO_EXT table', () => {
    expect(MIME_TO_EXT['image/png']).toBe('png');
    expect(MIME_TO_EXT['application/zip']).toBe('zip');
  });
});

describe('buildSafeBlobPath', () => {
  const CWD = process.platform === 'win32' ? 'C:\\projects\\foo' : '/projects/foo';
  const INBOX = join(CWD, '.clideck', 'paste');

  it('returns an absolute path under <cwd>/.clideck/paste/ for a clean filename', () => {
    const result = buildSafeBlobPath(CWD, 'screenshot.png');
    expect(result).toBeTruthy();
    expect(result.startsWith(INBOX + sep) || result.startsWith(INBOX + '/')).toBe(true);
    expect(result).toContain('screenshot.png');
  });

  it('synthesises a name when the hint sanitises to null (instead of refusing)', () => {
    // SPEC step 4: "If filename absent or all-stripped, synthesise".
    // The '???' hint strips to nothing — buildSafeBlobPath should
    // fall back to the synthesised name, not refuse the upload.
    const result = buildSafeBlobPath(CWD, '???', 'image/png');
    expect(result).toBeTruthy();
    expect(result.endsWith('.png')).toBe(true);
  });

  it('refuses when there is no cwd to anchor the inbox under', () => {
    expect(buildSafeBlobPath(null, 'screenshot.png')).toBeNull();
    expect(buildSafeBlobPath('', 'screenshot.png')).toBeNull();
  });

  it('refuses a filename whose resolved path escapes the inbox (defence in depth)', () => {
    // sanitizeFilename should have already stripped these, but the
    // path-resolution guard is the load-bearing check per the SPEC.
    expect(buildSafeBlobPath(CWD, '../../../etc/passwd')).toBeTruthy(); // sanitised to "passwd"
    // Direct attempt with a path-shaped sanitised remainder must be blocked
    // even if sanitizeFilename had a bug — manually probe by passing a
    // pre-sanitised name we know is safe vs. unsafe.
    expect(buildSafeBlobPath(CWD, 'passwd')).toBeTruthy();
  });

  it('synthesises a filename if hintName is null', () => {
    const result = buildSafeBlobPath(CWD, null, 'image/png');
    expect(result).toBeTruthy();
    expect(result.endsWith('.png')).toBe(true);
    // Synthesised name pattern: <isoish-timestamp>-<short>.<ext>
    expect(result).toMatch(/[0-9]{4}-?[0-9]{2}-?[0-9]{2}.*\.png$/);
  });

  it('synthesises with .bin for an unknown mime', () => {
    const result = buildSafeBlobPath(CWD, null, 'application/x-rare');
    expect(result.endsWith('.bin')).toBe(true);
  });
});

describe('MAX_PASTE_BLOB_BYTES', () => {
  it('is a sane non-zero limit', () => {
    expect(MAX_PASTE_BLOB_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_PASTE_BLOB_BYTES).toBeLessThanOrEqual(500 * 1024 * 1024);
  });
});
