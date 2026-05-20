// Paste-blobs phase — server-side helpers.
//
// Filename sanitisation, MIME→extension lookup, and the safe-path
// builder that keeps every written blob inside <cwd>/.clideck/paste/.
//
// These are pure functions on purpose — testable without spinning a
// real server. The HTTP endpoint that consumes them lives in
// server.js and stays small as a result.

const { join, resolve, sep } = require('path');
const crypto = require('crypto');

// 50 MiB. Local-only threat model but bound it anyway so a runaway
// `navigator.clipboard.read()` doesn't write a 4 GB blob to disk
// before anyone notices.
const MAX_PASTE_BLOB_BYTES = 50 * 1024 * 1024;

const MAX_FILENAME_LEN = 200;

// Lookup table for the common cases. Anything not here falls through
// to 'bin' — the file still lands on disk and the agent can read it,
// the only thing missing is a meaningful extension.
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/tiff': 'tiff',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-7z-compressed': '7z',
  'application/x-rar-compressed': 'rar',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/javascript': 'js',
  'application/octet-stream': 'bin',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function extensionFromMime(mime) {
  if (!mime) return 'bin';
  // Strip parameters: "image/png; charset=binary" → "image/png"
  const base = String(mime).split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] || 'bin';
}

// Sanitise a user-provided filename to something safe to write inside
// <cwd>/.clideck/paste/. Returns null when the input strips to
// nothing meaningful — caller should synthesise a name instead.
function sanitizeFilename(name) {
  if (typeof name !== 'string' || !name) return null;
  // Take only the basename, then collapse anything outside the safe set.
  // Handle BOTH forward and backslash separators regardless of platform.
  let base = name;
  const lastForward = base.lastIndexOf('/');
  const lastBack = base.lastIndexOf('\\');
  const cut = Math.max(lastForward, lastBack);
  if (cut >= 0) base = base.slice(cut + 1);
  // Strip everything not in [A-Za-z0-9._-]. This nukes spaces too —
  // a minor UX cost (filenames lose their friendliness) but a hard
  // win on safety: no shell-quoting drama for any consumer.
  base = base.replace(/[^A-Za-z0-9._-]+/g, '');
  // Filter out names that are only dots (., .., ...) — those collapse
  // to the inbox dir itself or parent on resolve.
  if (!base || /^\.+$/.test(base)) return null;
  // Cap length.
  if (base.length > MAX_FILENAME_LEN) {
    // Preserve a trailing extension if present.
    const lastDot = base.lastIndexOf('.');
    if (lastDot > 0 && base.length - lastDot <= 16) {
      const ext = base.slice(lastDot);
      base = base.slice(0, MAX_FILENAME_LEN - ext.length) + ext;
    } else {
      base = base.slice(0, MAX_FILENAME_LEN);
    }
  }
  return base;
}

function synthesizeFilename(mime) {
  // ISO date without colons (colons aren't path-safe on Windows even
  // though they'd survive sanitizeFilename's strip).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const short = crypto.randomBytes(4).toString('hex');
  const ext = extensionFromMime(mime);
  return `${stamp}-${short}.${ext}`;
}

// Build an absolute, safe path for a paste-blob write. Returns null
// when the sanitised filename is empty OR when the resolved path
// escapes <cwd>/.clideck/paste/.
//
// Defence in depth: even after sanitizeFilename strips path
// separators, we still resolve the final path and assert it sits
// under the inbox prefix. SPEC names this explicitly as the
// load-bearing check.
function buildSafeBlobPath(cwd, hintName, mime) {
  if (!cwd) return null;
  const inbox = join(cwd, '.clideck', 'paste');
  const filename = sanitizeFilename(hintName) || synthesizeFilename(mime);
  if (!filename) return null;
  const target = resolve(inbox, filename);
  const inboxResolved = resolve(inbox);
  // Must start with the inbox path + path separator. Using `+ sep`
  // prevents a filename like `paste-but-evil` from passing because
  // it starts with `paste`.
  if (!target.startsWith(inboxResolved + sep) && target !== inboxResolved) {
    return null;
  }
  if (target === inboxResolved) return null;
  return target;
}

module.exports = {
  MAX_PASTE_BLOB_BYTES,
  MIME_TO_EXT,
  sanitizeFilename,
  extensionFromMime,
  synthesizeFilename,
  buildSafeBlobPath,
};
