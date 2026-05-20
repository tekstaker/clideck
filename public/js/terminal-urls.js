// URL detection helpers for the clickable-links terminal feature.
// Pure functions, no DOM access — testable in a plain node Vitest run.
//
// The `URL_RE` matches http(s) URLs as they tend to appear in agent
// terminal output. `cleanUrlMatch` post-processes each match: it
// strips trailing punctuation that's almost always part of the
// surrounding sentence, not the URL ("see https://example.com." →
// drop the period), and rejects anything that doesn't parse cleanly
// as http/https.

export const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;

export function cleanUrlMatch(text, index) {
  let url = text;
  // Strip trailing punctuation. The regex catches greedy chars the
  // URL regex doesn't bound (parens, brackets, sentence enders).
  while (/[),.;:!?\\\]}]+$/.test(url)) url = url.slice(0, -1);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { text: url, index };
}
