// @vitest-environment node
//
// URL detection for the clickable-links terminal feature
// (2026-05-19 terminal-ux phase, deliverable 2).
//
// The link provider scans each terminal line for http(s) URLs, runs
// each match through `cleanUrlMatch` to strip trailing punctuation
// and reject unsupported schemes, then registers the surviving
// matches as clickable ranges. These tests pin the regex + cleaning
// behaviour so the activator can stay simple.
//
// Behaviour the regex/cleaner must guarantee:
//   - Plain http / https URLs are detected.
//   - Trailing punctuation (the URL is at the end of an English
//     sentence) is stripped: . , ; : ! ? ) ] }  and stray escapes.
//   - Non-http(s) schemes (javascript:, file:, data:) are dropped
//     even if they superficially look URL-shaped. Belt-and-braces
//     defence — the activator also re-checks at click time.
//   - Multiple URLs on one line are detected independently.

import { describe, it, expect } from 'vitest';
import { cleanUrlMatch, URL_RE } from '../public/js/terminal-urls.js';

function findUrls(line) {
  return [...line.matchAll(URL_RE)]
    .map(m => cleanUrlMatch(m[0], m.index || 0))
    .filter(Boolean);
}

describe('URL detection in terminal output', () => {
  it('detects a plain https URL', () => {
    const urls = findUrls('check https://example.com please');
    expect(urls).toEqual([{ text: 'https://example.com', index: 6 }]);
  });

  it('detects a plain http URL', () => {
    const urls = findUrls('go to http://localhost:4000/foo');
    expect(urls.map(u => u.text)).toEqual(['http://localhost:4000/foo']);
  });

  it('strips a trailing period from a sentence-final URL', () => {
    const urls = findUrls('see https://example.com.');
    expect(urls.map(u => u.text)).toEqual(['https://example.com']);
  });

  it('strips trailing comma, semicolon, colon, exclamation, question', () => {
    const cases = [
      ['url, more', 'https://x.com, more', 'https://x.com'],
      ['url; more', 'https://x.com; more', 'https://x.com'],
      ['url: more', 'https://x.com: more', 'https://x.com'],
      ['url! more', 'https://x.com! more', 'https://x.com'],
      ['url? more', 'https://x.com? more', 'https://x.com'],
    ];
    for (const [label, line, expected] of cases) {
      const urls = findUrls(line);
      expect(urls.map(u => u.text), label).toEqual([expected]);
    }
  });

  it('strips trailing parenthesis / bracket / brace from (link)-style citations', () => {
    expect(findUrls('see (https://example.com) here').map(u => u.text))
      .toEqual(['https://example.com']);
    expect(findUrls('see [https://example.com] here').map(u => u.text))
      .toEqual(['https://example.com']);
    expect(findUrls('see {https://example.com} here').map(u => u.text))
      .toEqual(['https://example.com']);
  });

  it('keeps trailing slash in a URL', () => {
    expect(findUrls('go to https://example.com/').map(u => u.text))
      .toEqual(['https://example.com/']);
  });

  it('keeps query strings and fragments', () => {
    expect(findUrls('see https://example.com/path?a=1&b=2#section').map(u => u.text))
      .toEqual(['https://example.com/path?a=1&b=2#section']);
  });

  it('detects multiple URLs on the same line', () => {
    expect(findUrls('see https://a.com and https://b.com both').map(u => u.text))
      .toEqual(['https://a.com', 'https://b.com']);
  });

  it('rejects javascript: scheme even if the URL regex would match nothing', () => {
    // The URL_RE itself only matches http/https, so javascript:URLs
    // are dropped at the regex level. This is the belt — the braces
    // (activate-time re-check) live in addLinkProvider's activator.
    expect(findUrls('javascript:alert(1)')).toEqual([]);
  });

  it('rejects file: and data: schemes', () => {
    expect(findUrls('file:///etc/passwd')).toEqual([]);
    expect(findUrls('data:text/html,<script>')).toEqual([]);
  });

  it('handles a URL alone on a line', () => {
    expect(findUrls('https://example.com').map(u => u.text))
      .toEqual(['https://example.com']);
  });

  it('handles a URL with a port and a path', () => {
    expect(findUrls('listen on http://127.0.0.1:4099/foo/bar').map(u => u.text))
      .toEqual(['http://127.0.0.1:4099/foo/bar']);
  });

  it('reports correct line index for each match', () => {
    const urls = findUrls('  see https://a.com please');
    expect(urls[0].index).toBe(6);
  });

  it('returns null from cleanUrlMatch for a string that becomes empty after stripping', () => {
    // A degenerate input — the URL is just punctuation that all gets
    // stripped. `cleanUrlMatch` must return null so it can be filtered
    // rather than registered as a zero-width link.
    expect(cleanUrlMatch('....', 0)).toBeNull();
  });

  it('returns null for a malformed URL even after stripping', () => {
    // Stripping leaves something the URL constructor can't parse.
    expect(cleanUrlMatch('https://', 0)).toBeNull();
  });
});
